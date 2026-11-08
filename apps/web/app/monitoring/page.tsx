'use client';
import {useEffect,useState} from 'react';
type Worker={id:string;status:string;completedJobs:number;failedJobs:number;averageLatencyMs:number;lastHeartbeat:string|null;modelAvailable:boolean};
type Stats={images:number;completed:number;failed:number;queue:Record<string,number>;workers:Worker[]};
type Health={status:string;database:string;redis:string};
export default function Monitoring(){
  const [stats,setStats]=useState<Stats|null>(null),[health,setHealth]=useState<Health|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    async function refresh(){try{const [a,b]=await Promise.all([fetch('/api/health'),fetch('/api/stats')]);if(!a.ok||!b.ok)throw new Error('A service is unavailable');const [h,s]=await Promise.all([a.json(),b.json()]);if(active){setHealth(h);setStats(s);setError('');}}catch(e){if(active)setError(String(e));}}
    void refresh();const timer=setInterval(()=>void refresh(),10000);return()=>{active=false;clearInterval(timer);};
  },[]);
  const queue=stats?.queue||{};
  const queued=(queue.waiting||0)+(queue.prioritized||0)+(queue.delayed||0);
  const completed=stats?.workers.reduce((n,w)=>n+w.completedJobs,0)||0;
  const average=completed?Math.round((stats?.workers.reduce((n,w)=>n+w.averageLatencyMs*w.completedJobs,0)||0)/completed/1000):0;
  const cards=[['Website','online'],['API',health?.status||'unknown'],['PostgreSQL',health?.database||'unknown'],['Redis',health?.redis||'unknown'],['Queue waiting',queued],['Queue active',queue.active||0],['Images',stats?.images??'—'],['Successful generations',stats?.completed??'—'],['Failed generations',stats?.failed??'—'],['Average inference',`${average}s`]];
  return <main className="min-h-screen wood"><header className="bg-ink text-paper px-5 py-4"><div className="max-w-6xl mx-auto flex justify-between"><span className="uppercase tracking-[.2em] text-xs">BT—03 / System monitor</span><a href="/" className="underline text-xs">Gallery</a></div></header><div className="max-w-6xl mx-auto px-5 py-12"><p className="text-vermillion text-xs tracking-[.3em] uppercase">Live on db1</p><h1 className="text-4xl md:text-5xl mt-3">Studio status</h1><p className="text-ink/60 mt-3">Refreshes every 10 seconds. Uptime Kuma is restricted to localhost on port 3301.</p>{error&&<p role="alert" className="mt-6 text-vermillion">{error}</p>}<section className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-10" aria-label="System metrics">{cards.map(([label,value])=><div key={label} className="bg-white border border-[#d9ceb9] p-5 card"><p className="text-xs uppercase tracking-widest text-ink/60">{label}</p><p className="text-2xl mt-3 capitalize">{value}</p></div>)}</section><h2 className="text-3xl mt-14 mb-5">AI workers</h2><section className="grid md:grid-cols-2 gap-4">{stats?.workers.map(worker=><div key={worker.id} className="bg-white border border-[#d9ceb9] p-6"><p className="text-xs text-vermillion tracking-widest uppercase">Worker {worker.id}</p><h3 className="text-2xl capitalize mt-2">{worker.status}</h3><p className="text-sm mt-4">{worker.completedJobs} completed · {worker.failedJobs} failed</p><p className="text-sm mt-2">Average {Math.round(worker.averageLatencyMs/1000)}s</p><p className="text-xs text-ink/60 mt-3">Heartbeat: {worker.lastHeartbeat?new Date(worker.lastHeartbeat).toLocaleString():'none'}</p>{!worker.modelAvailable&&<p className="text-xs text-vermillion mt-3">Distinct checkpoint pending</p>}</div>)}</section></div></main>;
}
