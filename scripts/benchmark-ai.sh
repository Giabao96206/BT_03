#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
description="${1:-black dog}"
query=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$description")
started=$(date +%s)
response=$(curl --fail --silent --show-error "http://127.0.0.1:3101/api/images/search?q=$query")
echo "$response"
job=$(printf '%s' "$response" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("job",{}).get("id",""))')
if [[ -z "$job" ]]; then echo 'Existing image reused'; exit 0; fi
while true; do
  sleep 5
  result=$(curl --fail --silent --show-error "http://127.0.0.1:3101/api/generation/jobs/$job")
  status=$(printf '%s' "$result" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  echo "Job: $status, wall time: $(($(date +%s)-started))s"
  if [[ "$status" == completed || "$status" == failed ]]; then echo "$result"; break; fi
done
./scripts/check-resources.sh
[[ "$status" == completed ]]
