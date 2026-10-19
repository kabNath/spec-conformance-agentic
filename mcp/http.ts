// Streamable HTTP transport, stateless: every POST is authenticated (Authorization: Bearer <api key>) and served by a
// fresh server bound to that key's organisation. No session, so nothing can leak from one tenant's request to another.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate } from "./auth";
import type { McpDeps } from "./deps";
import { McpToolError } from "./errors";
import { createMcpServer } from "./server";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function handleMcpHttp(req: Request, deps: McpDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: { code: "invalid_input", message: "POST only (stateless server)" } }, { Allow: "POST" });
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  let principal;
  try { principal = await authenticate(deps.keys, m?.[1]); }
  catch (e) {
    const err = e instanceof McpToolError ? e : new McpToolError("internal", "Authentication failed");
    return json(err.code === "unauthorized" ? 401 : 500, { error: { code: err.code, message: err.message } }, { "WWW-Authenticate": "Bearer" });
  }
  const server = createMcpServer(deps, principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(req); }
  finally { await server.close(); }
}
