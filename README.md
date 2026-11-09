# BT-03 — Intelligent Online Image Repository

Ukiyo-e gallery with a central server on `db1` and optional FastSD CPU workers on teammates' machines. PostgreSQL, Redis, API and PNG storage remain on `db1`; remote workers use an authenticated Tailscale API and a standalone Docker image.

## Status

The local stack is running on `db1`. The remote image has generated and uploaded a real 512×512 image as worker 1.2; PostgreSQL and the gallery recorded it. See `docs/remote-workers.md` for teammate setup and `docs/testing.md` for earlier local measurements.

## Start

```bash
cd '/home/giabaovip/AI Gen Image/bt03-ukiyoe'
./scripts/start-all.sh
```

The first start creates `.env` with random credentials. The website is `http://192.168.201.128:3100/` on the LAN and the live dashboard is `/monitoring`; the API uses localhost port 3101 and, when remote workers are enabled, Tailscale port 3102. No public Internet tunnel is configured. To stop BT-03 only: `./scripts/stop-all.sh`. To restart: `./scripts/restart-all.sh`. Check: `./scripts/health-check.sh`. Benchmark a missing search: `./scripts/benchmark-ai.sh 'black dog'`.

The host must allow Docker Compose, have ports 3100, 3101, 3301, 55433 and 56379 free, and retain the existing FastSD CPU environment and Hugging Face cache. The Docker worker mounts FastSD and its external UV Python interpreter read-only. This is Linux-specific to this server.

## Add teammate workers

Teammates can clone this repository and either download the filtered prebuilt image from the `remote-worker-v2` GitHub Release or build the standalone FastSD CPU worker image locally. Worker v2 downloads only the Diffusers files required for inference instead of the complete 47 GB SD 1.5 repository. They never need the server database or Redis credentials. Each machine needs its own worker ID and token issued on `db1`. Follow [docs/remote-workers.md](docs/remote-workers.md).

See `docs/remote-workers.md`, `docs/architecture.md`, `docs/ubuntu-deployment.md`, `docs/fastsd-integration.md`, `docs/ai-workers.md`, `docs/zero-miss-search.md`, and `docs/testing.md`.

## Requirements checklist

| Requirement | Implementation / status |
|---|---|
| 50 newest images and pagination | `apps/api` and `apps/web` |
| Search, queue, same-session result | PostgreSQL lookup, BullMQ, SSE |
| Permanent metadata and files | Prisma PostgreSQL schema, `storage/images` |
| Multiple worker processes | `worker-11` local; optional remote worker image with per-worker token |
| CPU concurrency cap | Redis lease, one inference at a time |
| Background generation | Scheduler, vocabulary, queue cap, pause/resume |
| Monitoring | API stats, health, `/monitoring`, JSON logs, Uptime Kuma container |
| Public Internet | Pending local validation and explicit approval |
| Real generation and benchmark | Completed: black dog 38.2s, white cat 36.6s |
