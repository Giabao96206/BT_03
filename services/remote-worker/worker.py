"""Remote FastSD CPU worker. Only the central HTTPS/Tailscale API is reachable."""
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

API = os.environ['CENTRAL_API_URL'].rstrip('/') + '/api/internal/remote'
WORKER_ID = os.environ['WORKER_ID']
TOKEN = os.environ['WORKER_TOKEN']
ROOT = pathlib.Path('/tmp/bt03-output')
ROOT.mkdir(exist_ok=True)

def request(route, data=None, png=False, metadata=None):
    headers={'Authorization':'Bearer '+TOKEN,'X-Worker-Id':WORKER_ID}
    if png:
        headers['Content-Type']='image/png'
        headers['X-Job-Result']=json.dumps(metadata,separators=(',',':'))
        body=data
    elif data is None:
        body=b''
    else:
        headers['Content-Type']='application/json'
        body=json.dumps(data).encode()
    call=urllib.request.Request(API+route,data=body,headers=headers,method='POST')
    try:
        with urllib.request.urlopen(call,timeout=120) as response:
            return json.loads(response.read()) if response.status!=204 else None
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'API {route}: {error.code} {error.read(500).decode(errors="replace")}') from error

def heartbeat(stop):
    while not stop.wait(10):
        try: request('/heartbeat')
        except Exception as error: print(f'heartbeat failed: {error}',flush=True)

def generate(job):
    output=ROOT/(job['jobId']+'.png')
    payload={key:job[key] for key in ('checkpoint','lcmLora','prompt','negativePrompt','width','height','steps','guidance','styleWeight','seed')}
    payload['styleLora']=os.environ.get('STYLE_LORA','/opt/fastsdcpu/lora_models/hokusai_ukiyoe.safetensors')
    payload['output']=str(output)
    run=subprocess.run([sys.executable,'/opt/bt03/generate.py'],input=json.dumps(payload),text=True,capture_output=True,timeout=int(os.environ.get('JOB_TIMEOUT_SECONDS','1800')))
    line=next((line[12:] for line in reversed(run.stdout.splitlines()) if line.startswith('BT03_RESULT ')),None)
    if not line: raise RuntimeError(f'FastSD exit {run.returncode}: {run.stderr[-1000:]}')
    result=json.loads(line)
    if run.returncode or 'error' in result: raise RuntimeError(result.get('error',run.stderr[-1000:]))
    print(json.dumps({'event':'inference-config','cpuThreads':result.get('cpuThreads')}),flush=True)
    metadata={key:result[key] for key in ('latencyMs','width','height')}
    metadata.update(jobId=job['jobId'],seed=job['seed'])
    try:
        body=output.read_bytes()
        for attempt in range(3):
            try: return request('/complete',body,png=True,metadata=metadata)
            except Exception:
                if attempt==2: raise
                time.sleep(5*(attempt+1))
    finally: output.unlink(missing_ok=True)

def main():
    checkpoint=os.environ.get('MODEL_CHECKPOINT','stable-diffusion-v1-5/stable-diffusion-v1-5')
    member=os.environ.get('MEMBER_NAME',WORKER_ID)
    while True:
        try: request('/register',{'checkpoint':checkpoint,'memberName':member});break
        except Exception as error: print(f'registration failed: {error}',flush=True);time.sleep(10)
    stop=threading.Event()
    threading.Thread(target=heartbeat,args=(stop,),daemon=True).start()
    try:
        while True:
            try:
                job=request('/claim')
                if job:
                    print(json.dumps({'event':'claimed','jobId':job['jobId'],'description':job['description']}),flush=True)
                    try:
                        print(json.dumps({'event':'completed','result':generate(job)}),flush=True)
                        if os.environ.get('RUN_ONCE')=='1': break
                    except Exception as error:
                        (ROOT/(job['jobId']+'.png')).unlink(missing_ok=True)
                        print(json.dumps({'event':'failed','jobId':job['jobId'],'error':str(error)}),flush=True)
                        try: request('/fail',{'jobId':job['jobId'],'error':str(error)[:1000]})
                        except Exception as report_error: print(f'failed to report error: {report_error}',flush=True)
                        time.sleep(20)
                else: time.sleep(5)
            except Exception as error: print(f'worker loop: {error}',flush=True);time.sleep(10)
    finally: stop.set()

if __name__=='__main__': main()
