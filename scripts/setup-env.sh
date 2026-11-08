#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env ]]; then
  python3 - <<'PY'
from pathlib import Path
import secrets
path=Path('.env')
text=path.read_text()
if not any(line.startswith('REMOTE_WORKER_SECRET=') for line in text.splitlines()):
    with path.open('a') as file: file.write('\nREMOTE_WORKER_SECRET='+secrets.token_urlsafe(48)+'\n')
    print('Added remote worker secret to .env')
else: print('.env already configured')
PY
  exit 0
fi
python3 - <<'PY'
from pathlib import Path
import secrets
text=Path('.env.example').read_text()
password=secrets.token_urlsafe(24).replace('-','A').replace('_','B')
text=text.replace('change-me',password)
text=text.replace('replace-with-long-random-token',secrets.token_urlsafe(48),1)
text=text.replace('replace-with-long-random-token',secrets.token_urlsafe(48),1)
Path('.env').write_text(text)
Path('.env').chmod(0o600)
print('Created .env with random database password and administrator token')
PY
