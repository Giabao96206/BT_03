"""Generate local first-admin credentials; never print passwords to logs."""
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / '.env.beszel'
try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print('.env.beszel already exists; preserving credentials')
else:
    with os.fdopen(fd, 'w') as out:
        out.write('USER_EMAIL=admin@bt03.local\nUSER_PASSWORD=' + secrets.token_urlsafe(32) + '\n')
    print('Created .env.beszel (mode 600). Read this local file for login credentials.')
