# AI workers

Worker 1.1 runs on `db1` with the existing FastSD CPU environment, SD 1.5, LCM-LoRA and Hokusai style. Worker 1.2 can run on a teammate's machine from `docker-compose.remote-worker.yml`. The local `worker-12` service is opt-in through the `local-second-worker` profile and must not share ID 1.2 with a remote machine. Remote workers register their checkpoint and model in PostgreSQL through the API; they may share the tested SD 1.5 model or use another compatible checkpoint. Setup is in `docs/remote-workers.md`.

Local workers consume BullMQ; remote workers claim queued PostgreSQL jobs via the authenticated API. Conditional database updates prevent duplicate claims. Searches take priority over background jobs. The Redis inference lease limits only local workers sharing `db1`; remote machines can infer in parallel. Worker status, current job, heartbeat, successes, failures and average latency are in PostgreSQL and `/api/workers`.

The scheduler uses ten English vocabulary categories from `configs/prompts/vocabulary.json`, combines subjects with settings, colors and seasons, and persists its composition cursor in Redis. It checks every ten seconds, keeps at most three queued/generating/saving jobs in PostgreSQL, skips known descriptions, and can be paused or resumed with bearer-admin calls to `/api/scheduler/pause` and `/api/scheduler/resume`.
