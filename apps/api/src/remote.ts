import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { filename, promptFor } from '@bt03/shared';
import { Queue } from 'bullmq';

const registration = z.object({checkpoint:z.string().min(1).max(200),memberName:z.string().min(1).max(80).optional()}).strict();
const resultSchema = z.object({jobId:z.string().uuid(),seed:z.number().int().nonnegative(),latencyMs:z.number().int().nonnegative(),width:z.number().int(),height:z.number().int()}).strict();
const failureSchema = z.object({jobId:z.string().uuid(),error:z.string().min(1).max(1000)}).strict();
const workerIdSchema = z.string().regex(/^\d+\.\d+$/).refine(value=>value!=='1.1');
const recoveryAttempts=new Map<string,{id:string;at:number}>();

export async function recoverQueuedJob(db:PrismaClient,queue:Queue,jobId:string) {
  const job=await db.generationJob.findUnique({where:{id:jobId}});
  if (!job || job.status!=='queued') return;
  const original=await queue.getJob(jobId);
  const state=original ? await original.getState() : 'unknown';
  if (state==='waiting'||state==='active'||state==='delayed'||state==='prioritized') return;
  const previous=recoveryAttempts.get(jobId);
  if (previous) {
    const earlier=await queue.getJob(previous.id);
    const earlierState=earlier ? await earlier.getState() : 'unknown';
    if (earlierState==='waiting'||earlierState==='active'||earlierState==='delayed'||earlierState==='prioritized'||previous.at>Date.now()-30_000) return;
  }
  const recoveryId=`${jobId}-recovery-${randomUUID().slice(0,8)}`;
  await queue.add('generate',{dbJobId:jobId},{jobId:recoveryId,priority:job.source==='search'?1:10,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:{age:86400},removeOnFail:{age:604800}});
  recoveryAttempts.set(jobId,{id:recoveryId,at:Date.now()});
}

export function remoteRoutes(db:PrismaClient,queue:Queue) {
  const router=express.Router();
  router.use((req:Request,res:Response,next:NextFunction)=>{
    const secret=process.env.REMOTE_WORKER_SECRET;
    if (!secret || secret.length<32) return res.status(503).json({error:'Remote workers are not configured'});
    const workerId=req.get('x-worker-id');
    const token=req.get('authorization')?.replace(/^Bearer /,'');
    if (!workerId || !workerIdSchema.safeParse(workerId).success || !token) return res.status(401).json({error:'Worker authentication required'});
    const expected=createHmac('sha256',secret).update(workerId).digest('hex');
    const supplied=Buffer.from(token,'utf8');
    if (supplied.length!==expected.length || !timingSafeEqual(supplied,Buffer.from(expected))) return res.status(401).json({error:'Invalid worker token'});
    res.locals.workerId=workerId;
    next();
  });
  router.post('/register',express.json({limit:'2kb'}),async(req,res,next)=>{
    try {
      const {checkpoint,memberName}=registration.parse(req.body);
      const id=res.locals.workerId as string;
      const memberId=`remote-${id}`;
      const modelId=`remote-${id}`;
      const recovered=await db.$transaction(async tx=>{
        const previous=await tx.aiWorker.findUnique({where:{id}});
        let recoveredId:string|undefined;
        if (previous?.currentJobId) {
          const changed=await tx.generationJob.updateMany({where:{id:previous.currentJobId,workerId:id,status:'generating'},data:{status:'queued',workerId:null,error:'Remote worker restarted'}});
          if(changed.count) recoveredId=previous.currentJobId;
        }
        await tx.member.upsert({where:{id:memberId},create:{id:memberId,name:memberName||id},update:{name:memberName||id}});
        // A model belongs to one remote worker, so registration never changes another worker's model.
        await tx.aiModel.upsert({where:{id:modelId},create:{id:modelId,checkpoint,lcmLora:process.env.LCM_LORA||'latent-consistency/lcm-lora-sdv1-5',styleLora:'hokusai_ukiyoe.safetensors',installed:true},update:{checkpoint,installed:true}});
        await tx.aiWorker.upsert({where:{id},create:{id,memberId,modelId,status:'idle',lastHeartbeat:new Date()},update:{memberId,modelId,status:'idle',lastHeartbeat:new Date(),currentJobId:null}});
        return recoveredId;
      });
      if (recovered) await recoverQueuedJob(db,queue,recovered);
      res.json({workerId:id,status:'idle'});
    } catch(error){next(error);}
  });
  router.post('/heartbeat',express.json({limit:'2kb'}),async(req,res,next)=>{
    try {
      const id=res.locals.workerId as string;
      const worker=await db.aiWorker.findUnique({where:{id}});
      if (!worker || worker.modelId!==`remote-${id}`) return res.status(404).json({error:'Register worker first'});
      await db.aiWorker.update({where:{id},data:{lastHeartbeat:new Date()}});
      res.json({status:worker.status,currentJobId:worker.currentJobId});
    } catch(error){next(error);}
  });
  router.post('/claim',async(req,res,next)=>{
    try {
      const id=res.locals.workerId as string;
      const worker=await db.aiWorker.findUnique({where:{id},include:{model:true}});
      if (!worker || worker.modelId!==`remote-${id}`) return res.status(404).json({error:'Register worker first'});
      if (worker.currentJobId) return res.status(409).json({error:'Worker already has a job'});
      let claimed:Awaited<ReturnType<typeof db.generationJob.findFirst>>=null;
      for (let attempt=0;attempt<10;attempt++) {
        const candidate=await db.generationJob.findFirst({where:{status:'queued'},orderBy:[{source:'desc'},{createdAt:'asc'}]});
        if (!candidate) break;
        const acquired=await db.$transaction(async tx=>{
          const updated=await tx.generationJob.updateMany({where:{id:candidate.id,status:'queued'},data:{status:'generating',workerId:id,error:null}});
          if (!updated.count) return false;
          await tx.aiWorker.update({where:{id},data:{status:'generating',currentJobId:candidate.id,lastHeartbeat:new Date()}});
          await tx.generationLog.create({data:{jobId:candidate.id,workerId:id,level:'info',message:'Remote worker claimed job'}});
          return true;
        });
        if (acquired) {claimed=candidate;break;}
      }
      if (!claimed) {await db.aiWorker.update({where:{id},data:{status:'idle',lastHeartbeat:new Date()}});return res.status(204).end();}
      const seed=Math.floor(Math.random()*2147483647);
      res.json({jobId:claimed.id,description:claimed.normalizedSearch,prompt:promptFor(claimed.normalizedSearch),checkpoint:worker.model.checkpoint,lcmLora:worker.model.lcmLora,styleLora:'hokusai_ukiyoe.safetensors',negativePrompt:process.env.NEGATIVE_PROMPT||'',width:Number(process.env.IMAGE_WIDTH||512),height:Number(process.env.IMAGE_HEIGHT||512),steps:Number(process.env.INFERENCE_STEPS||4),guidance:Number(process.env.GUIDANCE_SCALE||1),styleWeight:Number(process.env.STYLE_LORA_WEIGHT||0.7),seed});
    } catch(error){next(error);}
  });
  router.post('/complete',express.raw({type:'image/png',limit:'12mb'}),async(req,res,next)=>{
    let temp:string|undefined;
    try {
      const id=res.locals.workerId as string;
      const metadata=resultSchema.parse(JSON.parse(req.get('x-job-result')||'{}'));
      const body=req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length<24 || !body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || body.toString('ascii',12,16)!=='IHDR' || body.readUInt32BE(16)!==metadata.width || body.readUInt32BE(20)!==metadata.height) return res.status(400).json({error:'Invalid PNG'});
      const job=await db.generationJob.findUnique({where:{id:metadata.jobId}});
      const worker=await db.aiWorker.findUnique({where:{id},include:{model:true}});
      if (job?.status==='completed' && job.workerId===id) return res.json({imageId:job.imageId});
      if (!job || !worker || job.workerId!==id || worker.currentJobId!==job.id) return res.status(409).json({error:'Job is not assigned to this worker'});
      if (job.status!=='generating') return res.status(409).json({error:'Job is not generating'});
      const root=path.resolve(process.env.IMAGE_ROOT||'storage/images');
      await mkdir(root,{recursive:true});
      const name=filename(job.normalizedSearch,id,job.id.slice(0,8));
      const finalPath=path.join(root,name);
      temp=path.join(root,`.${randomUUID()}.tmp`);
      await writeFile(temp,body,{flag:'wx'});
      await link(temp,finalPath);
      const image=await db.$transaction(async tx=>{
        const created=await tx.image.create({data:{englishDescription:job.normalizedSearch,originalQuery:job.originalQuery,normalizedSearch:job.normalizedSearch,prompt:promptFor(job.normalizedSearch),negativePrompt:process.env.NEGATIVE_PROMPT||'',workerId:id,modelId:worker.modelId,checkpoint:worker.model.checkpoint,loraName:worker.model.styleLora,seed:metadata.seed,width:metadata.width,height:metadata.height,steps:Number(process.env.INFERENCE_STEPS||4),guidanceScale:Number(process.env.GUIDANCE_SCALE||1),latencyMs:metadata.latencyMs,storagePath:name}});
        await tx.generationJob.update({where:{id:job.id},data:{status:'completed',imageId:created.id}});
        await tx.aiWorker.update({where:{id},data:{status:'idle',currentJobId:null,completedJobs:{increment:1},totalLatencyMs:{increment:BigInt(metadata.latencyMs)}}});
        await tx.generationLog.create({data:{jobId:job.id,workerId:id,level:'info',message:'Remote image saved'}});
        return created;
      });
      res.json({imageId:image.id});
    } catch(error){next(error);} finally {if(temp)await unlink(temp).catch(()=>{});}
  });
  router.post('/fail',express.json({limit:'2kb'}),async(req,res,next)=>{
    try {
      const id=res.locals.workerId as string;
      const {jobId,error}=failureSchema.parse(req.body);
      const updated=await db.generationJob.updateMany({where:{id:jobId,workerId:id,status:'generating'},data:{status:'queued',workerId:null,error}});
      if (!updated.count) return res.status(409).json({error:'Job is not assigned to this worker'});
      await db.$transaction([
        db.aiWorker.update({where:{id},data:{status:'idle',currentJobId:null,failedJobs:{increment:1}}}),
        db.generationLog.create({data:{jobId,workerId:id,level:'error',message:error}})
      ]);
      await recoverQueuedJob(db,queue,jobId);
      res.json({status:'queued'});
    } catch(error){next(error);}
  });
  return router;
}
