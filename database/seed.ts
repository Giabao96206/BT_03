import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
const db = new PrismaClient();
const registry=JSON.parse(readFileSync('configs/models/registry.json','utf8')) as {workers:{id:string;memberId:string;modelId:string;checkpointEnv:string;defaultCheckpoint:string|null}[]};
async function main() {
  await db.member.upsert({where:{id:'1'},update:{},create:{id:'1',name:'Member 1'}});
  const checkpoints=registry.workers.map(worker=>process.env[worker.checkpointEnv] || worker.defaultCheckpoint || 'UNCONFIGURED');
  if(checkpoints[0]===checkpoints[1]) throw new Error('Worker 1.2 must use a distinct model checkpoint');
  for (const [index,worker] of registry.workers.entries()) {
    const checkpoint=checkpoints[index],installed=checkpoint!=='UNCONFIGURED';
    const lcmLora=process.env.LCM_LORA || 'latent-consistency/lcm-lora-sdv1-5';
    const styleLora=process.env.STYLE_LORA || 'hokusai_ukiyoe.safetensors';
    await db.aiModel.upsert({where:{id:worker.modelId},update:checkpoint==='UNCONFIGURED'?{}:{checkpoint,installed,lcmLora,styleLora},create:{id:worker.modelId,checkpoint,installed,lcmLora,styleLora}});
    await db.aiWorker.upsert({where:{id:worker.id},update:checkpoint==='UNCONFIGURED'?{}:{modelId:worker.modelId},create:{id:worker.id,memberId:worker.memberId,modelId:worker.modelId,status:'offline'}});
  }
  await db.schedulerState.upsert({where:{id:1},update:{},create:{id:1}});
}
main().finally(()=>db.$disconnect());
