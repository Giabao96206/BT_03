import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {recoverOrphanedLocalJobs}=require('../apps/api/dist/remote.js');
const {filename}=require('@bt03/shared');
const root=await mkdtemp(path.join(tmpdir(),'bt03-recovery-'));
const previous=process.env.IMAGE_ROOT;
process.env.IMAGE_ROOT=root;
const jobs=['abandoned','owned','retry-active','recorded'].map(id=>({id,workerId:'1.1',normalizedSearch:'test wave',status:'generating',source:'background'}));
const added=[];
const db={
  aiWorker:{findMany:async()=>[{id:'1.1',currentJobId:'owned'}]},
  generationJob:{
    findMany:async()=>jobs.filter(job=>['generating','saving'].includes(job.status)),
    findUnique:async({where})=>jobs.find(job=>job.id===where.id),
    updateMany:async({where,data})=>{const job=jobs.find(job=>job.id===where.id);assert.equal(job.status,'generating');Object.assign(job,data);return {count:1};}
  },
  image:{findUnique:async({where})=>where.storagePath===filename('test wave','1.1','recorded')?{id:'saved'}:null}
};
const queue={getJobs:async()=>[{id:'retry-active-recovery-123',data:{dbJobId:'retry-active'}}],getJob:async()=>null,add:async(...args)=>added.push(args)};
try {
  const orphan=path.join(root,filename('test wave','1.1','abandone'));
  await writeFile(orphan,'preserved PNG');
  const recorded=path.join(root,filename('test wave','1.1','recorded'));
  await writeFile(recorded,'committed PNG');
  assert.deepEqual(await recoverOrphanedLocalJobs(db,queue),['abandoned']);
  assert.equal(jobs[1].status,'generating');
  assert.equal(jobs[2].status,'generating');
  assert.equal(jobs[3].status,'failed');
  assert.equal(added.length,1);
  assert.equal(added[0][1].dbJobId,'abandoned');
  const archived=await readdir(path.join(root,'.recovered'));
  assert.equal(archived.length,1);
  assert.equal(await readFile(path.join(root,'.recovered',archived[0]),'utf8'),'preserved PNG');
  assert.equal(await readFile(recorded,'utf8'),'committed PNG');
  assert.deepEqual(await recoverOrphanedLocalJobs(db,queue),[]);
  console.log('PASS: orphan recovery, active ownership, retry IDs, PNG preservation, committed images, idempotence');
} finally {
  if(previous===undefined) delete process.env.IMAGE_ROOT;else process.env.IMAGE_ROOT=previous;
  await rm(root,{recursive:true,force:true});
}
