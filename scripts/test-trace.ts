// Offline tests for the per-requirement TRACE (lib/trace.ts): what is stored, and what must NEVER be stored in the trace.
// Run: npx tsx scripts/test-trace.ts
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { buildTrace } from "../lib/trace";
import { judge, type JudgeDeps } from "../lib/graph/judge";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };
const sha = (s: string) => createHash("sha256").update(s.replace(/\s+/g, " ").trim(), "utf8").digest("hex");

const CLAUSE = "5.3.5 Session update\nThe terminal shall apply the parameters carried by the SessionUpdate message in the order received and shall not release the session before it has answered with a SessionUpdateComplete message.";
const QUOTE_OK = "The terminal shall apply the parameters carried by the SessionUpdate message in the order received";
const QUOTE_BAD = "The terminal shall not release the session until it has answered with a SessionUpdateComplete message";
const VERIFIER = { agrees: false, confidence: 0.95, note: "note" };
const base = { rawVerdict: "gap" as const, assessorConfidence: 0.99, clauseText: CLAUSE, blockedReason: undefined, gapCheck: undefined, verifier: VERIFIER, finalVerdict: "gap" as const };

// 1. an accepted quote: stored with its text (the same text is already stored as the citation excerpt)
let t = buildTrace({ ...base, quote: QUOTE_OK });
check("accepted quote: status verified, text kept (already stored as the excerpt), hash and length present",
  t.trace.assessor.quote.status === "verified" && t.trace.assessor.quote.text === QUOTE_OK && t.trace.assessor.quote.sha256 === sha(QUOTE_OK) && t.trace.assessor.quote.length === QUOTE_OK.length);
check("accepted quote: nothing goes to the local rejected-quote table", t.rejectedQuoteText === undefined);

// 2. a rejected quote: hash + length in the trace, full text ONLY in the separate local table payload
t = buildTrace({ ...base, quote: QUOTE_BAD, blockedReason: "citation_not_verbatim", finalVerdict: "insufficient_evidence" });
const json = JSON.stringify(t.trace);
check("rejected quote: status not_verbatim, hash and length stored", t.trace.assessor.quote.status === "not_verbatim" && t.trace.assessor.quote.sha256 === sha(QUOTE_BAD) && t.trace.assessor.quote.length === QUOTE_BAD.length);
check("rejected quote: the text appears NOWHERE in the trace JSON (not even partially: no 8-word window)",
  !json.includes(QUOTE_BAD) && !json.includes("until it has answered") && !("text" in t.trace.assessor.quote));
check("rejected quote: the full text is returned separately for the local table", t.rejectedQuoteText === QUOTE_BAD);
check("trace carries raw verdict, confidence, guard reason and the verifier's note/confidence",
  t.trace.assessor.rawVerdict === "gap" && t.trace.assessor.confidence === 0.99 && t.trace.guard.reason === "citation_not_verbatim" &&
  t.trace.verifier.agrees === false && t.trace.verifier.confidence === 0.95 && t.trace.verifier.note === "note" && t.trace.finalVerdict === "insufficient_evidence");

// 3. exact but too short
t = buildTrace({ ...base, quote: "The terminal shall", blockedReason: "citation_too_short", finalVerdict: "insufficient_evidence" });
check("too-short quote: status too_short, handled like a rejected quote (no text in the trace)", t.trace.assessor.quote.status === "too_short" && !("text" in t.trace.assessor.quote) && t.rejectedQuoteText === "The terminal shall");

// 4. no quote at all
t = buildTrace({ ...base, rawVerdict: "insufficient_evidence", quote: undefined, finalVerdict: "insufficient_evidence" });
check("no quote: status none, nothing stored, nothing to the local table", t.trace.assessor.quote.status === "none" && t.trace.assessor.quote.length === 0 && t.rejectedQuoteText === undefined);

// 5. the gap check summary: booleans and outcome only (its passage / raw replies / words copied from the clause are never kept)
t = buildTrace({ ...base, quote: QUOTE_OK, finalVerdict: "insufficient_evidence", blockedReason: "gap_off_subject",
  gapCheck: { guard: "verifier", outcome: "gap_off_subject", detail: "x", passage: CLAUSE, notes: ["NOTE: n"], rawReplies: ["{\"passage_words\":\"in the order received\"}"], parsed: { same_subject: false, contradicts: false, passage_words: "in the order received" } } as never });
check("gap check: outcome and the two answers only; no passage, no raw reply, no copied words",
  t.trace.gapCheck?.outcome === "gap_off_subject" && t.trace.gapCheck.sameSubject === false && t.trace.gapCheck.contradicts === false &&
  !JSON.stringify(t.trace.gapCheck).includes("order received") && !("passage" in t.trace.gapCheck!));
check("trace has a version tag", t.trace.version === "trace-v1");

// 6. judge(): the trace is produced by the real judge with stubbed LLM calls
const cite = [{ spec: "LCP", version: "1", release: "d", clause: "5.3.5", text: CLAUSE, normative: "shall_not" as const, display: "3GPP LCP v1 §5.3.5" }];
const deps = (quote: string): JudgeDeps => ({
  assess: async () => ({ verdict: "gap", confidence: 0.99, normative: "shall_not", quote, gapNote: "n" }),
  verify: async () => ({ agrees: false, confidence: 0.95, note: "v-note" }),
  clauseText: async () => CLAUSE,
  gapCheckCall: async () => "{}",
});
async function judgeTests() {
  process.env.GAP_GUARD = "verifier"; process.env.OPENROUTER_MODEL = "anthropic/x"; process.env.OPENROUTER_VERIFIER_MODEL = "google/y";
  const j = await judge("The terminal shall release the session immediately.", "lcp", cite, deps(QUOTE_BAD));
  check("judge: a rejected quote yields a trace with the raw verdict 'gap', the guard reason and the quote hash; text only in rejectedQuoteText",
    j.trace.assessor.rawVerdict === "gap" && j.trace.guard.reason === "citation_not_verbatim" && j.trace.assessor.quote.sha256 === sha(QUOTE_BAD) &&
    !JSON.stringify(j.trace).includes(QUOTE_BAD) && j.rejectedQuoteText === QUOTE_BAD, JSON.stringify(j.trace));
}

// 7. static guarantees: the local table is never read by an export, an API route, a page or the attestation code
function walk(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() && !["node_modules", ".next"].includes(e.name) ? walk(`${dir}/${e.name}`) : e.isFile() && /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []); }
const users = [...walk("app"), ...walk("lib"), ...walk("components")].filter((f) => /\.rejectedQuote\b|"rejectedQuote"|\bRejectedQuote\b/.test(readFileSync(f, "utf8")));
check("only the persistence code touches the rejected-quote table (no export, API route, page or attestation code does)",
  users.length === 1 && users[0] === "lib/graph/persist.ts", JSON.stringify(users));
check("the sidecar's signed payload does not include the trace", !/trace/i.test(readFileSync("vidimus-svc/trust.py", "utf8").split("def signed_payload")[1].split("def load_trusted")[0]));

judgeTests().then(() => {
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall trace tests passed");
});
