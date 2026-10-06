// Offline tests for the "Norm" column: force of the sentence that GOVERNS the requirement (lib/normative.ts).
// Run: npx tsx scripts/test-normative.ts
import { governingNormative } from "../lib/normative";
import { judge, type JudgeDeps } from "../lib/graph/judge";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

// Invented clause with the structure that fooled the old rule: one clause, a "shall" AND a "shall not" in the same sentence.
const CLAUSE =
  "5.3.5 Session update\n" +
  "The purpose of this procedure is to change an open session, for example to add, modify or remove a traffic channel. " +
  "The terminal shall apply the parameters carried by the SessionUpdate message in the order received and shall not release the session before it has answered with a SessionUpdateComplete message. " +
  "If a parameter cannot be applied, the terminal starts the recovery steps described in clause 5.3.3.";
const R_ORDER = "The terminal shall apply the parameters of a SessionUpdate message in an arbitrary order.";
const R_COMPLETE = "The terminal shall send a SessionUpdateComplete message only if at least one parameter from the SessionUpdate message was applied successfully.";
const R_RELEASE = "The terminal shall release the session immediately after receiving a SessionUpdate message, before it answers.";
const SENTENCE = "The terminal shall apply the parameters carried by the SessionUpdate message in the order received and shall not release the session before it has answered with a SessionUpdateComplete message.";

// the old rule: strongest keyword anywhere in the clause
const oldRule = (t: string) => (/\bshall not\b/i.test(t) ? "shall_not" : /\bshall\b/i.test(t) ? "shall" : "none");
check("old rule gives shall_not for all three requirements (the reported problem)", [R_ORDER, R_COMPLETE, R_RELEASE].every(() => oldRule(CLAUSE) === "shall_not"));

check("'apply in an arbitrary order' is governed by 'shall apply … in the order received' → shall", governingNormative(SENTENCE, R_ORDER)?.force === "shall");
check("the same on the whole clause text (no verified excerpt)", governingNormative(CLAUSE, R_ORDER)?.force === "shall");
check("'release the session immediately … before it answers' is governed by 'shall not release …' → shall_not", governingNormative(CLAUSE, R_RELEASE)?.force === "shall_not");
check("'send SessionUpdateComplete only if …' → the sentence with the most overlap (shall), not the strongest keyword", governingNormative(SENTENCE, R_COMPLETE)?.force === "shall");
check("a requirement with nothing in common → null (caller keeps the clause-level value)", governingNormative(CLAUSE, "The terminal lights a green LED on the front panel.") === null);
check("text without any modal → null", governingNormative("The terminal starts the recovery steps.", R_RELEASE) === null);
check("should / should not / may are recognised", governingNormative("The terminal should flush the buffer.", "The terminal flushes the buffer.")?.force === "should" &&
  governingNormative("The terminal should not flush the buffer.", "The terminal flushes the buffer.")?.force === "should_not" &&
  governingNormative("The terminal may flush the buffer.", "The terminal flushes the buffer.")?.force === "may");
check("ties go to the earliest sentence segment (deterministic)", governingNormative("The device shall stop timers. The device shall not stop timers.", "stop timers")?.force === "shall");
check("returns the governing segment (for audit), an exact slice of the text", (() => { const g = governingNormative(CLAUSE, R_RELEASE)!; return CLAUSE.includes(g.segment) && g.segment.startsWith("shall not release"); })());

// judge(): the row's normative comes from the governing sentence, with or without a verified quote
const cite = [{ spec: "LCP", version: "1", release: "d", clause: "5.3.5", text: CLAUSE, normative: "shall_not" as const, display: "3GPP LCP v1 §5.3.5" }];
const deps = (verdict: "gap" | "conformant", quote: string): JudgeDeps => ({
  assess: async () => ({ verdict, confidence: 0.97, normative: "shall_not", quote }),
  verify: async () => ({ agrees: true, confidence: 0.9, note: "stub" }),
  clauseText: async () => CLAUSE,
  gapCheckCall: async () => JSON.stringify({ same_subject: true, contradicts: true, passage_words: "in the order received", requirement_words: "in an arbitrary order" }),
});
async function judgeTests() {
  process.env.GAP_GUARD = "verifier"; process.env.OPENROUTER_MODEL = "anthropic/x"; process.env.OPENROUTER_VERIFIER_MODEL = "google/y";
  let j = await judge(R_ORDER, "lcp", cite, deps("gap", SENTENCE));
  check("judge: committed gap on the arbitrary-order requirement → normative 'shall' (was shall_not)", j.a.verdict === "gap" && j.a.normative === "shall", JSON.stringify([j.a.verdict, j.a.normative]));
  j = await judge(R_RELEASE, "lcp", cite, deps("gap", "an invented quote that is not in the clause at all"));
  check("judge: quote rejected by the verbatim guard → falls back to the clause text, still the governing sentence (shall_not)", j.blockedReason === "citation_not_verbatim" && j.a.normative === "shall_not", JSON.stringify([j.blockedReason, j.a.normative]));
  j = await judge("The terminal lights a green LED.", "lcp", cite, { ...deps("conformant", SENTENCE), assess: async () => ({ verdict: "insufficient_evidence" as const, confidence: 0.3, normative: "shall_not" as const }) });
  check("judge: nothing in common with the clause → keeps the clause-level value (no invented precision)", j.a.normative === "shall_not");
  j = await judge("x", "lcp", [], { ...deps("gap", ""), assess: async () => ({ verdict: "insufficient_evidence" as const, confidence: 0.2, normative: "none" as const }) });
  check("judge: no clause → none", j.a.normative === "none");
}
judgeTests().then(() => {
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall normative tests passed");
});
