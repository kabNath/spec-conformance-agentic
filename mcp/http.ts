// Streamable HTTP transport, stateless: every POST is authenticated (Authorization: Bearer <api key>) and served by a
// fresh server bound to that key's organisation. No session, so nothing can leak from one tenant's request to another.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate } from "./auth";
import type { McpDeps } from "./deps";
import { McpToolError } from "./errors";
import { randomUUID } from "node:crypto";
import { createMcpServer } from "./server";
import type { RateLimiter } from "../api/rate-limit";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export async function handleMcpHttp(req: Request, deps: McpDeps, limiter?: RateLimiter): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: { code: "invalid_input", message: "POST only (stateless server)" } }, { Allow: "POST" });
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  let principal;
  try { principal = await authenticate(deps.keys, m?.[1]); }
  catch (e) {
    const err = e instanceof McpToolError ? e : new McpToolError("internal", "Authentication failed");
    return json(err.code === "unauthorized" ? 401 : 500, { error: { code: err.code, message: err.message } }, { "WWW-Authenticate": "Bearer" });
  }
  const given = req.headers.get("x-request-id");
  const requestId = given && REQUEST_ID.test(given) ? given : randomUUID();
  if (limiter) {
    const rl = limiter.check(principal.apiKeyId);
    if (!rl.ok) return json(429, { error: { code: "rate_limited", message: "Too many requests for this API key" } }, { "Retry-After": String(rl.retryAfterSec), "X-Request-Id": requestId });
  }
  const server = createMcpServer(deps, principal, { requestId });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { const res = await transport.handleRequest(req); res.headers.set("X-Request-Id", requestId); return res; }
  finally { await server.close(); }
}
