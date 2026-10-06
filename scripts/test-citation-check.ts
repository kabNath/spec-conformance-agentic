// Offline unit test for the deterministic citation guards — no LLM, no database.
// Run: npx tsx scripts/test-citation-check.ts
import { judge, type JudgeDeps } from "../lib/graph/judge";
import { guardVerdict, gapVerifierDecision, isVerbatim, modelFamily, normalizeWs } from "../lib/citation-check";

// Paraphrased fixture shaped like TS 38.331 §5.3.5.3 (spec text itself is not redistributed).
const CLAUSE_5353 =
  "The terminal shall apply the received RRCReconfiguration settings on reception of the message:\n" +
  "  1> if the message includes a groupSettings field:\n" +
  "  2> store the group settings carried by the field.";

// R10 (EVAL.md): out-of-scope requirement, wrong `gap` asserted at 0.95 and endorsed by the verifier.
const R10 = "The UE persists every received RRCReconfiguration to local storage for 30 days for audit purposes.";
const R10_QUOTE = "The terminal shall apply the received RRCReconfiguration settings on reception of the message";

const CLAUSE_T300 = "Upon T999 expiry, the terminal shall flush the buffer, drop the stored profile and run the recovery steps listed in clause 7.1."

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failed++;
}

// --- verbatim -------------------------------------------------------------
check("whitespace is normalised", normalizeWs(" a \n\t b  c ") === "a b c");
check("quote matches across line breaks / indentation",
  isVerbatim("on reception of the message: 1> if the message includes a groupSettings field", CLAUSE_5353));
check("paraphrase is not verbatim", !isVerbatim("The UE must apply any reconfiguration it receives", CLAUSE_5353));
check("one changed word is not verbatim", !isVerbatim("The terminal shall apply the received RRCReconfiguration values on reception of the message", CLAUSE_5353));
check("tiny quote is rejected", !isVerbatim("The UE", CLAUSE_5353));
check("empty / missing quote is rejected", !isVerbatim("", CLAUSE_5353) && !isVerbatim(undefined, CLAUSE_5353));

// --- guards ---------------------------------------------------------------
let g = guardVerdict({ verdict: "conformant", quote: "invented text that is not in the clause at all", requirement: R10, clauseText: CLAUSE_5353 });
check("non-verbatim quote forces insufficient_evidence / citation_not_verbatim",
  g.verdict === "insufficient_evidence" && g.reason === "citation_not_verbatim", JSON.stringify(g));

g = guardVerdict({ verdict: "insufficient_evidence", quote: "", requirement: R10, clauseText: CLAUSE_5353 });
check("insufficient_evidence needs no quote", g.verdict === "insufficient_evidence" && !g.reason);

g = guardVerdict({ verdict: "gap", quote: R10_QUOTE, requirement: R10, clauseText: CLAUSE_5353 });
check("R10: a verbatim but off-subject quote can no longer commit a gap",
  g.verdict === "insufficient_evidence" && g.reason === "gap_not_grounded", JSON.stringify(g));

g = guardVerdict({ verdict: "gap", quote: "Upon T999 expiry, the terminal shall flush the buffer, drop the stored profile",
  requirement: "Upon T999 expiry the terminal keeps the stored profile and does not flush the buffer.", clauseText: CLAUSE_T300 });
check("a gap whose shall-sentence is about the requirement's subject is allowed",
  g.verdict === "gap" && !g.reason, JSON.stringify(g));

g = guardVerdict({ verdict: "gap", quote: "store the group settings carried by the field",
  requirement: "The UE ignores the groupSettings received in an RRCReconfiguration message.", clauseText: CLAUSE_5353 });
check("a gap needs a normative word in the excerpt itself (no shall/must → not grounded)",
  g.verdict === "insufficient_evidence" && g.reason === "gap_not_grounded", JSON.stringify(g));

g = guardVerdict({ verdict: "conformant", quote: R10_QUOTE, requirement: R10, clauseText: CLAUSE_5353 });
check("conformant only needs a verbatim quote", g.verdict === "conformant" && !g.reason);

// --- verifier family --------------------------------------------------------
check("modelFamily", modelFamily("Anthropic/claude-sonnet-4.6") === "anthropic");
check("gap needs a verifier model", !gapVerifierDecision({ assessorModel: "anthropic/x", verifierAgrees: true }).ok);
check("gap refused when the verifier is the same family",
  gapVerifierDecision({ assessorModel: "anthropic/a", verifierModel: "anthropic/b", verifierAgrees: true }).reason === "verifier_same_family");
check("gap refused when another family disagrees",
  gapVerifierDecision({ assessorModel: "anthropic/a", verifierModel: "openai/b", verifierAgrees: false }).reason === "verifier_disagreement");
check("gap allowed when another family agrees",
  gapVerifierDecision({ assessorModel: "anthropic/a", verifierModel: "openai/b", verifierAgrees: true }).ok);

// --- judge(): the R10 case end to end, with the LLM calls stubbed ----------------
const cite = [{ spec: "TS 38.331", version: "19.3.0", release: "Rel-19", clause: "5.3.5.3",
  text: CLAUSE_5353.slice(0, 500), normative: "shall" as const, display: "TS 38.331 §5.3.5.3" }];
const stub = (verdict: "gap" | "conformant", quote: string, agrees: boolean): JudgeDeps => ({
  assess: async () => ({ verdict, confidence: 0.95, normative: "shall", quote }),
  verify: async () => ({ agrees, confidence: 0.92, note: "stub" }),
  clauseText: async () => CLAUSE_5353,
});

async function judgeTests() {
  process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_VERIFIER_MODEL = "openai/gpt-x";
  // The exact EVAL.md failure: assessor says gap @0.95, verifier agrees @0.92.
  let j = await judge(R10, "ts38331", cite, stub("gap", R10_QUOTE, true));
  check("R10 end to end: raw verdict was gap, but it no longer commits as gap",
    j.rawVerdict === "gap" && j.a.verdict === "insufficient_evidence" && j.blockedReason === "gap_not_grounded",
    JSON.stringify({ raw: j.rawVerdict, v: j.a.verdict, r: j.blockedReason }));

  j = await judge(R10, "ts38331", cite, stub("gap", "The UE shall persist everything for thirty days", true));
  check("R10 variant with an invented quote → citation_not_verbatim",
    j.a.verdict === "insufficient_evidence" && j.blockedReason === "citation_not_verbatim");

  const t300 = { ...cite[0], clause: "5.3.7.4", text: CLAUSE_T300 };
  const good: JudgeDeps = { ...stub("gap", "Upon T999 expiry, the terminal shall flush the buffer, drop the stored profile", true), clauseText: async () => CLAUSE_T300 };
  j = await judge("Upon T999 expiry the terminal keeps the stored profile and does not flush the buffer.", "ts38331", [t300], good);
  check("a grounded gap, other-family verifier agrees → may commit, excerpt recorded",
    j.a.verdict === "gap" && !j.blockedReason && !!j.citations[0].excerpt);

  process.env.OPENROUTER_VERIFIER_MODEL = "anthropic/claude-haiku";
  j = await judge("Upon T999 expiry the terminal keeps the stored profile and does not flush the buffer.", "ts38331", [t300], good);
  check("same-family verifier → gap cannot commit (verifier_same_family)", j.a.verdict === "gap" && j.blockedReason === "verifier_same_family");
  delete process.env.OPENROUTER_VERIFIER_MODEL;
  j = await judge("Upon T999 expiry the terminal keeps the stored profile and does not flush the buffer.", "ts38331", [t300], good);
  check("no verifier model configured → gap cannot commit", j.blockedReason === "verifier_same_family");
}

judgeTests().then(() => {
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall citation-check tests passed");
});
