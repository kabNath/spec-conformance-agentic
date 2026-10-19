// Per-endpoint latency, tokens and cost of the calls recorded in McpToolCall (REST /api/v1 and MCP), from the database.
//   npm run cost-report -- [--days 7] [--org <orgId>]
// p50/p95 are nearest-rank percentiles of latencyMs. Cost is the mean over the calls that HAVE a cost estimate: it needs
// MODEL_PRICES_JSON at call time (lib/usage.ts), otherwise it is shown as n/a. Nothing here is estimated after the fact.
import { PrismaClient } from "@prisma/client";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export interface Row { tool: string; channel: string; outcome: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null; costUsd: number | null }

export function summarize(rows: Row[]) {
  const by = new Map<string, Row[]>();
  for (const r of rows) { const k = `${r.channel}  ${r.tool}`; (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  return [...by.entries()].sort().map(([endpoint, rs]) => {
    const lat = rs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const withTok = rs.filter((r) => r.inputTokens !== null);
    const withCost = rs.filter((r) => r.costUsd !== null);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      endpoint, n: rs.length, ok: rs.filter((r) => r.outcome === "ok").length, abstained: rs.filter((r) => r.outcome === "abstained").length,
      error: rs.filter((r) => r.outcome === "error").length, p50: percentile(lat, 50), p95: percentile(lat, 95),
      meanIn: mean(withTok.map((r) => r.inputTokens!)), meanOut: mean(withTok.map((r) => r.outputTokens!)),
      meanUsd: mean(withCost.map((r) => r.costUsd!)), costN: withCost.length,
    };
  });
}

async function main() {
  const days = Number(arg("days") ?? 7), org = arg("org");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.mcpToolCall.findMany({
      where: { createdAt: { gte: new Date(Date.now() - days * 86_400_000) }, ...(org ? { orgId: org } : {}) },
      select: { tool: true, channel: true, outcome: true, latencyMs: true, inputTokens: true, outputTokens: true, costUsd: true },
    });
    console.log(`Calls in the last ${days} day(s)${org ? ` for ${org}` : ""}: ${rows.length}\n`);
    const f = (x: number | null, d = 0) => (x === null || Number.isNaN(x) ? "n/a" : x.toFixed(d));
    console.log(["endpoint".padEnd(40), "n", "ok", "abst", "err", "p50 ms", "p95 ms", "tok in", "tok out", "mean $ (n)"].join("\t"));
    for (const s of summarize(rows))
      console.log([s.endpoint.padEnd(40), s.n, s.ok, s.abstained, s.error, f(s.p50), f(s.p95), f(s.meanIn), f(s.meanOut), s.costN ? `${f(s.meanUsd, 4)} (${s.costN})` : "n/a (set MODEL_PRICES_JSON)"].join("\t"));
  } finally { await prisma.$disconnect(); }
}
if (process.argv[1]?.endsWith("cost-report.ts")) main().catch((e) => { console.error(e); process.exit(1); });
