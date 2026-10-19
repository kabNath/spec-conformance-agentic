# Use it from your tools (MCP)

The conformance agent is available as a [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude Desktop, Cursor, your own agents or a CI job can call it without custom glue. Two transports, same tools:

| Transport | How | Auth |
|---|---|---|
| stdio | `npx conformance-mcp` (from a checkout; reads the service environment) | `CONFORMANCE_API_KEY` |
| streamable HTTP | `POST /api/mcp` (stateless, one authenticated request = one server bound to your organisation) | `Authorization: Bearer <api key>` |

> **Status.** Verdicts are **Ed25519-signed verdicts** and every tool call leaves a **signed tool-call record**. The signing key is the sidecar's key; until it is listed in `vidimus-svc/trusted-keys.json` (empty today) a verifier can prove *integrity*, not *identity* (`verify_verdict` reports both separately).

## 1. One-time setup

```bash
npx prisma migrate deploy                       # adds ApiKey and McpToolCall
npm run api-key:create -- <your Clerk org id>   # prints the key ONCE; only its SHA-256 is stored
```

One active key per organisation (a database constraint). Rotate with `npm run api-key:create -- <org id> --rotate`; the old key is revoked first. Specs must already be ingested for the organisation (`npm run ingest`, see the README).

## 2. Tools

| Tool | Input | Output | Notes |
|---|---|---|---|
| `search_spec` | `query`, `spec_id?`, `top_k` (1-10) | cited hits: `spec`, `version`, `release`, `clause`, `display`, text window | all specs of the organisation if `spec_id` is omitted |
| `check_conformance` | `requirement_text`, `spec_id`, `clause?` | schema-validated verdict + `verdict_id` | **`abstained: true` = not committed, a human must review.** With `clause`, retrieval is skipped. |
| `extract_requirements` | `document_text` | `requirements[{requirement, section}]`, `chars_read`, `truncated` | reads only the **first 12,000 characters**; fixed output shape (no custom schema); no `document_id` (uploads keep no text) |
| `get_verdict` | `verdict_id` | the stored verdict | scoped to your organisation |
| `verify_verdict` | `verdict_id` | `integrity_valid`, `signer_trusted`, `issues`, `warnings` | checks the Ed25519 signature through the sidecar's `/verify` |

Resources: `spec://<id>` describes each specification ingested for your organisation.

Every response carries `call: {request_id, record_id, signed}`: the id of the tool-call record of **this** call. The record (table `McpToolCall`) stores SHA-256 hashes of input and output, the outcome (`ok` / `abstained` / `error`), the error code, latency, the `verdict_id` if any, and the sidecar's Ed25519 signature over those fields (`/sign-call`). It never stores the content. `signed: false` means the sidecar was unreachable: the record exists without a signature. If the record cannot be stored, the call **fails closed** (`audit_failed`) and its result is withheld.

### Reading a verdict honestly

`check_conformance` abstains often by design: in `EVAL.md` (40-item human-validated gold set) the agent is right about 95 % of the time *when it commits*, and it abstains on roughly 43-45 % of the items, which are routed to a human. Overall accuracy was about 66 % in both v1 and v2. Do not read a committed verdict as a certificate; read it as a cited first pass whose signature you can check.

### Errors

Failed calls return `isError: true` and `{"error": {"code", "message"}, "call": {...}}`. Codes: `unauthorized`, `invalid_input`, `spec_not_found`, `clause_not_found`, `verdict_not_found` (also for another organisation's id), `no_attestation`, `upstream_unavailable`, `audit_failed`, `internal`.

## 3. Connect a client

* Claude Desktop: [`examples/mcp/claude_desktop_config.json`](../examples/mcp/claude_desktop_config.json)
* Cursor (HTTP): [`examples/mcp/cursor.json`](../examples/mcp/cursor.json)
* A LangGraph workflow that searches, checks, verifies and escalates abstentions through the server: [`examples/mcp/agent-client.ts`](../examples/mcp/agent-client.ts) (its routing is fixed code, no LLM, so it runs without model keys).

```bash
curl -s -X POST https://YOUR-HOST/api/mcp \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $CONFORMANCE_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 4. What is and is not covered

* Organisation isolation: every query is filtered by the organisation of the API key; another organisation's verdict is indistinguishable from an unknown id.
* **Not yet:** rate limits and per-client usage reports (next phase), defences against prompt injection in uploaded documents and retrieved text, with a red-team set (later phase). The sidecar's `/attest`, `/verify` and `/sign-call` have **no caller authentication**: keep the sidecar on a private network.
* Each `check_conformance` creates a run named "MCP check_conformance" in the organisation's run list.
* CI tests cover schemas, errors and cross-organization isolation; they do not measure answer quality — see EVAL.md.
