// Offline tests for the spec-text checker and the results sanitizer (synthetic corpus, no real spec text).
// Run: npx tsx scripts/test-no-spec-text.ts
import { ngramSet, findSpans, scanJson } from "./check-no-spec-text";
import { sanitize, sha } from "./sanitize-results";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

const CORPUS = "The UE shall initiate the RRC connection re-establishment procedure upon detecting radio link failure, unless the cause is a handover failure.";
const spec = ngramSet(CORPUS);
const TK = CORPUS.toLowerCase().match(/[a-z0-9]+/g)!; // the checker's own notion of a word
const w = (n: number, from = 0) => TK.slice(from, from + n).join(" ");

check("8 consecutive spec words are NOT flagged", findSpans(spec, w(8)).length === 0);
check("9 consecutive spec words ARE flagged", findSpans(spec, w(9)).length === 1);
check("case, punctuation and line breaks cannot hide a copy", findSpans(spec, w(10).toUpperCase().replace(/ /g, " \n ") + "!!").length >= 1);
check("a copy buried in other text is found", findSpans(spec, "prefix words here " + w(12, 2) + " and a suffix").length >= 1);
check("two separate 8-word pieces are not a 9-word span", findSpans(spec, w(8) + " zzz " + w(8, 3)).length === 0);
check("JSON: reports the path of the offending string only", (() => {
  const h = scanJson(spec, { a: { b: ["clean", w(9)] }, c: w(8) }); return h.length === 1 && h[0].path === "$.a.b[1]";
})());
check("JSON: a span is never assembled across two fields", scanJson(spec, { a: w(5), b: w(5, 5) }).length === 0);

const raw = {
  generatedAt: "t", config: { model: "m", orgId: "org_secret" }, summary: { n: 1 }, cost: { costUsd: 1 },
  generations: [{ item: "R1", role: "assessor", model: "m", id: "gen-123", provider: "P", cost: 0.1, tokensIn: 1, tokensOut: 2 }],
  items: [{ id: "R1", difficulty: "easy", gold_verdict: "gap", gold_clause: "5.3", raw_verdict: "gap", pred_verdict: "gap", pred_clause: "5.3",
    verdict_correct: true, clause_outcome: "exact", review_required: false, assessor_confidence: 0.9, verifier_agrees: true, verifier_confidence: 0.8,
    retrieval_path: ["5.3"], llm_calls: 3, requirement: "The requirement text", gap_note: w(14), verifier_note: w(12, 1), assessor_quote: w(15),
    call_ids: [{ id: "gen-123", model: "m", role: "assessor" }],
    gap_check: { guard: "verifier", outcome: "pass", passage: w(20), notes: ["NOTE: " + w(10)], passageExtended: true, notesTruncated: false,
      rawReplies: ['{"same_subject":true,"subject":"' + w(10) + '","contradicts":true,"passage_words":"' + w(9) + '","requirement_words":"x"}'],
      parsed: { same_subject: true, subject: w(10), contradicts: true, passage_words: w(9), requirement_words: "x" } } }],
};
const out = sanitize(raw);
const text = JSON.stringify(out);
check("sanitised output contains no ≥9-word spec span", scanJson(spec, out).length === 0, JSON.stringify(scanJson(spec, out)));
check("the raw input did contain spec spans (the test is meaningful)", scanJson(spec, raw).length > 0);
check("quote and passage are replaced by SHA-256 of the whitespace-normalised text",
  out.items[0].assessor_quote_sha256 === sha(w(15)) && out.items[0].gap_check!.passage_sha256 === sha(w(20)) && sha("a  b\n c") === sha("a b c"));
check("flags and codes survive", out.items[0].gap_check!.outcome === "pass" && out.items[0].gap_check!.same_subject === true && out.items[0].gap_check!.contradicts === true &&
  out.items[0].review_required === false && out.items[0].verdict_correct === true && out.items[0].assessor_quote_words === 15);
check("org id, generation ids, requirement text and model prose are gone", !text.includes("org_secret") && !text.includes("gen-123") && !text.includes("The requirement text") && !("gap_note" in out.items[0]));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall spec-text checker / sanitizer tests passed");
