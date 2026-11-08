# Future distribution

Remote FastSD CPU workers are implemented through an authenticated API and Tailscale; see `docs/remote-workers.md`. PostgreSQL, Redis, and PNG storage remain on `db1`. Further deployment options include an object store, HTTPS reverse proxy for workers outside Tailscale, and per-host resource accounting.
