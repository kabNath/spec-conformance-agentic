#!/usr/bin/env bash
# Create/update the Fly.io pilot (Tokyo). Reads secrets from a file and NEVER prints a value.
#   DRY_RUN=1 ops/fly/deploy.sh      prints every step (secrets masked) and changes nothing
#   ops/fly/deploy.sh                runs it (needs `fly auth login`; creates billable resources: see docs/FLY_PILOT.md for the cost)
# Secrets file (default ~/.secrets/sca-prod.env), KEY=value lines:
#   OPENROUTER_API_KEY  CLERK_SECRET_KEY  CLERK_PUBLISHABLE_KEY  VIDIMUS_SIGNING_KEY_FILE (a PATH to the unencrypted Ed25519 PKCS#8 PEM)
set -euo pipefail
cd "$(dirname "$0")/../.."
P="${FLY_PREFIX:-sca-nk}"; REGION="${FLY_REGION:-nrt}"; ORG="${FLY_ORG:-personal}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/.secrets/sca-prod.env}"
DRY="${DRY_RUN:-0}"
say() { printf '\n== %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '   $ %s\n' "$*"; else "$@"; fi; }
secret_value() { grep -E "^$1=" "$SECRETS_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }   # value goes to a variable, never to the terminal
set_secrets() {  # app, then NAME=VALUE lines on stdin (staged: applied by the next deploy; values never echoed)
  local app="$1"; if [ "$DRY" = 1 ]; then printf '   $ fly secrets import --stage -a %s   (names: %s)\n' "$app" "$(cat | cut -d= -f1 | tr '\n' ' ')"; else fly secrets import --stage -a "$app"; fi; }
have_secret() { fly secrets list -a "$1" 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$2"; }

say "preflight"
if [ "$DRY" != 1 ]; then
  fly auth whoami >/dev/null || { echo "not logged in to Fly: run 'fly auth login'" >&2; exit 1; }
  [ -r "$SECRETS_FILE" ] || { echo "secrets file not found: $SECRETS_FILE" >&2; exit 1; }
  for k in OPENROUTER_API_KEY CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY VIDIMUS_SIGNING_KEY_FILE; do
    [ -n "$(secret_value $k)" ] || { echo "missing $k in $SECRETS_FILE" >&2; exit 1; }; done
  PEM="$(secret_value VIDIMUS_SIGNING_KEY_FILE)"; [ -r "$PEM" ] || { echo "VIDIMUS_SIGNING_KEY_FILE does not point to a readable file" >&2; exit 1; }
  head -1 "$PEM" | grep -q "BEGIN PRIVATE KEY" || { echo "that file is not an unencrypted PKCS#8 PEM" >&2; exit 1; }
fi
echo "prefix=$P region=$REGION org=$ORG dry_run=$DRY"

say "apps (private apps get no public IP)"
for a in app sidecar db qdrant neo4j backup; do run fly apps create "$P-$a" --org "$ORG" || true; done

say "volumes (3 GB db, 2 GB neo4j, 1 GB qdrant)"
run fly volumes create pgdata --size 3 --region "$REGION" -a "$P-db" --yes || true
run fly volumes create neo4jdata --size 2 --region "$REGION" -a "$P-neo4j" --yes || true
run fly volumes create qdrantdata --size 1 --region "$REGION" -a "$P-qdrant" --yes || true

say "generated secrets (only if absent: re-running never rotates them)"
if [ "$DRY" = 1 ] || ! have_secret "$P-db" POSTGRES_PASSWORD; then
  PG_PW="$(openssl rand -hex 24)"; NEO_PW="$(openssl rand -hex 24)"; QD_KEY="$(openssl rand -hex 24)"
  printf 'POSTGRES_PASSWORD=%s\n' "$PG_PW" | set_secrets "$P-db"
  printf 'NEO4J_AUTH=neo4j/%s\n' "$NEO_PW" | set_secrets "$P-neo4j"
  printf 'QDRANT__SERVICE__API_KEY=%s\n' "$QD_KEY" | set_secrets "$P-qdrant"
  printf 'DATABASE_URL=postgresql://postgres:%s@%s-db.flycast:5432/conformance?connection_limit=5&connect_timeout=60\nNEO4J_PASSWORD=%s\nQDRANT_API_KEY=%s\n' \
    "$PG_PW" "$P" "$NEO_PW" "$QD_KEY" | set_secrets "$P-app"
  printf 'PGPASSWORD=%s\n' "$PG_PW" | set_secrets "$P-backup"
fi

say "backing services (stock images; private; one machine each; auto-stop/auto-start)"
( cd ops/fly
  run fly deploy -c db.fly.toml --ha=false --no-public-ips --local-only --yes
  run fly deploy -c qdrant.fly.toml --ha=false --no-public-ips --yes
  run fly deploy -c neo4j.fly.toml --ha=false --no-public-ips --yes )

say "signing sidecar (private; production key from a secret file)"
if [ "$DRY" = 1 ]; then echo '   $ printf "VIDIMUS_SIGNING_KEY_B64=<base64 of the PEM>" | fly secrets import --stage -a '"$P"'-sidecar'
else printf 'VIDIMUS_SIGNING_KEY_B64=%s\n' "$(base64 < "$PEM" | tr -d '\n')" | set_secrets "$P-sidecar"; fi
run fly deploy -c ops/fly/sidecar.fly.toml --dockerfile vidimus-svc/Dockerfile --ha=false --no-public-ips --local-only --yes .

say "private (Flycast) addresses: the only way the app reaches them, and what lets Fly start a stopped machine"
for a in db qdrant neo4j sidecar; do run fly ips allocate-v6 --private -a "$P-$a"; done
say "check: none of them has a public address"
for a in db qdrant neo4j sidecar; do
  if [ "$DRY" = 1 ]; then echo "   \$ fly ips list -a $P-$a   (must list only private_v6)"
  else fly ips list -a "$P-$a" --json | python3 -c 'import json,sys; ips=json.load(sys.stdin); bad=[i for i in ips if not str(i.get("Type","")).startswith("private")]; sys.exit(1 if bad or not ips else 0)' \
       || { echo "$P-$a has a PUBLIC address (or none): release it with 'fly ips release'" >&2; exit 1; }; fi
done

say "web app (public: https://$P-app.fly.dev)"
if [ "$DRY" = 1 ]; then
  echo '   $ printf "OPENROUTER_API_KEY=… CLERK_SECRET_KEY=…" | fly secrets import --stage -a '"$P"'-app'
else
  printf 'OPENROUTER_API_KEY=%s\nCLERK_SECRET_KEY=%s\n' "$(secret_value OPENROUTER_API_KEY)" "$(secret_value CLERK_SECRET_KEY)" | set_secrets "$P-app"
fi
run fly deploy -c ops/fly/app.fly.toml --dockerfile Dockerfile --ha=false --local-only --yes \
  --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$( [ "$DRY" = 1 ] && echo '<publishable key>' || secret_value CLERK_PUBLISHABLE_KEY )" .

say "daily backup to Tigris (age-encrypted; the identity stays on YOUR machine)"
AGE_KEY="${BACKUP_AGE_KEY_FILE:-$HOME/.secrets/sca-backup-age.key}"
if [ "$DRY" != 1 ] && [ ! -e "$AGE_KEY" ]; then
  docker run --rm --entrypoint age-keygen sca-backup-tools 2>/dev/null >"$AGE_KEY" || { docker build -q -t sca-backup-tools ops/backup >/dev/null; docker run --rm --entrypoint age-keygen sca-backup-tools 2>/dev/null >"$AGE_KEY"; }
  chmod 600 "$AGE_KEY"; echo "   created $AGE_KEY: BACK IT UP in your password manager; without it the backups cannot be read"
fi
run fly storage create -a "$P-backup" -n "$P-backups" --yes      # sets AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, BUCKET_NAME on the app
if [ "$DRY" = 1 ]; then echo '   $ printf "BACKUP_AGE_RECIPIENT=<public key>" | fly secrets import --stage -a '"$P"'-backup'
else printf 'BACKUP_AGE_RECIPIENT=%s\nBACKUP_S3_BUCKET=%s-backups\n' "$(grep -o 'age1[a-z0-9]*' "$AGE_KEY" | head -1)" "$P" | set_secrets "$P-backup"; fi
run fly machine run -a "$P-backup" --region "$REGION" --schedule daily --vm-memory 256 --dockerfile ops/backup/Dockerfile \
  -e PGHOST="$P-db.flycast" -e PGUSER=postgres -e PGDATABASE=conformance -e BACKUP_PREFIX=postgres/ -e BACKUP_RETENTION_DAYS=14 -e AWS_REGION=auto ops/backup

say "done: next, scripts/smoke-test.ts https://$P-app.fly.dev --sidecar-url https://$P-sidecar.fly.dev (see docs/FLY_PILOT.md)"
