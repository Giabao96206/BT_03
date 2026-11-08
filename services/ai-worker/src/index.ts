import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { filename,promptFor } from '@bt03/shared';

const id=process.env.WORKER_ID || '1.1';
const enabled=process.env[`WORKER_${id.replace('.','')}_ENABLED`] !== 'false';
const modelId=id==='1.1'?'sd15':'second';
const checkpoint=id==='1.1'?process.env.MODEL_11:process.env.MODEL_12;
const db=new PrismaClient();
const redis=new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:56379',{maxRetriesPerRequest:null});
const lockKey='bt03:inference:lock';
const log=(level:string,message:string,extra={})=>console.log(JSON.stringify({level,message,workerId:id,...extra}));
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let running=true;

async function heartbeat(status:string) {
  const current=await db.aiWorker.findUnique({where:{id},select:{currentJobId:true,status:true}});
  const effective=current?.currentJobId ? current.status : status;
  await db.aiWorker.update({where:{id},data:{status:effective,lastHeartbeat:new Date()}});
  await db.workerHeartbeat.create({data:{workerId:id,status:effective}});
}
async function acquire(token:string) {
  while(running) {
    if (await redis.set(lockKey,token,'PX',60000,'NX')==='OK') return;
    await delay(1000);
  }
  throw new Error('Shutting down');
}
const renewScript="if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],60000) else return 0 end";
const releaseScript="if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
function runAdapter(payload:object):Promise<any> {
  return new Promise((resolve,reject)=>{
    const python=path.join(process.env.FASTSD_PATH || '', 'env/bin/python');
    const script=path.resolve(__dirname,'../../fastsd-adapter/generate.py');
    const child=spawn(python,[script],{stdio:['pipe','pipe','pipe'],env:process.env});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Inference timeout'));},Number(process.env.JOB_TIMEOUT_MS||900000));
    child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>2_000_000) stdout=stdout.slice(-1_000_000);});
    child.stderr.on('data',data=>{stderr+=data.toString();if(stderr.length>500_000) stderr=stderr.slice(-250_000);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      const line=stdout.split('\n').reverse().find(value=>value.startsWith('BT03_RESULT '));
      if (!line) return reject(new Error(`Adapter exit ${code}: ${stderr.slice(-1000)} ${stdout.slice(-500)}`));
      try { const result=JSON.parse(line.slice(12)); if(result.error) reject(new Error(result.error)); else if(code!==0) reject(new Error(`Adapter exited ${code}`)); else resolve(result); } catch(error) {reject(error);}
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
async function processJob(job:Job<{dbJobId:string}>) {
  const record=await db.generationJob.findUnique({where:{id:job.data.dbJobId}});
  if (!record || record.status!=='queued') return;
  if (!checkpoint) throw new Error(`Model for worker ${id} is unavailable`);
  const token=randomUUID(); await acquire(token);
  const renew=setInterval(()=>void redis.eval(renewScript,1,lockKey,token).catch(e=>log('error','lock renewal failed',{error:String(e)})),15000);
  try {
    // Recheck after waiting: another worker may already have completed this search.
    const existing=await db.image.findFirst({where:{normalizedSearch:record.normalizedSearch},orderBy:{createdAt:'desc'}});
    if (existing) { await db.generationJob.updateMany({where:{id:record.id,status:'queued'},data:{status:'completed',imageId:existing.id}}); return; }
    const claimed=await db.generationJob.updateMany({where:{id:record.id,status:'queued'},data:{status:'generating',workerId:id,error:null}});
    if (!claimed.count) return;
    await db.$transaction([
      db.aiWorker.update({where:{id},data:{status:'generating',modelLoadState:'loading',currentJobId:record.id}}),
      db.generationLog.create({data:{jobId:record.id,workerId:id,level:'info',message:'Generation started'}})
    ]);
    const name=filename(record.normalizedSearch,id,record.id.slice(0,8));
    const prompt=promptFor(record.normalizedSearch);
    const seed=Math.floor(Math.random()*2147483647);
    const payload={checkpoint,lcmLora:process.env.LCM_LORA||'latent-consistency/lcm-lora-sdv1-5',styleLora:process.env.STYLE_LORA,prompt,negativePrompt:process.env.NEGATIVE_PROMPT||'',width:Number(process.env.IMAGE_WIDTH||512),height:Number(process.env.IMAGE_HEIGHT||512),steps:Number(process.env.INFERENCE_STEPS||4),guidance:Number(process.env.GUIDANCE_SCALE||1),styleWeight:Number(process.env.STYLE_LORA_WEIGHT||0.7),seed,output:path.join(process.env.IMAGE_ROOT||'',name)};
    const result=await runAdapter(payload);
    await db.generationJob.update({where:{id:record.id},data:{status:'saving'}});
    await db.$transaction(async tx=>{
      const image=await tx.image.create({data:{englishDescription:record.normalizedSearch,originalQuery:record.originalQuery,normalizedSearch:record.normalizedSearch,prompt,negativePrompt:payload.negativePrompt,workerId:id,modelId,checkpoint,loraName:path.basename(payload.styleLora||''),seed,width:payload.width,height:payload.height,steps:payload.steps,guidanceScale:payload.guidance,latencyMs:Math.round(result.latencyMs),storagePath:name}});
      await tx.generationJob.update({where:{id:record.id},data:{status:'completed',imageId:image.id}});
      await tx.aiWorker.update({where:{id},data:{status:'idle',modelLoadState:'unloaded',currentJobId:null,completedJobs:{increment:1},totalLatencyMs:{increment:BigInt(Math.round(result.latencyMs))}}});
      await tx.generationLog.create({data:{jobId:record.id,workerId:id,level:'info',message:'Image saved'}});
    });
    log('info','completed',{jobId:record.id,latencyMs:result.latencyMs});
  } catch(error) {
    const final=job.attemptsMade+1 >= (job.opts.attempts||1);
    await db.$transaction([
      db.generationJob.update({where:{id:record.id},data:{status:final?'failed':'queued',workerId:final?id:null,error:String(error)}}),
      db.aiWorker.update({where:{id},data:{status:'idle',modelLoadState:'unloaded',currentJobId:null,failedJobs:{increment:1}}}),
      db.generationLog.create({data:{jobId:record.id,workerId:id,level:'error',message:String(error)}})
    ]);
    log('error','generation failed',{jobId:record.id,error:String(error)});
    throw error;
  } finally { clearInterval(renew);await redis.eval(releaseScript,1,lockKey,token); }
}
async function main() {
  const queue=new Queue('bt03-generation',{connection:redis});
  for(const stale of await db.generationJob.findMany({where:{status:{in:['generating','saving']},workerId:id}})) {
    const queued=await queue.getJob(stale.id);
    const state=queued ? await queued.getState() : 'unknown';
    if(state==='failed'||state==='unknown') await db.generationJob.update({where:{id:stale.id},data:{status:'failed',error:'Worker stopped before completion'}});
  }
  await queue.close();
  await heartbeat(enabled&&checkpoint?'idle':'unavailable');
  const timer=setInterval(()=>void heartbeat(enabled&&checkpoint?'idle':'unavailable').catch(e=>log('error','heartbeat failed',{error:String(e)})),10000);
  if (!enabled||!checkpoint) { log('warn','worker unavailable: configure distinct checkpoint and enable it'); return; }
  const worker=new Worker('bt03-generation',processJob,{connection:redis,concurrency:1,lockDuration:120000});
  worker.on('error',error=>log('error','queue error',{error:String(error)}));
  worker.on('failed',(job,error)=>{if(job)void job.getState().then(state=>{
    if(state==='failed')return db.generationJob.update({where:{id:job.data.dbJobId},data:{status:'failed',error:String(error)}});
  }).catch(e=>log('error','failed-job reconciliation failed',{error:String(e)}));});
  const shutdown=async()=>{running=false;clearInterval(timer);await worker.close();await heartbeat('offline');await redis.quit();await db.$disconnect();};
  process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
}
main().catch(error=>{log('error','startup failed',{error:String(error)});process.exit(1);});
