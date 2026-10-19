#!/usr/bin/env bash
# Docker-level proof that restarting the container keeps the signing key.
# Needs the compose stack's `vidimus` service (named volume `vidimuskeys`). Run from the repo root:
#   bash vidimus-svc/test_restart.sh
set -euo pipefail
pub() { curl -fsS -m 10 localhost:4319/pubkey; }
wait_up() { for _ in $(seq 1 40); do curl -fsS -m 2 localhost:4319/health >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "service did not come up"; exit 1; }
docker compose up -d --build vidimus >/dev/null 2>&1; wait_up
before="$(pub)"; echo "before: $before"
docker compose restart vidimus >/dev/null 2>&1; wait_up
after="$(pub)"; echo "after restart:  $after"
[ "$before" = "$after" ] || { echo "FAIL: key changed after restart"; exit 1; }
docker compose up -d --build --force-recreate vidimus >/dev/null 2>&1; wait_up
again="$(pub)"; echo "after recreate: $again"
[ "$before" = "$again" ] || { echo "FAIL: key changed after container recreate"; exit 1; }
echo "OK: public key unchanged across restart and recreate"
