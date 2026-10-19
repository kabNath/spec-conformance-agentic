import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Principal } from "./auth";
import type { McpDeps } from "./deps";
import { registerTools } from "./tools";

export const SERVER_INFO = { name: "conformance-mcp", version: "0.1.0" };

/** One server per authenticated principal: every tool is bound to that principal's organisation. */
export function createMcpServer(deps: McpDeps, principal: Principal, ctx: { requestId?: string } = {}): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: "3GPP/O-RAN conformance agent. Verdicts cite a clause; `abstained: true` means a human must review. " +
      "Typical flow: search_spec → check_conformance → verify_verdict.",
  });
  registerTools(server, deps, principal, ctx);
  return server;
}
