// LOCAL analysis of quotes that the verbatim guard rejected, read from the local rejected-quote table.
//   npm run ... : npx tsx --env-file=.env.local scripts/analyze-rejected-quote.ts <runId> "<requirement substring>"
// Compares the quote to the cited clause word by word and says why it is not an exact slice. Demo text only (invented).
import { readFileSync } from "node:fs";
import { prisma } from "../lib/clients/prisma";
import { parseSpec } from "../lib/parser-3gpp";
import { normalizeWs } from "../lib/citation-check";

const toks = (s: string) => normalizeWs(s).split(" ").filter(Boolean);

(async () => {
  const [runId, sub] = process.argv.slice(2);
  const rows = await prisma.evaluatedRequirement.findMany({ where: { runId }, include: { rejectedQuote: true } });
  const tree = parseSpec(readFileSync("examples/ts38331-extrait.txt", "utf8"), { spec: "LCP Demo", version: "1.0", release: "demo" });
  for (const r of rows.filter((x) => x.rejectedQuote && (!sub || x.requirement.includes(sub)))) {
    const clauseId = (r.citations as { clause: string }[])[0].clause;
    const clause = String(tree.nodes[clauseId].text), q = r.rejectedQuote!.text;
    const t = r.trace as { assessor: { rawVerdict: string; confidence: number; quote: { status: string; length: number; sha256: string } }; guard: { reason: string } };
    console.log("=".repeat(100));
    console.log("requirement :", r.requirement);
    console.log("trace       : raw verdict =", t.assessor.rawVerdict, "| assessor confidence =", t.assessor.confidence, "| quote status =", t.assessor.quote.status, "| guard =", t.guard.reason, "| quote length =", t.assessor.quote.length);
    console.log("quote       :", JSON.stringify(q));
    console.log("clause", clauseId, "(", clause.length, "chars ):", JSON.stringify(normalizeWs(clause)));
    console.log("--- is the whitespace-normalised quote a substring of the whitespace-normalised clause?", normalizeWs(clause).includes(normalizeWs(q)));
    const Q = toks(q), C = toks(clause);
    // longest common run of tokens (dynamic programming)
    let best = { len: 0, qi: 0, ci: 0 };
    const dp: number[][] = Array.from({ length: Q.length + 1 }, () => new Array(C.length + 1).fill(0));
    for (let i = 1; i <= Q.length; i++) for (let j = 1; j <= C.length; j++) if (Q[i - 1] === C[j - 1]) { dp[i][j] = dp[i - 1][j - 1] + 1; if (dp[i][j] > best.len) best = { len: dp[i][j], qi: i - dp[i][j], ci: j - dp[i][j] }; }
    console.log(`--- token alignment: ${Q.length} quote tokens; longest verbatim run = ${best.len} tokens (quote tokens ${best.qi}–${best.qi + best.len - 1}, clause tokens ${best.ci}–${best.ci + best.len - 1})`);
    console.log("    quote tokens NOT in that run  :", JSON.stringify([...Q.slice(0, best.qi), "|RUN|", ...Q.slice(best.qi + best.len)].join(" ")));
    const cw = new Set(C); console.log("    quote words absent from the clause:", JSON.stringify(Q.filter((w) => !cw.has(w))));
    const qs = new Set(Q); console.log("    clause words (same stretch) absent from the quote:", JSON.stringify(C.slice(best.ci, best.ci + Q.length + 3).filter((w) => !qs.has(w))));
    // character-level: first differing character of the whitespace-normalised quote against its best-aligned clause region
    const nq = normalizeWs(q), nc = normalizeWs(clause);
    let k = 0; const start = nc.indexOf(Q.slice(best.qi, best.qi + 2).join(" "));
    console.log("    punctuation-insensitive match?", nc.replace(/[^\w ]/g, "").includes(nq.replace(/[^\w ]/g, "")), "| case-insensitive match?", nc.toLowerCase().includes(nq.toLowerCase()));
    void k; void start;
  }
  await prisma.$disconnect();
})();
