# Fly.io pilot (Tokyo): configuration, cost, runbook

Status: **configured, not deployed.** Everything here is files in `ops/`; nothing has been created on Fly.io. Decision (from the hosting comparison in [HOSTING_OPTIONS.md](HOSTING_OPTIONS.md)): Fly.io Tokyo, self-managed Postgres with a daily off-platform backup, minimum-cost machines that stop when idle and start on the first request. Move Postgres to the managed service when a pilot signs.

## Layout

| App (`sca-nk-…`) | What | Size | Public? | Volume |
|---|---|---|---|---|
| `app` | Next.js: web UI, `/api/v1`, `/api/mcp`, `/api/healthz` | shared-cpu-1x, 512 MB | **yes**, `https://sca-nk-app.fly.dev` (shared IPv4 + IPv6, no dedicated IP, no custom domain) | none |
| `sidecar` | signing sidecar (production Ed25519 key) | shared-cpu-1x, 256 MB | **no**: Flycast private address only | none |
| `db` | Postgres 16 (tuned for 256 MB) | shared-cpu-1x, 256 MB | no | 3 GB |
| `qdrant` | Qdrant (API key) | shared-cpu-1x, 256 MB | no | 1 GB |
| `neo4j` | Neo4j 5 (heap 384 MB) | shared-cpu-1x, 1 GB | no | 2 GB |
| `backup` | scheduled machine, daily: `pg_dump` → age → Tigris | shared-cpu-1x, 256 MB | no | none |

One machine per app (`--ha=false`), region `nrt`. Sizes come from measurement, not guesswork: running the same images locally after a few requests, the app used 72 MiB, the sidecar 56 MiB, Qdrant 59 MiB, Postgres 28 MiB and Neo4j 509 MiB even with a 256 MB heap, so Neo4j needs the 1 GB machine and everything else fits 256-512 MB. The app is the one to watch: it was measured idle and after search calls, not under a full LangGraph run (`NODE_OPTIONS=--max-old-space-size=320` caps it; the Fly dashboard will show the real peak).

**Auto-stop / auto-start.** Every service has `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0`. Fly Proxy stops a machine "when the app is idle for several minutes" (its check runs every few minutes) and starts it on the next request. For the private apps that only works through a **Flycast** address (`<app>.flycast`), which `deploy.sh` allocates and which the app uses (`VIDIMUS_URL`, `QDRANT_URL`, `NEO4J_URI`, `DATABASE_URL`); plain `.internal` addresses would not wake a stopped machine. While the app is up, its health check (`/api/healthz`, every 30 s) touches Postgres and the sidecar, so they stay up during a session and stop a few minutes after the app does. Qdrant and Neo4j have no such ping: a pause of several minutes mid-session can stop them, and the next check then waits for a restart (Neo4j: tens of seconds; not measured on Fly).

**What a demo feels like.** First request after a long idle: the app wakes in a few seconds, `GET /api/healthz` also wakes Postgres and the sidecar; the first `check` then waits for Neo4j (JVM start) and Qdrant. Expect the first check of the day to take noticeably longer (my estimate: up to about a minute; unmeasured). Warm it before a demo: `curl https://sca-nk-app.fly.dev/api/healthz`, then run one `search`.

## Cost estimate (before deploying)

Prices read 2026-10-19: [Fly pricing](https://docs.fly.io/about/pricing) (shared-cpu-1x: 256 MB $2.19, 512 MB $3.69, 1 GB $6.70 per month at the cheapest regions; Tokyo multiplier 1.3077; stopped machines pay only $0.15/GB-month of image; volumes $0.15/GB-month; snapshots $0.08/GB-month with the first 10 GB free; Asia egress $0.04/GB; no platform fee, no minimum, shared IPv4 free), [Tigris](https://www.tigrisdata.com/docs/pricing/) (5 GB storage and 10k/100k requests free, free egress). The arithmetic is `ops/fly/cost-estimate.py`; edit an assumption and re-run it.

| Scenario | Monthly |
|---|---|
| **Idle: nobody clicks.** Only the daily backup wakes Postgres (~8 min/day) and runs its own machine (2 min/day). | **≈ $1.8** |
| **A prospect tests 1 hour a day.** Every machine up ~70 min/day (1 h + ~10 min until the proxy stops it), Postgres also for the backup. | **≈ $2.9** |
| Worst case: auto-stop defeated, everything always on. | ≈ $23.6 |

Breakdown of the 1 h/day case: compute $1.09 (app 0.24, Neo4j 0.43, Postgres 0.16, sidecar 0.14, Qdrant 0.14, backup 0.004), stopped-image storage $0.59, volumes (6 GB) $1.18, egress $0.04, Tigris $0.

**Not in these numbers:** the model/API cost (OpenRouter) of the checks themselves, which dominates as soon as someone uses it; a custom domain; support plans. **Where they can be wrong:** the idle-stop delay ("several minutes") is a Fly statement, not a measurement, and a monitor or health probe that keeps hitting the public URL would keep the app (and, through its health check, Postgres and the sidecar) running; I applied the Tokyo multiplier to stopped-image and volume storage as a conservative guess because the pricing page does not say; the rootfs size is the unpacked image size from `docker images` (Fly's billed size may differ); Flycast private addresses have no stated price. The real figure will be on the Fly dashboard after a few days.

## Backups

* Fly takes automatic daily **volume snapshots** (5-day retention by default).
* **Logical backup**, independent of the platform: the `backup` machine runs `ops/backup/backup.sh` daily: `pg_dump` (custom format) → `age` encryption to a public key → Tigris bucket, with a SHA-256 next to each object and a size check after upload; objects older than 14 days are pruned. The `age` private key is created by `deploy.sh` on **your** machine (`~/.secrets/sca-backup-age.key`) and is never sent to Fly: store it in your password manager, without it the backups are unreadable.
* **Restore** (`ops/backup/restore.sh`): downloads, verifies the SHA-256, decrypts, and restores into an **empty** database only. Run it from a one-off machine on the same private network, or from your laptop with the Tigris credentials and a proxy to the database.
* **Restore test in CI** (`ops/backup/test-restore.sh`, job `backup-restore`): real migrations and representative rows, backup to an S3 fake, restore into a new database, per-table row counts and content hashes identical, the one-active-key-per-organisation index still enforced, a missing key / a corrupted object / a non-empty target all refused, retention pruning works. It proves the scripts and the procedure; it does not prove the Tigris credentials or the scheduled machine, which the first real run (and a restore drill after it) must.
* Qdrant and Neo4j hold data derived from the ingested specification; they are protected by Fly's volume snapshots only and can be rebuilt by re-running the ingestion.

## Deploy (after your go)

```bash
fly auth login                         # the session in your terminal had expired when I checked
DRY_RUN=1 ops/fly/deploy.sh            # prints every step with secrets masked; changes nothing
ops/fly/deploy.sh                      # creates the apps, volumes, secrets; builds locally; deploys; allocates private addresses
SMOKE_API_KEY=… npx tsx scripts/smoke-test.ts https://sca-nk-app.fly.dev --spec <id> --expect-trusted --sidecar-url https://sca-nk-sidecar.fly.dev
```

The script reads `~/.secrets/sca-prod.env` (`OPENROUTER_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VIDIMUS_SIGNING_KEY_FILE` = path of the production key PEM), never prints a value, generates the database/Neo4j/Qdrant passwords itself (only if absent), checks that the private apps have **no public address**, and stops on the first error. Images are built **locally** (`--local-only`), because the sidecar and app images need their own `.dockerignore`; on Apple silicon this means an amd64 emulated build (slow, one-off).

Things that are assumptions until the first deploy: that Fly accepts `secret_name` of `[[files]]` as base64 (the smoke test's `--expect-trusted` verifies the key end to end); that app names `sca-nk-*` are free; that `fly storage create` names the bucket as requested. Teardown (stops all billing): `for a in app sidecar db qdrant neo4j backup; do fly apps destroy sca-nk-$a --yes; done` and the Tigris bucket.
