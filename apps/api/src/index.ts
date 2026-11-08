import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { z, ZodError } from 'zod';
import { normalizeQuery, pageSchema } from '@bt03/shared';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { remoteRoutes, recoverQueuedJob } from './remote';

const db = new PrismaClient();
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:56379', { maxRetriesPerRequest:null });
const queue = new Queue('bt03-generation',{connection:redis});
const app = express();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false}));
app.use('/api/internal/remote',remoteRoutes(db,queue));
app.use(express.json({limit:'16kb'}));
app.use('/api',rateLimit({windowMs:60_000,limit:100,standardHeaders:'draft-8',legacyHeaders:false}));
const asyncRoute = (fn:(req:Request,res:Response)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => Promise.resolve(fn(req,res)).catch(next);
function admin(req:Request,res:Response,next:NextFunction) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get('authorization') !== `Bearer ${token}`) return res.status(403).json({error:{code:'FORBIDDEN',message:'Administrator token required'}});
  next();
}
function imageView(image:any) { return {...image,url:`/api/images/${image.id}/file`}; }
function workerView(worker:any) { const {totalLatencyMs,...rest}=worker; return {...rest,averageLatencyMs:worker.completedJobs ? Number(totalLatencyMs)/worker.completedJobs : 0,modelAvailable:worker.model.installed}; }

async function enqueue(description:string,source:'search'|'background') {
  const normalized = normalizeQuery(description);
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${normalized}))::text`;
    const image = await tx.image.findFirst({where:{normalizedSearch:normalized},orderBy:{createdAt:'desc'}});
    if (image) return {image:imageView(image)};
    const existing = await tx.generationJob.findFirst({where:{normalizedSearch:normalized,status:{in:['queued','generating','saving']}},orderBy:{createdAt:'desc'}});
    if (existing) return {job:existing};
    const job = await tx.generationJob.create({data:{normalizedSearch:normalized,originalQuery:description,source}});
    return {job};
  });
  if ('job' in result && result.job) {
    // Idempotent BullMQ job ID also lets retries repair a DB/Redis handoff gap.
    await queue.add('generate',{dbJobId:result.job.id},{jobId:result.job.id,priority:source==='search'?1:10,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:{age:86400},removeOnFail:{age:604800}});
  }
  return result;
}

app.get('/api/health',asyncRoute(async(_req,res)=>{
  await db.$queryRaw`SELECT 1`; await redis.ping();
  res.json({status:'ok',database:'ok',redis:'ok'});
}));
app.get('/api/images',asyncRoute(async(req,res)=>{
  const page=pageSchema.parse(req.query.page);
  const [items,total]=await Promise.all([db.image.findMany({orderBy:{createdAt:'desc'},skip:(page-1)*50,take:50}),db.image.count()]);
  res.json({items:items.map(imageView),page,pageSize:50,total,pages:Math.ceil(total/50)});
}));
app.get('/api/images/search',asyncRoute(async(req,res)=>{
  const q=z.string().parse(req.query.q);
  const result=await enqueue(q,'search');
  res.status('image' in result?200:202).json(result);
}));
app.get('/api/images/:id',asyncRoute(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const image=await db.image.findUnique({where:{id}});
  if (!image) return res.status(404).json({error:{code:'NOT_FOUND',message:'Image not found'}});
  res.json(imageView(image));
}));
app.get('/api/images/:id/file',asyncRoute(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const image=await db.image.findUnique({where:{id}});
  if (!image) return res.status(404).end();
  const root=path.resolve(process.env.IMAGE_ROOT || 'storage/images');
  const full=path.resolve(root,image.storagePath);
  if (!full.startsWith(root+path.sep) || !existsSync(full)) return res.status(404).end();
  res.type('png').set('Cache-Control','public, max-age=31536000, immutable');
  createReadStream(full).pipe(res);
}));
app.get('/api/stats',asyncRoute(async(_req,res)=>{
  const [images,completed,failed,workers,queueCounts]=await Promise.all([db.image.count(),db.generationJob.count({where:{status:'completed'}}),db.generationJob.count({where:{status:'failed'}}),db.aiWorker.findMany({include:{model:true}}),queue.getJobCounts('waiting','active','delayed','prioritized')]);
  res.json({images,completed,failed,queue:queueCounts,workers:workers.map(workerView)});
}));
app.get('/api/workers',asyncRoute(async(_req,res)=>res.json((await db.aiWorker.findMany({include:{model:true}})).map(workerView))));
app.get('/api/workers/:id',asyncRoute(async(req,res)=>{
  const worker=await db.aiWorker.findUnique({where:{id:z.string().parse(req.params.id)},include:{model:true}});
  if (!worker) return res.status(404).json({error:{code:'NOT_FOUND',message:'Worker not found'}});
  res.json(workerView(worker));
}));
app.post('/api/generation/jobs',asyncRoute(async(req,res)=>{
  const {description}=z.object({description:z.string()}).strict().parse(req.body);
  res.status(202).json(await enqueue(description,'search'));
}));
app.get('/api/generation/jobs/:id',asyncRoute(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const job=await db.generationJob.findUnique({where:{id},include:{image:true}});
  if (!job) return res.status(404).json({error:{code:'NOT_FOUND',message:'Job not found'}});
  res.json({...job,image:job.image?imageView(job.image):null});
}));
app.get('/api/events',asyncRoute(async(req,res)=>{
  const jobId=req.query.jobId ? z.string().uuid().parse(req.query.jobId) : undefined;
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});
  let last='';
  const tick=async()=>{
    try {
      const payload=jobId ? await db.generationJob.findUnique({where:{id:jobId},include:{image:true}}) : await db.image.findFirst({orderBy:{createdAt:'desc'},select:{id:true,createdAt:true}});
      const value=JSON.stringify(payload);
      if (value!==last) { res.write(`event: ${jobId?'job':'gallery'}\ndata: ${value}\n\n`); last=value; }
      else res.write(': keepalive\n\n');
    } catch(e) { console.error(JSON.stringify({level:'error',message:'sse tick failed',error:String(e)})); }
  };
  await tick(); const timer=setInterval(tick,2500); req.on('close',()=>clearInterval(timer));
}));
app.post('/api/scheduler/pause',admin,asyncRoute(async(_req,res)=>res.json(await db.schedulerState.upsert({where:{id:1},update:{paused:true},create:{id:1,paused:true}}))));
app.post('/api/scheduler/resume',admin,asyncRoute(async(_req,res)=>res.json(await db.schedulerState.upsert({where:{id:1},update:{paused:false},create:{id:1,paused:false}}))));
app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  const validation=error instanceof ZodError;
  console.error(JSON.stringify({level:'error',message:validation?'validation failed':'request failed',error:String(error)}));
  res.status(validation?400:500).json({error:{code:validation?'VALIDATION_ERROR':'INTERNAL_ERROR',message:validation?'Invalid request':'Request failed',details:validation?error.flatten():undefined}});
});
const server=app.listen(Number(process.env.API_PORT||3101),'0.0.0.0',()=>console.log(JSON.stringify({level:'info',message:'API ready',port:process.env.API_PORT||3101})));
const staleRemoteTimer=setInterval(async()=>{
  try {
    const cutoff=new Date(Date.now()-90_000);
    const stale=await db.aiWorker.findMany({where:{modelId:{startsWith:'remote-'},status:{in:['generating','idle']},lastHeartbeat:{lt:cutoff}}});
    for(const worker of stale) {
      if(worker.currentJobId) {
        const changed=await db.generationJob.updateMany({where:{id:worker.currentJobId,workerId:worker.id,status:'generating'},data:{status:'queued',workerId:null,error:'Remote worker heartbeat expired'}});
        if(changed.count) await recoverQueuedJob(db,queue,worker.currentJobId);
      }
      await db.aiWorker.update({where:{id:worker.id},data:{status:'offline',currentJobId:null}});
    }
    const orphaned=await db.generationJob.findMany({where:{status:'queued',updatedAt:{lt:new Date(Date.now()-60_000)}},take:20,select:{id:true}});
    for(const job of orphaned) await recoverQueuedJob(db,queue,job.id);
  } catch(error) { console.error(JSON.stringify({level:'error',message:'stale remote worker check failed',error:String(error)})); }
},30000);
async function shutdown(){clearInterval(staleRemoteTimer);server.close();await queue.close();await redis.quit();await db.$disconnect();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
export {app,enqueue};
