import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { normalizeQuery } from '@bt03/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const db=new PrismaClient();
const redis=new IORedis(process.env.REDIS_URL||'redis://127.0.0.1:56379',{maxRetriesPerRequest:null});
const queue=new Queue('bt03-generation',{connection:redis});
const vocabulary=JSON.parse(readFileSync(path.resolve(__dirname,'../../../configs/prompts/vocabulary.json'),'utf8')) as Record<string,string[]>;
const words=Object.values(vocabulary).flat();
const settings=['beside a river','under cherry blossoms','near a shrine','at a mountain village','on a quiet street','in a misty forest','by a stone bridge','on a seaside path','under a moonlit sky','at dawn','at dusk','in the rain'];
const palettes=['in indigo and gold','in vermilion and cream','in teal and orange','in blue and white','in emerald and ochre','in violet and silver','in crimson and black','in sepia and gold'];
const seasons=['in spring','in summer','in autumn','in winter'];
const combinations=words.length*(words.length-1)*settings.length*palettes.length*seasons.length;
function composition(index:number):string {
  const edition=Math.floor(index/combinations)+1;
  let value=index%combinations;
  const subjectIndex=value%words.length;value=Math.floor(value/words.length);
  const companionIndex=(subjectIndex+1+value%(words.length-1))%words.length;value=Math.floor(value/(words.length-1));
  const setting=settings[value%settings.length];value=Math.floor(value/settings.length);
  const palette=palettes[value%palettes.length];value=Math.floor(value/palettes.length);
  const season=seasons[value%seasons.length];
  return `${words[subjectIndex]} with ${words[companionIndex]} ${setting} ${palette} ${season}${edition>1?` composition ${edition}`:''}`;
}
async function tick(){
  if(process.env.SCHEDULER_ENABLED==='false') return;
  const state=await db.schedulerState.findUnique({where:{id:1}});
  if(state?.paused) return;
  const active=await db.generationJob.count({where:{status:{in:['queued','generating','saving']}}});
  if(active>=Number(process.env.MAX_BACKGROUND_QUEUE||3)) return;
  for(let n=0;n<20;n++){
    const description=composition(Number(await redis.incr('bt03:scheduler:composition-cursor'))-1);
    const normalized=normalizeQuery(description);
    const result=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${normalized}))::text`;
      const exists=await tx.image.findFirst({where:{normalizedSearch:normalized},select:{id:true}});
      const active=await tx.generationJob.findFirst({where:{normalizedSearch:normalized,status:{in:['queued','generating','saving']}},select:{id:true}});
      const exhausted=await tx.generationJob.findFirst({where:{normalizedSearch:normalized,source:'background',status:'failed'},select:{id:true}});
      if(exists||active||exhausted) return null;
      return tx.generationJob.create({data:{normalizedSearch:normalized,originalQuery:description,source:'background'}});
    });
    if(result){
      await queue.add('generate',{dbJobId:result.id},{jobId:result.id,priority:10,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:{age:86400},removeOnFail:{age:604800}});
      console.log(JSON.stringify({level:'info',message:'background job queued',description,jobId:result.id}));
      break;
    }
  }
}
const timer=setInterval(()=>void tick().catch(error=>console.error(JSON.stringify({level:'error',message:'scheduler tick failed',error:String(error)}))),10000);
void tick();
async function shutdown(){clearInterval(timer);await queue.close();await redis.quit();await db.$disconnect();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
