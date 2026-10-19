// Smoke test of a DEPLOYED instance. Exit 0 only if every check passes; the URL goes into the README only after that.
//   SMOKE_API_KEY=sca_… npx tsx scripts/smoke-test.ts https://host [--spec lcp100 [--requirement "…"]] [--expect-trusted] [--sidecar-url <url that must NOT answer>]
// Checks: /api/healthz 200 · /api/v1 without key 401 · MCP without key 401 · with key a signed call record ·
//         (--spec) a streamed check ends with a signed `final` verdict that /verify accepts (--expect-trusted: signer listed) ·
//         (--sidecar-url) the sidecar is NOT reachable from here.
const argv = process.argv.slice(2);
const base = argv.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, "");
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n: string) => argv.includes(`--${n}`);
const KEY = process.env.SMOKE_API_KEY;

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const j = async (r: Response) => { try { return await r.json(); } catch { return null; } };
const auth = { authorization: `Bearer ${KEY}` };

async function main() {
  if (!base) { console.error("usage: smoke-test.ts <base url> [--spec id] [--expect-trusted] [--sidecar-url url]"); process.exit(2); }
  const h = await fetch(`${base}/api/healthz`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const hb = h ? await j(h) : null;
  check("GET /api/healthz → 200 and ok", h?.status === 200 && hb?.status === "ok", `status ${h?.status} ${JSON.stringify(hb)}`);

  const noKey = await fetch(`${base}/api/v1/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "session set-up" }) }).catch(() => null);
  check("POST /api/v1/search without key → 401", noKey?.status === 401, `status ${noKey?.status}`);
  const mcpNoKey = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }).catch(() => null);
  check("POST /api/mcp without key → 401", mcpNoKey?.status === 401, `status ${mcpNoKey?.status}`);

  if (!KEY) { console.log("- SMOKE_API_KEY not set: authenticated checks skipped"); }
  else {
    const s = await fetch(`${base}/api/v1/search`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "smoke-" + Date.now(), ...auth }, body: JSON.stringify({ query: "session set-up", ...(flag("spec") ? { spec_id: flag("spec") } : {}) }) }).catch(() => null);
    const sb = s ? await j(s) : null;
    check("POST /api/v1/search with key → 200 and a SIGNED call record", s?.status === 200 && sb?.call?.signed === true, `status ${s?.status} ${JSON.stringify(sb?.call ?? sb?.error)}`);

    if (flag("spec")) {
      const req = flag("requirement") ?? "The terminal starts timer T901 and sends a SessionRequest message when it opens a link session.";
      const r = await fetch(`${base}/api/v1/check`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream", ...auth }, body: JSON.stringify({ requirement_text: req, spec_id: flag("spec") }), signal: AbortSignal.timeout(300_000) }).catch(() => null);
      const text = r ? await r.text() : "";
      const events = text.split("\n\n").filter((b) => b.startsWith("event:")).map((b) => ({ event: /event: (.*)/.exec(b)![1], data: JSON.parse(/data: (.*)/.exec(b)![1]) }));
      const fin = events.at(-1);
      check("POST /api/v1/check (SSE) streams steps and ends with `final`", r?.status === 200 && events.some((e) => e.event === "step") && fin?.event === "final", `status ${r?.status}, events ${events.map((e) => e.event).join(",")}`);
      const id = fin?.data?.verdict_id;
      check("final verdict carries an Ed25519 signature and a signed call record", !!fin?.data?.attestation?.signature && fin?.data?.call?.signed === true);
      if (id) {
        const v = await fetch(`${base}/api/v1/verdicts/${id}/verify`, { method: "POST", headers: auth }).catch(() => null);
        const vb = v ? await j(v) : null;
        check("verify → integrity_valid", v?.status === 200 && vb?.integrity_valid === true, JSON.stringify(vb?.issues ?? vb?.error));
        if (has("expect-trusted")) check("verify → signer_trusted (production key is listed)", vb?.signer_trusted === true, JSON.stringify(vb?.trust_issues));
      }
    }
  }

  const sidecar = flag("sidecar-url");
  if (sidecar) {
    const r = await fetch(`${sidecar.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(8000) }).then((x) => x.status).catch(() => null);
    check("the sidecar is NOT reachable from the internet", r === null, `it answered ${r}`);
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
