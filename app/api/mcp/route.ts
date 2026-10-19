// MCP over streamable HTTP. Auth is the API key, not a Clerk session (middleware.ts does not protect /api/mcp).
import { handleMcpHttp } from "@/mcp/http";
import { createRealDeps } from "@/mcp/real-deps";

export const runtime = "nodejs";
export const maxDuration = 300;

const deps = createRealDeps();
export const POST = (req: Request) => handleMcpHttp(req, deps);
export const GET = POST;     // answered with 405 by the handler
export const DELETE = POST;
