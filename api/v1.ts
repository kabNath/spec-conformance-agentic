// REST API /api/v1, a thin layer over the same operations as the MCP tools (mcp/operations.ts):
//   POST /check (SSE with Accept: text/event-stream), POST /search, POST /extract, GET /verdicts/{id}, POST /verdicts/{id}/verify
// Auth: Authorization: Bearer <API key> (the key identifies the organisation). Every request gets an X-Request-Id
// (the caller's, if well formed) which is echoed, stored with the call record and kept in the verdict's trace.
import { randomUUID } from "node:crypto";
import type { ZodTypeAny, z } from "zod";
import { authenticate, type Principal } from "../mcp/auth";
import type { McpDeps } from "../mcp/deps";
import { McpToolError, type ErrorCode, toErrorBody } from "../mcp/errors";
import { extractInputForRecord, instrument, makeOps, type Done } from "../mcp/operations";
import { CheckConformanceInput, ExtractRequirementsInput, SearchSpecInput, VerdictIdInput } from "../mcp/schemas";
import type { RateLimiter } from "./rate-limit";

export const ROUTES = [
  "POST /check", "POST /search", "POST /extract", "GET /verdicts/{id}", "POST /verdicts/{id}/verify",
] as const;

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401, invalid_input: 400, spec_not_found: 404, clause_not_found: 404, verdict_not_found: 404, no_attestation: 409,
  rate_limited: 429, upstream_unavailable: 502, audit_failed: 503, internal: 500,
};
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const fail = (e: McpToolError, headers: Record<string, string>) => json(STATUS[e.code], toErrorBody(e), headers);

async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new McpToolError("invalid_input", "Body must be JSON"); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new McpToolError("invalid_input", "Invalid input", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}

export async function handleV1(req: Request, deps: McpDeps, limiter: RateLimiter): Promise<Response> {
  const given = req.headers.get("x-request-id");
  const requestId = given && REQUEST_ID.test(given) ? given : randomUUID();
  const h: Record<string, string> = { "X-Request-Id": requestId };

  const path = new URL(req.url).pathname.replace(/^.*\/api\/v1/, "") || "/";
  const route = ROUTES.find((r) => {
    const [m, p] = r.split(" ");
    return m === req.method && new RegExp("^" + p.replace("{id}", "[^/]+") + "$").test(path);
  });
  if (!route) return json(404, { error: { code: "invalid_input", message: "Unknown endpoint" } }, h);

  let principal: Principal;
  try { principal = await authenticate(deps.keys, /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]); }
  catch (e) { return fail(e instanceof McpToolError ? e : new McpToolError("internal", "Authentication failed"), { ...h, "WWW-Authenticate": "Bearer" }); }

  const rl = limiter.check(principal.apiKeyId);
  Object.assign(h, { "RateLimit-Limit": String(rl.limit), "RateLimit-Remaining": String(rl.remaining) });
  if (!rl.ok) return fail(new McpToolError("rate_limited", "Too many requests for this API key", { retry_after_seconds: rl.retryAfterSec }), { ...h, "Retry-After": String(rl.retryAfterSec) });

  const ops = makeOps(deps, principal);
  const meta = (tool: string) => ({ tool: `${req.method} /api/v1${route.split(" ")[1]}`.replace("{id}", ":id") || tool, channel: "http" as const, requestId });
  const id = path.split("/")[2];

  try {
    const run = async (input: unknown, fn: (rid: string) => Promise<Done>) => {
      const r = await instrument(deps, principal, meta(route), input, fn);
      return json(r.ok ? 200 : STATUS[r.error?.code ?? "internal"], r.body, h);
    };
    switch (route) {
      case "POST /search": { const b = await parseBody(req, SearchSpecInput); return await run(b, () => ops.searchSpec(b)); }
      case "POST /extract": { const b = await parseBody(req, ExtractRequirementsInput); return await run(extractInputForRecord(b), () => ops.extractRequirements(b)); }
      case "GET /verdicts/{id}": { const b = VerdictIdInput.parse({ verdict_id: id }); return await run(b, () => ops.getVerdict(b)); }
      case "POST /verdicts/{id}/verify": { const b = VerdictIdInput.parse({ verdict_id: id }); return await run(b, () => ops.verifyVerdict(b)); }
      case "POST /check": {
        const b = await parseBody(req, CheckConformanceInput);
        if (!(req.headers.get("accept") ?? "").includes("text/event-stream"))
          return await run(b, (rid) => ops.checkConformance(b, { requestId: rid }));
        return sse(h, async (send) => {
          send("accepted", { request_id: requestId });
          const r = await instrument(deps, principal, meta(route), b, (rid) => ops.checkConformance(b, { requestId: rid, onStep: (s) => send("step", s) }));
          send(r.ok ? "final" : "error", r.body);
        });
      }
    }
  } catch (e) {
    if (e instanceof McpToolError) return fail(e, h);
    if (e && typeof e === "object" && "issues" in e) return fail(new McpToolError("invalid_input", "Invalid input"), h); // zod, from the id check
    console.error(`[api] ${req.method} ${path} ${requestId}:`, e);
    return fail(new McpToolError("internal", "Unexpected error", { request_id: requestId }), h);
  }
}

/** Server-sent events: `event: <name>\ndata: <json>`; a comment line every 10 s keeps proxies from closing a slow run. */
function sse(h: Record<string, string>, work: (send: (event: string, data: unknown) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => { if (open) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const keepalive = setInterval(() => { if (open) controller.enqueue(enc.encode(": keepalive\n\n")); }, 10_000);
      try { await work(send); }
      catch (e) { console.error("[api] stream failed:", e); send("error", toErrorBody(new McpToolError("internal", "Unexpected error"))); }
      finally { clearInterval(keepalive); open = false; controller.close(); }
    },
  });
  return new Response(stream, { headers: { ...h, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
