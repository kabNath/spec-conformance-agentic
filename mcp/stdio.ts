// stdio transport: one process, one API key (CONFORMANCE_API_KEY), one organisation.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticate } from "./auth";
import type { McpDeps } from "./deps";
import { createMcpServer } from "./server";

export async function runStdio(deps: McpDeps, apiKey = process.env.CONFORMANCE_API_KEY): Promise<void> {
  const principal = await authenticate(deps.keys, apiKey); // fails before anything is served
  await createMcpServer(deps, principal).connect(new StdioServerTransport());
  console.error(`[conformance-mcp] ready (organisation ${principal.orgId})`); // stdout is the protocol channel: log on stderr only
}
