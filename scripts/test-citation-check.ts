// Offline unit test for the deterministic citation guards — no LLM, no database.
// Run: npx tsx scripts/test-citation-check.ts
import { judge, type JudgeDeps } from "../lib/graph/judge";
import { existsSync, readFileSync } from "node:fs";
import { guardVerdict, gapVerifierDecision, isVerbatim, modelFamily, normalizeWs, MIN_QUOTE_WORDS, checkQuote, canonicalizeQuote, firstLetterCaseOnly } from "../lib/citation-check";

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

// --- citation_too_short vs citation_not_verbatim ----------------------------------------------------------
async function reasonTests() {
  const clause = "The terminal shall:\n\n1>\tstore the value;";
  let g2 = guardVerdict({ verdict: "conformant", quote: "The terminal shall:", requirement: "x", clauseText: clause });
  check("exact quote under the 4-word minimum → citation_too_short (verdict still forced to insufficient_evidence)",
    g2.verdict === "insufficient_evidence" && g2.reason === "citation_too_short", JSON.stringify(g2));
  g2 = guardVerdict({ verdict: "conformant", quote: "The device must", requirement: "x", clauseText: clause });
  check("short AND absent from the clause → citation_not_verbatim", g2.reason === "citation_not_verbatim", JSON.stringify(g2));
  g2 = guardVerdict({ verdict: "conformant", quote: "", requirement: "x", clauseText: clause });
  check("missing quote → citation_not_verbatim", g2.reason === "citation_not_verbatim", JSON.stringify(g2));
  g2 = guardVerdict({ verdict: "conformant", quote: "The terminal shall store the value of everything", requirement: "x", clauseText: clause });
  check("long but absent → citation_not_verbatim", g2.reason === "citation_not_verbatim", JSON.stringify(g2));
  check("the minimum itself is unchanged (4 words)", MIN_QUOTE_WORDS === 4 && guardVerdict({ verdict: "conformant", quote: "1> store the value;", requirement: "x", clauseText: clause.replace("1>\t", "1> ") }).reason === undefined);
  g2 = guardVerdict({ verdict: "gap", quote: "The terminal shall:", requirement: "x", clauseText: clause });
  check("a short exact quote on a gap is also citation_too_short", g2.reason === "citation_too_short");

  // R28 as it really happened (local only: needs the raw v2 results and the non-redistributable spec extract)
  if (existsSync("eval/results-v2-gapguard-1.json") && existsSync("examples/ts38331-extract.txt")) {
    const { parseSpec } = await import("../lib/parser-3gpp");
    const raw = JSON.parse(readFileSync("eval/results-v2-gapguard-1.json", "utf8")).items.find((i: { id: string }) => i.id === "R28");
    const t = parseSpec(readFileSync("examples/ts38331-extract.txt", "utf8"), { spec: "x", version: "x", release: "x" });
    const r = guardVerdict({ verdict: raw.raw_verdict, quote: raw.assessor_quote, requirement: "x", clauseText: String(t.nodes[raw.pred_clause].text) });
    check("[real data] R28: the assessor's exact 3-word quote is now reported as citation_too_short, not citation_not_verbatim",
      r.reason === "citation_too_short" && raw.assessor_quote.trim().split(/\s+/).length === 3, JSON.stringify(r));
  } else console.log("⏭  [real data] R28 check skipped (raw results / spec extract not present)");
}

// --- first-letter case tolerance --------------------------------------------------------------------------------
{
  // The REAL case of the demo row "release the session immediately… before it answers" (invented demo text): the assessor wrote
  // the quote with a lower-case first letter although the clause sentence starts with "The".
  const DEMO_CLAUSE = "5.3.5 Session update The purpose of this procedure is to change an open session, for example to add, modify or remove a traffic channel. " +
    "The terminal shall apply the parameters carried by the SessionUpdate message in the order received and shall not release the session before it has answered with a SessionUpdateComplete message. " +
    "If a parameter cannot be applied, the terminal starts the recovery steps described in clause 5.3.3.";
  const REAL = "the terminal shall apply the parameters carried by the SessionUpdate message in the order received and shall not release the session before it has answered with a SessionUpdateComplete message";
  check("real demo case: the quote that differs only by its first letter ('the' vs 'The') is now accepted", checkQuote(REAL, DEMO_CLAUSE) === "ok" && firstLetterCaseOnly(REAL, DEMO_CLAUSE));
  const gReal = guardVerdict({ verdict: "gap", quote: REAL, requirement: "The terminal shall release the session immediately after receiving a SessionUpdate message, before it answers.", clauseText: DEMO_CLAUSE, lexicalGap: false });
  check("real demo case: the verbatim guard no longer blocks the gap", gReal.reason === undefined && gReal.verdict === "gap", JSON.stringify(gReal));
  check("real demo case: the canonical quote is the clause's own text (an exact slice), with the clause's capital", canonicalizeQuote(REAL, DEMO_CLAUSE) === "T" + REAL.slice(1) && DEMO_CLAUSE.includes(canonicalizeQuote(REAL, DEMO_CLAUSE)));

  // three invented cases
  const CL = "The device shall close CCH1 after the update. When CCH1 is closed, the device shall send a report to the network.";
  check("invented 1: lower-case first letter where the clause has a capital ('the device' vs 'The device') → accepted",
    checkQuote("the device shall close CCH1 after the update", CL) === "ok" && firstLetterCaseOnly("the device shall close CCH1 after the update", CL));
  check("invented 2: capital first letter where the clause has lower case ('The device' vs 'the device' mid-sentence) → accepted",
    checkQuote("The device shall send a report to the network", CL) === "ok" && firstLetterCaseOnly("The device shall send a report to the network", CL));
  check("invented 3: quote starting at a word with a flipped initial ('Device' vs 'device') → accepted",
    checkQuote("Device shall close CCH1 after the update", CL) === "ok" && canonicalizeQuote("Device shall close CCH1 after the update", CL) === "device shall close CCH1 after the update");

  // everything else about case stays refused
  check("'cch1' against 'CCH1' stays refused (a case difference that is not the first letter)", checkQuote("The device shall close cch1 after the update", CL) === "not_verbatim");
  check("a quote that is lower-case in its first letter AND differs in case elsewhere is refused", checkQuote("the device shall close cch1 after the update", CL) === "not_verbatim");
  check("a first-letter case difference plus a changed word is refused", checkQuote("the device shall open CCH1 after the update", CL) === "not_verbatim");
  check("an all-lower-case quote of a mixed-case clause is refused", checkQuote("the device shall close cch1", CL) === "not_verbatim");
  check("a first character that is not a letter is never 'fixed'", checkQuote("1> the device shall close CCH1", "1> The device shall close CCH1") === "not_verbatim");
  check("first-letter tolerance does not lower the minimum length: a 3-word case-variant is too short, still", checkQuote("the device shall", CL) === "too_short" && MIN_QUOTE_WORDS === 4);
  check("an exact quote is unchanged by canonicalisation", canonicalizeQuote("The device shall close CCH1 after the update", CL) === "The device shall close CCH1 after the update");
  check("a refused quote is returned unchanged by canonicalisation", canonicalizeQuote("the device shall close cch1 after the update", CL) === "the device shall close cch1 after the update");
}

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
  gapCheckCall: async () => { throw new Error("gap check must not be called under GAP_GUARD=lexical"); },
});

async function judgeTests() {
  process.env.GAP_GUARD = "lexical"; // these cases pin the lexical rule; the verifier guard is tested in test-gap-check.ts
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

reasonTests().then(judgeTests).then(() => {
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall citation-check tests passed");
});
