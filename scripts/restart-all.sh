#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/stop-all.sh
./scripts/start-all.sh
