'use client';
import {useEffect,useState} from 'react';
type CurrentJob={id:string;normalizedSearch:string;status:string;source:string;updatedAt:string};
type LastImage={id:string;englishDescription:string;latencyMs:number;createdAt:string;url:string};
type Worker={id:string;registered:boolean;status:string;online:boolean;completedJobs:number;failedJobs:number;averageLatencyMs:number;lastHeartbeat:string|null;modelAvailable:boolean;currentJob:CurrentJob|null;imagesLast24Hours:number;lastImage:LastImage|null};
type Stats={images:number;completed:number;failed:number;queue:Record<string,number>;workers:Worker[];generation:{queued:number;generating:number;saving:number;unassignedActive:number};monitoring:{beszelUrl:string};capturedAt:string};
type Health={status:string;database:string;redis:string};
const statusLabels:Record<string,string>={idle:'Đang rảnh',generating:'Đang sinh ảnh',saving:'Đang lưu ảnh',offline:'Mất kết nối',unavailable:'Chưa sẵn sàng'};
const statusLabel=(status:string)=>statusLabels[status]||status;
const dateLabel=(value:string|null)=>value?new Date(value).toLocaleString('vi-VN'):'Chưa có';
export default function Monitoring(){
  const [stats,setStats]=useState<Stats|null>(null),[health,setHealth]=useState<Health|null>(null),[error,setError]=useState('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    let active=true;
    async function refresh(){try{
      const [a,b]=await Promise.all([fetch('/api/health',{cache:'no-store'}),fetch('/api/stats',{cache:'no-store'})]);
      if(!a.ok||!b.ok)throw new Error('Không đọc được dữ liệu giám sát.');
      const [h,s]=await Promise.all([a.json(),b.json()]);if(active){setHealth(h);setStats(s);setError('');}
    }catch(e){if(active)setError(String(e));}}
    void refresh();const timer=setInterval(()=>void refresh(),5000);const clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;clearInterval(timer);clearInterval(clock);};
  },[]);
  const workers=stats?.workers||[];
  const isOnline=(w:Worker)=>w.online&&!!w.lastHeartbeat&&now-new Date(w.lastHeartbeat).getTime()<90_000;
  const completed=workers.reduce((n,w)=>n+w.completedJobs,0);
  const average=completed?Math.round(workers.reduce((n,w)=>n+w.averageLatencyMs*w.completedJobs,0)/completed/1000):0;
  const cards=[['API',health?.status||'—'],['PostgreSQL',health?.database||'—'],['Redis',health?.redis||'—'],['Máy online',`${workers.filter(isOnline).length}/${workers.length}`],['Tổng ảnh',stats?.images??'—'],['Job chờ',stats?.generation?.queued??'—'],['Job đang sinh',stats?.generation?.generating??'—'],['Đang lưu',stats?.generation?.saving??'—'],['Job thất bại',stats?.failed??'—'],['Sinh ảnh trung bình',`${average}s`]];
  const beszelUrl=stats?.monitoring?.beszelUrl;
  return <main className="min-h-screen wood">
    <header className="bg-ink text-paper px-5 py-4"><div className="max-w-6xl mx-auto flex justify-between gap-4"><span className="uppercase tracking-[.2em] text-xs">BT—03 / Giám sát worker</span><a href="/" className="underline text-xs">Kho ảnh</a></div></header>
    <div className="max-w-6xl mx-auto px-5 py-10">
      <p className="text-vermillion text-xs tracking-[.3em] uppercase">Server và các máy thành viên</p>
      <h1 className="text-4xl md:text-5xl mt-3">Giám sát sinh ảnh</h1>
      <p className="text-ink/70 mt-3">Cập nhật mỗi 5 giây. Offline khi quá 90 giây không có heartbeat.</p>
      <section className="bg-white border border-[#d9ceb9] p-6 mt-7" aria-label="Giám sát tài nguyên Beszel">
        <div className="flex flex-wrap justify-between items-center gap-4"><div><h2 className="text-2xl">Tài nguyên máy · Beszel</h2><p className="text-sm text-ink/70 mt-2">CPU, RAM, swap, ổ đĩa, lưu lượng mạng và container theo từng máy.</p></div>{beszelUrl&&/^https?:\/\//.test(beszelUrl)&&<a href={beszelUrl} target="_blank" rel="noopener noreferrer" className="bg-vermillion text-white px-5 py-3 text-sm">Mở Beszel ↗</a>}</div>
        <p className="text-xs text-ink/60 mt-4">Mỗi máy cần cài Beszel Agent riêng. Wi-Fi chỉ có số liệu khi hệ điều hành thấy card Wi-Fi thật; máy ảo thường chỉ có Ethernet ảo. Tên máy trong Beszel nên đặt theo mã worker.</p>
      </section>
      {error&&<p role="alert" className="mt-6 text-vermillion">{error} Số liệu bên dưới có thể đã cũ.</p>}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-7" aria-label="Thống kê hệ thống">{cards.map(([label,value])=><div key={label} className="bg-white border border-[#d9ceb9] p-4"><p className="text-xs uppercase tracking-widest text-ink/60">{label}</p><p className="text-2xl mt-3">{value}</p></div>)}</section>
      {!!stats?.generation?.unassignedActive&&<p role="alert" className="mt-5 border-l-4 border-vermillion bg-white p-4 text-sm">Có {stats.generation.unassignedActive} job ghi đang chạy nhưng không gắn với currentJobId của worker nào. Cần kiểm tra đối soát hàng đợi; đây không phải job đang được một máy xác nhận xử lý.</p>}
      <h2 className="text-3xl mt-10 mb-2">Các worker AI · {workers.length} máy</h2>
      <p className="text-sm text-ink/60 mb-5">Đã đăng ký: {workers.filter(w=>w.registered).length}/{workers.length}. Máy chưa kết nối lần đầu vẫn được hiển thị trong danh sách nhóm.</p>
      <section className="grid md:grid-cols-2 gap-5">{workers.map(worker=>{
        const online=isOnline(worker),job=worker.currentJob;
        const elapsed=job?Math.max(0,Math.floor((now-new Date(job.updatedAt).getTime())/1000)):0;
        return <article key={worker.id} className="bg-white border border-[#d9ceb9] p-6">
          <div className="flex justify-between gap-3"><h3 className="text-2xl">Worker {worker.id}</h3><span className={`text-sm ${online?'text-emerald-700':'text-ink/50'}`}>{!worker.registered?'○ Chưa đăng ký':online?'● Online':'○ Offline'}</span></div>
          <p className="text-vermillion mt-2">{!worker.registered?'Chưa kết nối lần đầu':online?statusLabel(worker.status):'Mất kết nối'}</p>
          <dl className="grid grid-cols-2 gap-3 mt-5 text-sm"><div><dt className="text-ink/60">Ảnh đã sinh</dt><dd className="text-2xl">{worker.completedJobs}</dd></div><div><dt className="text-ink/60">Ảnh trong 24 giờ</dt><dd className="text-2xl">{worker.imagesLast24Hours??0}</dd></div><div><dt className="text-ink/60">Lượt xử lý lỗi</dt><dd>{worker.failedJobs}</dd></div><div><dt className="text-ink/60">Thời gian trung bình</dt><dd>{(worker.averageLatencyMs/1000).toFixed(1)} giây</dd></div></dl>
          <div className="bg-[#f5f0e4] p-4 mt-5"><p className="text-xs uppercase tracking-widest">Job hiện tại</p>{job?<><p className="mt-2 font-medium break-words">{job.normalizedSearch}</p><p className="text-sm mt-2">{job.source==='search'?'Yêu cầu người dùng':'Sinh ảnh nền'} · {statusLabel(job.status)}</p><p className="text-sm mt-1">Đã ở trạng thái này: {elapsed}s{!online?' · máy đã mất heartbeat':''}</p><p className="text-xs text-ink/60 mt-2 break-all">{job.id}</p></>:<p className="text-sm text-ink/60 mt-2">{online?'Chờ nhận việc mới.':'Không có job đang được máy xác nhận.'}</p>}</div>
          <p className="text-xs text-ink/60 mt-4">Heartbeat: {dateLabel(worker.lastHeartbeat)}</p>
          {worker.lastImage&&<div className="border-t border-[#d9ceb9] mt-4 pt-4 text-sm"><p className="text-xs text-ink/60">Ảnh hoàn tất gần nhất</p><a href={worker.lastImage.url} target="_blank" rel="noopener noreferrer" className="underline block mt-1 break-words">{worker.lastImage.englishDescription}</a><p className="text-xs text-ink/60 mt-1">{dateLabel(worker.lastImage.createdAt)} · {(worker.lastImage.latencyMs/1000).toFixed(1)}s</p></div>}
          {!worker.registered?<p className="text-xs text-ink/60 mt-3">Chưa có dữ liệu từ máy này. Cấu hình đúng WORKER_ID={worker.id}, token riêng và địa chỉ API trên máy thành viên; thẻ này tự cập nhật khi kết nối thành công.</p>:!worker.modelAvailable&&<p className="text-xs text-vermillion mt-3">Model chưa sẵn sàng.</p>}
        </article>;
      })}</section>
      <p className="text-xs text-ink/60 mt-6">Thời gian chạy không phải phần trăm hoàn thành. Worker v2/v3 chưa gửi số bước diffusion, nên trang không suy đoán % tiến độ. Chỉ số job lấy từ PostgreSQL; queue BullMQ riêng có {stats?.queue?.active??0} job active.</p>
      <p className="text-xs text-ink/50 mt-3">Lần đọc dữ liệu: {dateLabel(stats?.capturedAt||null)}. Uptime Kuma: localhost:3301.</p>
    </div>
  </main>;
}
