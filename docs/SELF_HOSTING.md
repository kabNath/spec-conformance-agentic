# Self-hosting (`docker compose up`)

```bash
git clone https://github.com/kabNath/spec-conformance-agentic && cd spec-conformance-agentic
cp .env.example .env            # OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_VERIFIER_MODEL (another model family); passwords if you want
docker compose up -d --build    # app :3000, migrations run first
docker compose run --rm migrate npx tsx scripts/create-api-key.ts <orgId>   # prints the API key once
curl localhost:3000/api/healthz
```

What runs: the app (the only published port, 3000), the signing sidecar, Postgres, Qdrant, Neo4j. Everything except the app is on a Docker network with `internal: true` and publishes no port; `scripts/test-network-isolation.sh --live` proves it (and CI runs it). The containers run as non-root users.

**API-only without Clerk.** `/api/v1`, `/api/mcp` and `/api/healthz` authenticate with an API key and do not need Clerk. The web UI needs the Clerk variables (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`); without them its pages return 500.

**Ingest a specification** before checking anything. `npm run ingest` (see the README) writes to Neo4j and Qdrant and needs the specification text, which is not in the images. It is **not yet automated inside this stack**: run it from a machine that can reach both services, e.g. with the development overlay (`docs/SELF_HOSTING.md`, "Local development") and `NEO4J_URI` / `QDRANT_URL` pointing at `localhost`.

## Signing key

Default: the sidecar generates an Ed25519 key on first start and keeps it in the `vidimuskeys` volume. Attestations then verify (integrity) but `signer_trusted` is false, because that key is not in `vidimus-svc/trusted-keys.json`.

To sign with your own key:

1. `openssl genpkey -algorithm ed25519 -out secrets/vidimus-signing-key.pem` (`secrets/` and `*.pem` are git-ignored).
2. Compute its key id (SHA-256 of the raw public key) and add `{key_id, public_key, valid_from, valid_until: null}` to `vidimus-svc/trusted-keys.json`; rebuild the sidecar image.
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` (mounts the key as a secret, forbids generating one).

The project's own production key is **not** in this repository and is not needed to run the stack.

## Local development

`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres qdrant neo4j vidimus` publishes the backing services on `127.0.0.1` for `npm run dev`. Never use that file on a server.
