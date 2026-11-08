#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:3101/api/health
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3100/
echo 'Website and API responded'
