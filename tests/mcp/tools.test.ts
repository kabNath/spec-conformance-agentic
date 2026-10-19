import { describe, it, expect, beforeEach } from "vitest";
import { authenticate, generateApiKey, hashApiKey } from "../../mcp/auth";
import { handleMcpHttp } from "../../mcp/http";
import { ORG_A, ORG_B, connect, makeFakes, text, type Fakes } from "./fakes";

let f: Fakes;
beforeEach(() => { f = makeFakes(); });
const clientFor = (org: string) => connect(f, { orgId: org, apiKeyId: org === ORG_A ? "key-a" : "key-b" });
type Res = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown };
const call = async (c: Awaited<ReturnType<typeof clientFor>>, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as Res;

describe("tool listing and schemas", () => {
  it("exposes the five tools, each with an input and an output schema", async () => {
    const { tools } = await (await clientFor(ORG_A)).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_conformance", "extract_requirements", "get_verdict", "search_spec", "verify_verdict"]);
    for (const t of tools) { expect(t.inputSchema.type).toBe("object"); expect(t.outputSchema, t.name).toBeTruthy(); }
  });
  it("states the 12,000-character limit in the description of extract_requirements", async () => {
    const t = (await (await clientFor(ORG_A)).listTools()).tools.find((x) => x.name === "extract_requirements")!;
    expect(t.description).toContain("12,000");
    expect(JSON.stringify(t.inputSchema)).toContain("12,000");
  });
  it("rejects malformed input before running anything", async () => {
    const c = await clientFor(ORG_A);
    const r = await call(c, "search_spec", { query: "x" }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }) as Res);
    expect(r.isError).toBe(true);
    expect(f.calls.rows).toHaveLength(0);
    const r2 = await call(c, "get_verdict", { verdict_id: "not-a-uuid" }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }) as Res);
    expect(r2.isError).toBe(true);
  });
});

describe("tools", () => {
  it("search_spec returns cited hits", async () => {
    const r = await call(await clientFor(ORG_A), "search_spec", { query: "session set-up", top_k: 2 });
    const hits = r.structuredContent!.hits as { clause: string; spec_id: string; display: string }[];
    expect(hits.map((h) => h.clause)).toEqual(["5.3.3", "5.3.5"]);
    expect(hits[0].spec_id).toBe("lcp100");
    expect(hits[0].display).toContain("§5.3.3");
  });
  it("check_conformance commits a cited, attested verdict and persists it", async () => {
    const r = await call(await clientFor(ORG_A), "check_conformance", { requirement_text: "The terminal sends a SessionRequest message on set-up.", spec_id: "lcp100" });
    const s = r.structuredContent!;
    expect(s.verdict).toBe("conformant"); expect(s.abstained).toBe(false);
    expect((s.citations as unknown[]).length).toBe(1);
    expect((s.attestation as { signature: string }).signature).toMatch(/^sig-/);
    expect(f.stored.has(s.verdict_id as string)).toBe(true);
  });
  it("check_conformance reports abstention explicitly", async () => {
    const r = await call(await clientFor(ORG_A), "check_conformance", { requirement_text: "The terminal encrypts the control channel.", spec_id: "lcp100" });
    expect(r.structuredContent).toMatchObject({ abstained: true, verdict: "insufficient_evidence", review: { required: true, reason: "no_clause_found" } });
  });
  it("check_conformance accepts a clause hint and rejects an unknown one with a typed error", async () => {
    const c = await clientFor(ORG_A);
    const ok = await call(c, "check_conformance", { requirement_text: "The terminal stops timer T901 on SessionAccept.", spec_id: "lcp100", clause: "5.3.3" });
    expect((ok.structuredContent!.citations as { clause: string }[])[0].clause).toBe("5.3.3");
    const bad = await call(c, "check_conformance", { requirement_text: "The terminal stops timer T901 on SessionAccept.", spec_id: "lcp100", clause: "9.9.9" });
    expect(bad.isError).toBe(true); expect(text(bad).error.code).toBe("clause_not_found");
  });
  it("extract_requirements reports truncation beyond 12,000 characters", async () => {
    const c = await clientFor(ORG_A);
    const doc = "The terminal does A.\nThe terminal does B.";
    const small = await call(c, "extract_requirements", { document_text: doc });
    expect(small.structuredContent).toMatchObject({ truncated: false, chars_read: doc.length });
    const big = await call(c, "extract_requirements", { document_text: "The terminal does something useful.\n".repeat(500) });
    expect(big.structuredContent).toMatchObject({ truncated: true, chars_read: 12000 });
  });
  it("get_verdict and verify_verdict work on the caller's own verdict", async () => {
    const c = await clientFor(ORG_A);
    const made = (await call(c, "check_conformance", { requirement_text: "The terminal sends a SessionRequest message on set-up.", spec_id: "lcp100" })).structuredContent!;
    const got = await call(c, "get_verdict", { verdict_id: made.verdict_id });
    expect(got.structuredContent).toMatchObject({ verdict_id: made.verdict_id, verdict: "conformant" });
    const ver = await call(c, "verify_verdict", { verdict_id: made.verdict_id });
    expect(ver.structuredContent).toMatchObject({ integrity_valid: true, signer_trusted: false });
    expect(f.sidecar.verifyCalls).toBe(1);
  });
  it("verify_verdict reports a tampered signature", async () => {
    const c = await clientFor(ORG_A);
    const made = (await call(c, "check_conformance", { requirement_text: "The terminal sends a SessionRequest message on set-up.", spec_id: "lcp100" })).structuredContent!;
    f.stored.get(made.verdict_id as string)!.attestation!.signature = "forged";
    expect((await call(c, "verify_verdict", { verdict_id: made.verdict_id })).structuredContent).toMatchObject({ integrity_valid: false });
  });
});

describe("cross-organization isolation", () => {
  it("another organisation cannot read or verify a verdict, and gets the same error as for an unknown id", async () => {
    const a = await clientFor(ORG_A), b = await clientFor(ORG_B);
    const made = (await call(a, "check_conformance", { requirement_text: "The terminal sends a SessionRequest message on set-up.", spec_id: "lcp100" })).structuredContent!;
    for (const tool of ["get_verdict", "verify_verdict"]) {
      const cross = await call(b, tool, { verdict_id: made.verdict_id });
      const unknown = await call(b, tool, { verdict_id: "00000000-0000-4000-8000-000000000000" });
      expect(cross.isError).toBe(true);
      expect(text(cross).error).toEqual(text(unknown).error);
      expect(text(cross).error.code).toBe("verdict_not_found");
    }
    expect(f.sidecar.verifyCalls).toBe(0);
  });
  it("another organisation cannot use, search or list a spec it has not ingested", async () => {
    const b = await clientFor(ORG_B);
    expect(text(await call(b, "check_conformance", { requirement_text: "The terminal sends a SessionRequest message.", spec_id: "lcp100" })).error.code).toBe("spec_not_found");
    expect(text(await call(b, "search_spec", { query: "session", spec_id: "lcp100" })).error.code).toBe("spec_not_found");
    expect((await b.listResources()).resources.map((r) => r.uri)).toEqual(["spec://xyz200"]);
    await expect(b.readResource({ uri: "spec://lcp100" })).rejects.toThrow();
    expect((await (await clientFor(ORG_A)).listResources()).resources.map((r) => r.uri)).toEqual(["spec://lcp100"]);
  });
  it("tool-call records carry the caller's organisation only", async () => {
    await call(await clientFor(ORG_A), "search_spec", { query: "session set-up" });
    await call(await clientFor(ORG_B), "search_spec", { query: "session set-up" });
    expect(f.calls.rows.map((r) => r.orgId)).toEqual([ORG_A, ORG_B]);
  });
});

describe("one signed record per call", () => {
  it("writes exactly one record per call, with hashes only, and links it in the response", async () => {
    const c = await clientFor(ORG_A);
    const r1 = await call(c, "search_spec", { query: "session set-up" });
    const r2 = await call(c, "get_verdict", { verdict_id: "00000000-0000-4000-8000-000000000000" });
    expect(f.calls.rows).toHaveLength(2);
    expect(f.calls.rows[0]).toMatchObject({ tool: "search_spec", outcome: "ok", error_code: null });
    expect(f.calls.rows[0].input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.calls.rows[1]).toMatchObject({ tool: "get_verdict", outcome: "error", error_code: "verdict_not_found" });
    expect(JSON.stringify(f.calls.rows)).not.toContain("session set-up"); // no content, only hashes
    expect((r1.structuredContent!.call as { record_id: string }).record_id).toBe(f.calls.rows[0].id);
    expect(text(r2).call.record_id).toBe(f.calls.rows[1].id);
    expect(f.calls.rows[0].signed).toMatchObject({ signature: expect.any(String) });
  });
  it("records an abstention as such", async () => {
    await call(await clientFor(ORG_A), "check_conformance", { requirement_text: "The terminal encrypts the control channel.", spec_id: "lcp100" });
    expect(f.calls.rows[0].outcome).toBe("abstained");
  });
  it("still records, unsigned, when the signing sidecar is down", async () => {
    f.sidecar.signUp = false;
    const r = await call(await clientFor(ORG_A), "search_spec", { query: "session set-up" });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent!.call as { signed: boolean }).signed).toBe(false);
    expect(f.calls.rows[0].signed).toBeNull();
  });
  it("fails closed when the record cannot be stored", async () => {
    f.calls.failNext = true;
    const r = await call(await clientFor(ORG_A), "search_spec", { query: "session set-up" });
    expect(r.isError).toBe(true);
    expect(text(r).error.code).toBe("audit_failed");
  });
});

describe("API keys", () => {
  it("authenticates a valid key and nothing else", async () => {
    expect(await authenticate(f.keys, f.keyA)).toEqual({ orgId: ORG_A, apiKeyId: "key-a" });
    for (const bad of [undefined, "", "sca_short", "sca_" + "0".repeat(40), f.keyA.slice(0, -1) + "0", "Bearer " + f.keyA]) {
      await expect(authenticate(f.keys, bad)).rejects.toMatchObject({ code: "unauthorized" });
    }
  });
  it("refuses a revoked key", async () => {
    f.keyRows.forEach((r) => { if (r.id === "key-a") r.revokedAt = new Date(); });
    await expect(authenticate(f.keys, f.keyA)).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("stores only a hash, and generates distinct keys", () => {
    const k1 = generateApiKey(), k2 = generateApiKey();
    expect(k1.key).toMatch(/^sca_[0-9a-f]{40}$/); expect(k1.key).not.toBe(k2.key);
    expect(k1.keyHash).toBe(hashApiKey(k1.key)); expect(k1.keyHash).not.toContain(k1.key.slice(4));
  });
});

describe("streamable HTTP transport", () => {
  const rpc = (method: string, params: unknown, key?: string) => new Request("http://localhost/api/mcp", {
    method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
  });
  it("refuses a request without or with a wrong key (401) and non-POST methods (405)", async () => {
    expect((await handleMcpHttp(rpc("tools/list", {}), f)).status).toBe(401);
    expect((await handleMcpHttp(rpc("tools/list", {}, "sca_" + "1".repeat(40)), f)).status).toBe(401);
    expect((await handleMcpHttp(new Request("http://localhost/api/mcp", { method: "GET" }), f)).status).toBe(405);
  });
  it("serves tools/list and a tool call for the key's organisation", async () => {
    const list = await (await handleMcpHttp(rpc("tools/list", {}, f.keyA), f)).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("check_conformance");
    const res = await (await handleMcpHttp(rpc("tools/call", { name: "search_spec", arguments: { query: "session set-up" } }, f.keyB), f)).json();
    expect(res.result.structuredContent.hits.map((h: { spec_id: string }) => h.spec_id)).toEqual(["xyz200", "xyz200"]); // org B only searches ITS spec
    expect(f.calls.rows.at(-1)!.orgId).toBe(ORG_B);
  });
});
