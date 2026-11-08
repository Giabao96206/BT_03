#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f infrastructure/docker/remote-worker.Dockerfile -t bt03-ukiyoe/fastsd-remote-worker:1 .
mkdir -p dist
docker save bt03-ukiyoe/fastsd-remote-worker:1 | gzip -1 > dist/fastsd-remote-worker-1.tar.gz
sha256sum dist/fastsd-remote-worker-1.tar.gz > dist/fastsd-remote-worker-1.tar.gz.sha256
echo "Created dist/fastsd-remote-worker-1.tar.gz and SHA256 checksum"
