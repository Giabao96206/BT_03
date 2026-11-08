import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const db=new PrismaClient();
const base=process.env.API_URL||'http://127.0.0.1:3101';
const request=async(path,options)=>{const response=await fetch(base+path,options);return {status:response.status,body:await response.json()};};
try {
  const page=await request('/api/images?page=1');
  assert.equal(page.status,200);assert.ok(page.body.items.length>0);assert.ok(page.body.items.length<=50);
  for(let i=1;i<page.body.items.length;i++)assert.ok(new Date(page.body.items[i-1].createdAt)>=new Date(page.body.items[i].createdAt));
  const image=page.body.items.find(item=>item.englishDescription==='black dog')||page.body.items[0];
  assert.match(image.storagePath,/^.+ \d+\.\d+-[a-f0-9]{8}\.png$/);
  assert.equal(image.width,512);assert.equal(image.height,512);assert.ok(image.latencyMs>0);
  assert.ok(image.prompt.includes('Ukiyo-e'));assert.ok(image.loraName.endsWith('.safetensors'));
  const found=await request('/api/images/search?q='+encodeURIComponent(image.englishDescription));
  assert.equal(found.status,200);assert.equal(found.body.image.id,image.id);
  const binary=await fetch(base+image.url);assert.equal(binary.status,200);
  const bytes=new Uint8Array(await binary.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
  const stats=await request('/api/stats');assert.equal(stats.status,200);assert.equal(stats.body.images,await db.image.count());
  const worker=stats.body.workers.find(item=>item.id===image.workerId);assert.ok(worker.completedJobs>0);assert.ok(worker.averageLatencyMs>0);
  const heartbeat=await db.workerHeartbeat.findFirst({where:{workerId:image.workerId},orderBy:{createdAt:'desc'}});
  assert.ok(heartbeat);assert.ok(Date.now()-heartbeat.createdAt.getTime()<60000);
  assert.ok(await db.generationJob.count({where:{source:'background',status:'completed'}})>0);
  const failed=await db.generationJob.findFirst({where:{status:'failed'}});assert.ok(failed?.error);
  const complete=await db.generationJob.findFirst({where:{imageId:image.id}});assert.equal(complete?.status,'completed');
  const forbidden=await request('/api/scheduler/pause',{method:'POST'});assert.equal(forbidden.status,403);
  const headers={Authorization:`Bearer ${process.env.ADMIN_TOKEN}`};
  const paused=await request('/api/scheduler/pause',{method:'POST',headers});assert.equal(paused.body.paused,true);
  const resumed=await request('/api/scheduler/resume',{method:'POST',headers});assert.equal(resumed.body.paused,false);
  console.log('Integration passed: metadata, naming, pagination, existing search, PNG, counts, heartbeat, background job, failure, admin security.');
} finally {await db.$disconnect();}
