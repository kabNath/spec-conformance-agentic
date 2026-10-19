import { handleHealth } from "@/api/health";
import { prisma } from "@/lib/clients/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIDECAR = process.env.VIDIMUS_URL ?? "http://localhost:4319";

export const GET = () => handleHealth({
  database: async () => { await prisma.$queryRaw`SELECT 1`; },
  sidecar: async () => { const r = await fetch(`${SIDECAR}/health`, { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error(String(r.status)); },
});
