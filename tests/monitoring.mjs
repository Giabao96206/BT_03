// Read-only integration checks against the deployed API and its actual DB.
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
const base=process.env.API_URL||'http://127.0.0.1:3101';
try {
  const response=await fetch(base+'/api/stats');
  assert.equal(response.status,200);
  const stats=await response.json();
  assert.match(stats.monitoring.beszelUrl,/^https?:\/\//);
  assert.ok(Date.now()-Date.parse(stats.capturedAt)<15_000);
  assert.equal(typeof stats.generation.unassignedActive,'number');
  for(const worker of stats.workers){
    assert.equal(typeof worker.online,'boolean');
    assert.ok(Number.isInteger(worker.imagesLast24Hours)&&worker.imagesLast24Hours>=0);
    if(worker.lastImage){
      const image=await db.image.findUnique({where:{id:worker.lastImage.id}});
      assert.equal(image.workerId,worker.id);
      assert.equal(image.englishDescription,worker.lastImage.englishDescription);
      assert.equal(worker.lastImage.url,`/api/images/${image.id}/file`);
    }
    if(worker.currentJob){
      const job=await db.generationJob.findUnique({where:{id:worker.currentJob.id}});
      assert.equal(worker.currentJob.id,worker.currentJobId);
      assert.equal(job.workerId,worker.id);
      assert.equal(job.normalizedSearch,worker.currentJob.normalizedSearch);
    }
  }
  console.log('Monitoring passed: real job ownership, last-image provenance, 24h counters, heartbeat fields and Beszel URL.');
} finally {await db.$disconnect();}
