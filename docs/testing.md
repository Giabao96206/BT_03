# Testing and benchmarks

## Beszel and worker monitoring verification (15 November 2026)

Beszel Hub and local agent are pinned to 0.21.2. The local system `db1 / worker 1.1` was verified as `up` with actual CPU, RAM, swap, disk and per-interface network records, including `ens33` and `tailscale0`. These metrics describe the Ubuntu VM, not the Windows host. Remote machines need their own agent before host charts appear in Beszel.

The updated `/monitoring` page was checked with Chromium on desktop (1440 px) and mobile (390 px): no JavaScript runtime errors or horizontal overflow, correct Beszel link, worker counts, current jobs and last images. Percentage completion is intentionally not fabricated for v2/v3 workers.

Read-only checks:

```bash
docker exec -i bt03-ukiyoe-api-1 node --input-type=module < tests/monitoring.mjs
python3 tests/beszel-check.py
docker exec bt03-ukiyoe-api-1 npm test
```

The monitoring integration check validates job ownership and last-image provenance against PostgreSQL. All four existing shared unit tests also passed. Beszel credentials are read from the ignored local `.env.beszel`; the checker never prints tokens or passwords.

Commands:

```bash
docker run --rm bt03-ukiyoe-worker-11:latest npm test
docker compose exec -T api node tests/e2e.mjs
docker compose exec -T api node --input-type=module < tests/integration.mjs
./scripts/benchmark-ai.sh 'black dog'
docker compose logs --tail=100 worker-11
```

## Results on db1, 8 November 2026

- Docker Compose build completed; PostgreSQL migration and seed applied. API and website health checks passed through the web proxy.
- `npm test`: 4 tests passed (normalization, filename, unsafe input, prompt composition).
- `node tests/e2e.mjs`: health, input validation, pagination, worker discovery and duplicate-job reuse passed.
- Actual FastSD CPU generation: `black dog` 38.238s, integration test lantern 38.446s, scheduled `white cat` 36.551s and scheduled `brown horse` 39.169s. Each produced a real 512×512 PNG and a PostgreSQL record. Mean of these four is 38.101s.
- Repeat `black dog` search returned HTTP 200 with the stored image UUID. PNG download returned the PNG signature. The gallery listed the image. Image and worker counts persisted after restarting the BT-03 API, web and workers.
- During the timed-out float16 run, worker memory samples reached 3.298 GiB and the host reported about 2 GiB available. During the tuned float32 run a live worker sample was 2.343 GiB at roughly 378% CPU. These are samples, not peak measurements. The worker now has a 4.5 GiB memory cap and four-core CPU cap.

## Errors found and fixed

1. Prisma rejected one-line generator syntax; corrected schema layout.
2. TypeScript outputs inherited a root-relative `dist`; each workspace now sets its own output directory.
3. Prisma could not deserialize `pg_advisory_xact_lock()`'s `void` result; query casts it to text.
4. Hugging Face strict cache validation rejected a snapshot missing optional files; the adapter loads the existing local snapshot directory.
5. A float16 CPU attempt timed out at 15 minutes. Float32 with four Torch threads and no unused safety-checker load generated the next image in 38.238s.

The scheduler's priority-queue count fix passed the final build; `/api/stats` now reports `prioritized` jobs and the scheduler includes them in its cap. The `/monitoring` route and LAN homepage both returned HTTP 200. The expanded `tests/integration.mjs` passed against actual stored images, PostgreSQL and worker heartbeats. The second model, public tunnel, automatic Kuma monitor setup, and automated host-reboot recovery test remain open. Dependency audit reported six production advisories (one moderate, five high), mostly in build-time dependencies; review and upgrade them before public exposure.
