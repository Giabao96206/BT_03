"""Register one host in the local Beszel Hub; save its private token locally."""
import argparse
import json
import os
import secrets
import urllib.parse
import urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name',default='db1 / worker 1.1')
parser.add_argument('--host',default='127.0.0.1')
parser.add_argument('--hub-url',default='http://127.0.0.1:8090')
parser.add_argument('--output',type=Path,default=root/'.env.beszel-agent')
args=parser.parse_args()
creds=dict(line.split('=',1) for line in (root/'.env.beszel').read_text().splitlines() if '=' in line and not line.startswith('#'))
auth=''


def call(path,data=None):
    headers={'Content-Type':'application/json'}
    if auth: headers['Authorization']=auth
    req=urllib.request.Request('http://127.0.0.1:8090'+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
    with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)


session=call('/api/collections/users/auth-with-password',{'identity':creds['USER_EMAIL'],'password':creds['USER_PASSWORD']})
auth=session['token']
info=call('/api/beszel/getkey')
key=info['key']
existing=call('/api/collections/systems/records?'+urllib.parse.urlencode({'filter':'name = '+json.dumps(args.name)}))['items']
if existing:
    system=existing[0]
else:
    system=call('/api/collections/systems/records',{'name':args.name,'host':args.host,'port':'45876','users':[session['record']['id']]})
fingerprints=call('/api/collections/fingerprints/records?'+urllib.parse.urlencode({'filter':'system = '+json.dumps(system['id'])}))['items']
if fingerprints:token=fingerprints[0]['token']
else:
    token=secrets.token_hex(32)
    call('/api/collections/fingerprints/records',{'system':system['id'],'token':token})
# Avoid printing tokens or overwriting a file for a different machine.
if args.output.exists():
    print(f'{args.output.name} exists; preserved. System: {system["name"]} ({system["id"]})')
else:
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out:
        out.write('HUB_URL='+args.hub_url+'\nKEY='+json.dumps(key)+'\nTOKEN='+token+'\n')
    print(f'Created {args.output.name} (mode 600). System: {system["name"]} ({system["id"]})')
