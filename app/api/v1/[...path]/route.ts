// REST API v1: see api/v1.ts and docs/openapi.yaml. Auth is the API key, not a Clerk session (middleware.ts does not protect /api/v1).
import { handleV1 } from "@/api/v1";
import { limiterFromEnv } from "@/api/rate-limit";
import { createRealDeps } from "@/mcp/real-deps";

export const runtime = "nodejs";
export const maxDuration = 300;

const deps = createRealDeps();
const limiter = limiterFromEnv();
const handler = (req: Request) => handleV1(req, deps, limiter);
export const GET = handler;
export const POST = handler;
