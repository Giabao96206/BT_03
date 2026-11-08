#!/usr/bin/env bash
set -euo pipefail
free -h
df -h "$(dirname "$0")/.."
nproc
mapfile -t worker_ids < <(docker compose -f "$(dirname "$0")/../docker-compose.yml" ps -q worker-11 worker-12 2>/dev/null)
if (( ${#worker_ids[@]} )); then docker stats --no-stream "${worker_ids[@]}"; fi
