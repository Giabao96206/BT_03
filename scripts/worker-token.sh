#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+\.[0-9]+$ || "$1" == 1.1 ]]; then
  echo 'Usage: scripts/worker-token.sh WORKER_ID' >&2; exit 2
fi
python3 - "$1" <<'PY'
from pathlib import Path
import hashlib,hmac,sys
text=Path('.env').read_text()
secret=next((line.split('=',1)[1] for line in text.splitlines() if line.startswith('REMOTE_WORKER_SECRET=')),None)
if not secret or len(secret)<32: raise SystemExit('REMOTE_WORKER_SECRET missing; run scripts/setup-env.sh')
print(hmac.new(secret.encode(),sys.argv[1].encode(),hashlib.sha256).hexdigest())
PY
