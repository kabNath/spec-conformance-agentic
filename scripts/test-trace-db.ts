// Database test for the trace + the local rejected-quote table (needs the local Postgres; skipped without DATABASE_URL).
//   npm run test:db            (= tsx --env-file=.env.local scripts/test-trace-db.ts)
// Creates a throw-away organisation, run and rows, checks what is stored where, then deletes everything it created.
import { prisma } from "../lib/clients/prisma";
import { persistRows, type RowToPersist } from "../lib/graph/persist";
import { buildTrace } from "../lib/trace";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

(async () => {
  if (!process.env.DATABASE_URL) { console.log("⏭  skipped: DATABASE_URL is not set (run with `npm run test:db`)"); process.exit(0); }
  const orgId = `org_test_trace_${Date.now()}`;
  const CLAUSE = "The terminal shall apply the parameters in the order received and shall not release the session before it has answered.";
  const QUOTE = "The terminal shall not release the session until it has answered";
  try {
    await prisma.organization.create({ data: { id: orgId, name: orgId } });
    const run = await prisma.conformanceRun.create({ data: { orgId, name: "trace test", status: "running" } });
    const mk = (id: string, quote: string | undefined, blocked?: "citation_not_verbatim"): RowToPersist => {
      const { trace, rejectedQuoteText } = buildTrace({ rawVerdict: "gap", assessorConfidence: 0.99, quote, clauseText: CLAUSE, blockedReason: blocked, verifier: { agrees: false, confidence: 0.95, note: "n" }, finalVerdict: blocked ? "insufficient_evidence" : "gap" });
      return { id, runId: run.id, requirement: "r", source: { documentId: "d", documentName: "n" }, citations: [], verdict: blocked ? "insufficient_evidence" : "gap", normative: "shall",
        confidence: 0.5, verifier: { agrees: false, confidence: 0.95, note: "n" }, review: { required: true }, model: "m", evaluatedAt: new Date().toISOString(), trace, rejectedQuoteText } as RowToPersist;
    };
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    await persistRows(prisma, orgId, [mk(a, "The terminal shall apply the parameters in the order received"), mk(b, QUOTE, "citation_not_verbatim")]);

    const rows = await prisma.evaluatedRequirement.findMany({ where: { runId: run.id, orgId } });
    const rowA = rows.find((r) => r.id === a)!, rowB = rows.find((r) => r.id === b)!;
    check("the trace column is stored as JSON on both rows", !!rowA.trace && !!rowB.trace);
    check("accepted quote: text in the trace", (rowA.trace as any).assessor.quote.text?.startsWith("The terminal shall apply"));
    check("rejected quote: only hash + length in the trace, no text", (rowB.trace as any).assessor.quote.length === QUOTE.length && !JSON.stringify(rowB.trace).includes("until it has answered"));
    const rq = await prisma.rejectedQuote.findMany({ where: { orgId } });
    check("exactly one rejected quote is kept in the local table, with its text, hash and length", rq.length === 1 && rq[0].requirementId === b && rq[0].text === QUOTE && rq[0].length === QUOTE.length && rq[0].sha256 === (rowB.trace as any).assessor.quote.sha256);
    check("reading rows (as the API / export routes do) never returns the rejected text", !("rejectedQuote" in rowB) && !JSON.stringify(rows).includes("until it has answered"));
    await prisma.conformanceRun.delete({ where: { id: run.id } });
    check("deleting the run deletes its rejected quotes (cascade)", (await prisma.rejectedQuote.count({ where: { orgId } })) === 0);
  } finally {
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => null);
    await prisma.$disconnect();
  }
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall trace database tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
