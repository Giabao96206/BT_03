# Ubuntu deployment on db1

1. Verify `docker compose version`, `free -h`, `df -h`, and `ss -ltnp`. The required ports are 3100, 3101, 3301, 55433 and 56379. Do not change unrelated services or firewall rules.
2. Verify `/home/giabaovip/AI Gen Image/fastsdcpu/env/bin/python` and the Hokusai LoRA exist. Keep the model cache at `/home/giabaovip/.cache/huggingface`.
3. Run `./scripts/start-all.sh`. It creates a private `.env`, checks ports, builds and starts only the `bt03-ukiyoe` Compose project.
4. Run `./scripts/health-check.sh` and `docker compose exec -T api node tests/e2e.mjs`, then `./scripts/benchmark-ai.sh 'black dog'`. Inspect `docker compose logs worker-11` on failure. The host's Node 12 is too old for this application; use the bundled Node 22 containers.
5. Configure Kuma at `http://127.0.0.1:3301/` via an SSH tunnel if desired. Monitor `http://web:3100/` and `http://api:3101/api/health` from its container.

The Compose services use `restart: unless-stopped`, so Docker restarts them after reboot. An optional unit is in `infrastructure/systemd/bt03-ukiyoe.service`; do not install it unless the existing host boot behavior requires it. Do not run global Docker cleanup commands. `docker compose down` leaves the BT-03 database and Redis volumes intact. No Cloudflare route has been modified. Public access requires local validation and explicit approval.

The Docker worker mounts the host UV interpreter directory because the FastSD venv Python executable is an absolute symlink outside the FastSD folder. If its path changes, update the worker mounts before deployment.
