#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/setup-env.sh
compose_files=(-f docker-compose.yml)
if grep -q '^BT03_REMOTE_API_ENABLED=true$' .env; then
  compose_files+=(-f docker-compose.remote-api.yml)
  if [[ "$(tailscale ip -4 2>/dev/null || true)" != "$(sed -n 's/^BT03_TAILSCALE_IP=//p' .env | tail -1)" ]]; then
    echo 'Tailscale IP is not ready or does not match BT03_TAILSCALE_IP in .env' >&2; exit 1
  fi
fi
if [[ -z "$(docker compose ps -q 2>/dev/null)" ]]; then
  for port in 3100 3101 55433 56379 3301; do
    if ss -H -ltn "sport = :$port" | grep -q .; then
      echo "Port $port is occupied. BT-03 not started." >&2; exit 1
    fi
  done
fi
docker compose "${compose_files[@]}" up -d --build
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3101/api/health >/dev/null && curl --fail --silent http://127.0.0.1:3100/ >/dev/null; then
    ./scripts/health-check.sh
    exit 0
  fi
  sleep 2
done
echo 'BT-03 did not become healthy within 60 seconds; inspect docker compose logs' >&2
exit 1
