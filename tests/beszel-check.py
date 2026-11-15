"""Read-only verification of the local Beszel hub/agent, without printing secrets."""
import json
import urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
config=dict(line.split('=',1) for line in (root/'.env.beszel').read_text().splitlines() if '=' in line and not line.startswith('#'))
base='http://127.0.0.1:8090'
token=''


def call(path,data=None):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']=token
    req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
    with urllib.request.urlopen(req,timeout=20) as res:return json.load(res)


assert call('/api/health')['code']==200
token=call('/api/collections/users/auth-with-password',{'identity':config['USER_EMAIL'],'password':config['USER_PASSWORD']})['token']
systems=call('/api/collections/systems/records')['items']
local=next(s for s in systems if s['name']=='db1 / worker 1.1')
assert local['status']=='up',local['status']
stats=call('/api/collections/system_stats/records?perPage=1&sort=-created&filter=system%3D%22'+local['id']+'%22')['items']
assert stats,'Agent has not sent a metrics record yet'
print(json.dumps({'system':local['name'],'status':local['status'],'info':local.get('info'),'latestMetrics':stats[0]},ensure_ascii=False))
