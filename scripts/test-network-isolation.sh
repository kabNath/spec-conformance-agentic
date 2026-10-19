#!/usr/bin/env bash
# The signing sidecar (and the databases) must be unreachable from outside the stack.
#   scripts/test-network-isolation.sh            static checks on the compose files only (no Docker daemon needed beyond `config`)
#   scripts/test-network-isolation.sh --live     also starts the stack and probes it from outside (needs Docker; builds images)
# Static: no service but `app` publishes a port; the sidecar/db/vector/graph services are only on the `internal: true` network.
# Live: from the host the sidecar port is closed; from a container on the public `edge` network the sidecar is not even resolvable;
#       from inside the internal network (positive control) it answers, so the negative results are not a broken probe.
set -euo pipefail
cd "$(dirname "$0")/.."
FILES=(-f docker-compose.yml)
[ "${1:-}" = "--prod-overlay" ] && FILES+=(-f docker-compose.prod.yml) && shift
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== static: docker compose config"
JSON=$(docker compose "${FILES[@]}" config --format json)
python3 - "$JSON" <<'PY'
import json, sys
c = json.loads(sys.argv[1]); s = c["services"]; n = c["networks"]
errors = []
if not n["internal"].get("internal"): errors.append("network `internal` must have internal: true")
if n.get("edge", {}).get("internal"): errors.append("network `edge` must not be internal")
for name, svc in s.items():
    nets = sorted(svc.get("networks") or [])
    ports = svc.get("ports") or []
    if name == "app":
        if [p["target"] for p in ports] != [3000]: errors.append(f"app must publish exactly 3000, got {ports}")
        continue
    if ports: errors.append(f"{name} publishes ports {ports}")
    if nets != ["internal"]: errors.append(f"{name} must be on the internal network only, got {nets}")
if "vidimus" not in s: errors.append("no vidimus service")
if errors: print("\n".join("FAIL: " + e for e in errors)); sys.exit(1)
print("ok: only `app` publishes a port (3000); vidimus, postgres, qdrant, neo4j, migrate are on the internal network only")
PY

[ "${1:-}" = "--live" ] || { echo "(static checks only; add --live for the network probes)"; exit 0; }

echo "== live: start the stack"
PROJECT=$(docker compose "${FILES[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
trap 'docker compose "${FILES[@]}" down -v >/dev/null 2>&1 || true' EXIT
docker compose "${FILES[@]}" up -d --build app vidimus postgres
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "${PROJECT}-vidimus-1" 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "${PROJECT}-vidimus-1")" = healthy ] || fail "sidecar not healthy"

echo "== live: positive control (inside the internal network, through the app container)"
docker compose "${FILES[@]}" exec -T app node -e "fetch('http://vidimus:4319/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" \
  || fail "the app cannot reach the sidecar: the negative checks below would prove nothing"

echo "== live: this stack publishes no port other than the app's"
PUBLISHED=$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Label "com.docker.compose.service"}}|{{.Ports}}')
echo "$PUBLISHED" | sed 's/^/   /'
echo "$PUBLISHED" | grep -v '^app|' | grep -q '[0-9]->' && fail "a backing service publishes a port"
echo "ok: only the app publishes a port"

echo "== live: from the host, the sidecar and database ports are closed"
for port in 4319 5432 6333 7687; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    # Something listens. Fail only if it is THIS stack; another local process or container (e.g. an old dev stack) is not ours.
    if echo "$PUBLISHED" | grep -q ":${port}->"; then fail "127.0.0.1:$port is published by this stack"; fi
    echo "warn: 127.0.0.1:$port is open, but not published by this stack (another local process or container)"
  fi
done
echo "ok: none of 4319, 5432, 6333, 7687 is published by this stack"

echo "== live: from another container on the public edge network, the sidecar is unreachable"
IMG=$(docker compose "${FILES[@]}" images -q app | head -1)
# positive control of THIS probe: the same container on the same network does reach the public app
docker run --rm --network "${PROJECT}_edge" "$IMG" node -e "fetch('http://app:3000/api/healthz',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" \
  || fail "the edge-network probe cannot even reach the app: the negative check below would prove nothing"
if docker run --rm --network "${PROJECT}_edge" "$IMG" node -e "fetch('http://vidimus:4319/health',{signal:AbortSignal.timeout(4000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
  fail "a container on the edge network reached the sidecar"
fi
echo "ok: not reachable from the edge network"
echo "PASS"
