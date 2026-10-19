// GET /api/healthz: is the process able to serve? Checks the database and the signing sidecar (3 s each).
// Unauthenticated on purpose (load balancers call it) and therefore reveals nothing but ok/not ok and latency.
export interface HealthDeps { database(): Promise<void>; sidecar(): Promise<void> }

async function probe(fn: () => Promise<void>): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try { await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]); return { ok: true, ms: Date.now() - t0 }; }
  catch { return { ok: false, ms: Date.now() - t0 }; }
}

export async function handleHealth(deps: HealthDeps): Promise<Response> {
  const [database, sidecar] = await Promise.all([probe(deps.database), probe(deps.sidecar)]);
  const ok = database.ok && sidecar.ok;
  return new Response(JSON.stringify({ status: ok ? "ok" : "degraded", checks: { database, sidecar } }),
    { status: ok ? 200 : 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
