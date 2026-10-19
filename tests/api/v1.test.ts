import { describe, it, expect, beforeEach } from "vitest";
import { handleV1 } from "../../api/v1";
import { handleHealth } from "../../api/health";
import { RateLimiter } from "../../api/rate-limit";
import { handleMcpHttp } from "../../mcp/http";
import { makeFakes, type Fakes } from "../mcp/fakes";

let f: Fakes, limiter: RateLimiter, now: number;
beforeEach(() => { f = makeFakes(); now = 1_000_000; limiter = new RateLimiter(5, 60_000, () => now); });

const REQ = "The terminal sends a SessionRequest message on set-up.";
const req = (method: string, path: string, opts: { key?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request("http://localhost/api/v1" + path, {
    method, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { "content-type": "application/json", ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}), ...opts.headers },
  });
const call = (method: string, path: string, opts?: Parameters<typeof req>[2]) => handleV1(req(method, path, opts), f, limiter);

describe("auth and errors", () => {
  it("401 without or with a wrong key, 404 for an unknown endpoint, 400 for bad input", async () => {
    expect((await call("POST", "/check", { body: { requirement_text: REQ, spec_id: "lcp100" } })).status).toBe(401);
    expect((await call("POST", "/check", { key: "sca_" + "2".repeat(40), body: {} })).status).toBe(401);
    expect((await call("GET", "/nothing", { key: f.keyA })).status).toBe(404);
    const bad = await call("POST", "/check", { key: f.keyA, body: { requirement_text: "short", spec_id: "LCP 100" } });
    expect(bad.status).toBe(400);
    const j = await bad.json();
    expect(j.error.code).toBe("invalid_input");
    expect(j.error.details.issues.length).toBe(2);
    expect((await call("GET", "/verdicts/not-a-uuid", { key: f.keyA })).status).toBe(400);
  });
  it("maps domain errors to statuses and keeps the call record", async () => {
    const r = await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "nope" } });
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("spec_not_found");
    expect(f.calls.rows.at(-1)).toMatchObject({ channel: "http", tool: "POST /api/v1/check", outcome: "error", error_code: "spec_not_found" });
  });
});

describe("check, get, verify", () => {
  it("returns a verdict, then reads and verifies it; another organisation gets 404", async () => {
    const made = await (await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "lcp100" } })).json();
    expect(made).toMatchObject({ verdict: "conformant", abstained: false });
    const got = await call("GET", `/verdicts/${made.verdict_id}`, { key: f.keyA });
    expect(got.status).toBe(200);
    const ver = await (await call("POST", `/verdicts/${made.verdict_id}/verify`, { key: f.keyA })).json();
    expect(ver).toMatchObject({ integrity_valid: true, signer_trusted: false });
    expect((await call("GET", `/verdicts/${made.verdict_id}`, { key: f.keyB })).status).toBe(404);
    expect((await call("POST", `/verdicts/${made.verdict_id}/verify`, { key: f.keyB })).status).toBe(404);
  });
  it("search and extract work and are recorded on the http channel", async () => {
    const s = await (await call("POST", "/search", { key: f.keyA, body: { query: "session set-up", top_k: 1 } })).json();
    expect(s.hits).toHaveLength(1);
    const e = await (await call("POST", "/extract", { key: f.keyA, body: { document_text: "The terminal does A.\nThe terminal does B." } })).json();
    expect(e.requirements).toHaveLength(2);
    expect(f.calls.rows.map((r) => [r.channel, r.tool])).toEqual([["http", "POST /api/v1/search"], ["http", "POST /api/v1/extract"]]);
  });
});

describe("request id", () => {
  it("echoes a well-formed X-Request-Id, stores it in the record and in the verdict's trace, replaces a malformed one", async () => {
    const r = await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "lcp100" }, headers: { "x-request-id": "pilot-req-0001" } });
    expect(r.headers.get("x-request-id")).toBe("pilot-req-0001");
    const body = await r.json();
    expect(body.call.request_id).toBe("pilot-req-0001");
    expect(f.calls.rows.at(-1)!.request_id).toBe("pilot-req-0001");
    expect(f.stored.get(body.verdict_id)!.trace).toMatchObject({ requestId: "pilot-req-0001" });
    const r2 = await call("GET", "/nothing", { key: f.keyA, headers: { "x-request-id": "bad id!" } });
    expect(r2.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After after the limit, per key, and recovers with the window", async () => {
    const hit = () => call("POST", "/search", { key: f.keyA, body: { query: "session set-up" } });
    for (let i = 0; i < 5; i++) expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect((await call("POST", "/search", { key: f.keyB, body: { query: "session set-up" } })).status).toBe(200); // another key is unaffected
    now += 60_000;
    expect((await hit()).status).toBe(200);
  });
  it("also limits the MCP HTTP endpoint", async () => {
    const rpc = () => new Request("http://localhost/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${f.keyA}`, "x-request-id": "mcp-req-00001" } });
    for (let i = 0; i < 5; i++) expect((await handleMcpHttp(rpc(), f, limiter)).status).toBe(200);
    const r = await handleMcpHttp(rpc(), f, limiter);
    expect(r.status).toBe(429);
    expect(r.headers.get("x-request-id")).toBe("mcp-req-00001");
  });
});

describe("streaming (SSE)", () => {
  const parse = (text: string) => text.split("\n\n").filter((b) => b.startsWith("event:")).map((b) => ({ event: /event: (.*)/.exec(b)![1], data: JSON.parse(/data: (.*)/.exec(b)![1]) }));
  it("streams accepted, steps in order, then the signed final verdict", async () => {
    const r = await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "lcp100" }, headers: { accept: "text/event-stream" } });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const ev = parse(await r.text());
    expect(ev.map((e) => e.event === "step" ? `step:${e.data.name}` : e.event)).toEqual(["accepted", "step:retrieval", "step:assessment", "step:attestation", "final"]);
    expect(ev.at(-1)!.data).toMatchObject({ verdict: "conformant", attestation: { signature: expect.stringMatching(/^sig-/) }, call: { signed: true } });
    expect(ev[0].data.request_id).toBe(ev.at(-1)!.data.call.request_id);
  });
  it("ends with an error event (not a broken stream) when the check fails", async () => {
    const r = await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "lcp100", clause: "9.9.9" }, headers: { accept: "text/event-stream" } });
    const ev = parse(await r.text());
    expect(ev.at(-1)).toMatchObject({ event: "error", data: { error: { code: "clause_not_found" } } });
  });
});

describe("usage per request", () => {
  it("records tokens and keeps the cost null when no price is configured", async () => {
    await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "lcp100" } });
    expect(f.calls.rows.at(-1)).toMatchObject({ llmCalls: 1, inputTokens: 100, outputTokens: 50, costUsd: null });
  });
  it("estimates the cost only when every model used has a price", async () => {
    process.env.MODEL_PRICES_JSON = JSON.stringify({ "test/model": { inPerMTok: 2, outPerMTok: 10 } });
    try {
      await call("POST", "/check", { key: f.keyA, body: { requirement_text: REQ, spec_id: "lcp100" } });
      expect(f.calls.rows.at(-1)!.costUsd).toBeCloseTo((100 * 2 + 50 * 10) / 1e6, 10);
    } finally { delete process.env.MODEL_PRICES_JSON; }
  });
});

describe("GET /api/healthz", () => {
  it("is 200 when the database and the sidecar answer, 503 (naming the failing check) otherwise", async () => {
    const ok = await handleHealth({ database: async () => undefined, sidecar: async () => undefined });
    expect(ok.status).toBe(200);
    const down = await handleHealth({ database: async () => undefined, sidecar: async () => { throw new Error("secret detail"); } });
    expect(down.status).toBe(503);
    const j = await down.json();
    expect(j.checks.sidecar.ok).toBe(false); expect(j.checks.database.ok).toBe(true);
    expect(JSON.stringify(j)).not.toContain("secret detail");
  });
});
