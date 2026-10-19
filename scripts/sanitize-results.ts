// Turn a raw eval results file into a COMMITTABLE one: no spec text, no free-form model output.
//   npx tsx scripts/sanitize-results.ts <raw.json> <out.json>
// Kept: ids, verdicts, clause ids, flags, reason codes, confidences, counts, costs/providers.
// Replaced by a SHA-256 of the whitespace-normalised UTF-8 text: the assessor's quote and the passage given to the verifier.
// Dropped: requirement text (it is in eval/gold-set.json), gap_note / verifier_note (model prose that quotes clauses),
// the verifier's free-text fields and raw replies, generation ids, the Clerk org id.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ws = (s: string) => s.replace(/\s+/g, " ").trim();
export const sha = (s: string) => createHash("sha256").update(ws(s), "utf8").digest("hex");
const words = (s: string) => ws(s).split(" ").filter(Boolean).length;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function sanitizeItem(i: any) {
  const gc = i.gap_check;
  const parsed = gc?.parsed ?? {};
  return {
    id: i.id, difficulty: i.difficulty, gold_verdict: i.gold_verdict, gold_clause: i.gold_clause,
    raw_verdict: i.raw_verdict, pred_verdict: i.pred_verdict, pred_clause: i.pred_clause, verdict_correct: i.verdict_correct,
    clause_outcome: i.clause_outcome, review_required: i.review_required, review_reason: i.review_reason ?? null,
    review_without_verifier: i.review_without_verifier ?? null, verifier_effect: i.verifier_effect ?? null,
    assessor_confidence: i.assessor_confidence, verifier_agrees: i.verifier_agrees, verifier_confidence: i.verifier_confidence,
    retrieval_path: i.retrieval_path, llm_calls: i.llm_calls,
    system_error: i.error ? true : undefined,
    assessor_quote_sha256: i.assessor_quote ? sha(i.assessor_quote) : null,
    assessor_quote_words: i.assessor_quote ? words(i.assessor_quote) : null,
    gap_check: gc ? {
      guard: gc.guard, outcome: gc.outcome, same_subject: typeof parsed.same_subject === "boolean" ? parsed.same_subject : null,
      contradicts: typeof parsed.contradicts === "boolean" ? parsed.contradicts : null,
      passage_sha256: gc.passage ? sha(gc.passage) : null, passage_words: gc.passage ? words(gc.passage) : null,
      passage_extended: gc.passageExtended ?? null, notes_count: (gc.notes ?? []).length, notes_truncated: gc.notesTruncated ?? null,
      reply_attempts: (gc.rawReplies ?? []).length, reply_sha256: (gc.rawReplies ?? []).map((r: string) => sha(r)),
    } : null,
  };
}

export function sanitize(raw: any) {
  const { orgId: _org, ...config } = raw.config ?? {};
  return {
    _note: "Sanitised from the raw results file: no specification text, no model prose. *_sha256 = SHA-256 of the whitespace-normalised UTF-8 text.",
    generatedAt: raw.generatedAt, config, summary: raw.summary, cost: raw.cost,
    generations: (raw.generations ?? []).map((g: any) => ({ item: g.item, role: g.role, model: g.model, provider: g.provider, cost: g.cost, tokensIn: g.tokensIn, tokensOut: g.tokensOut })),
    items: raw.items.map(sanitizeItem),
  };
}

if (process.argv[1]?.endsWith("sanitize-results.ts")) {
  const [inp, out] = process.argv.slice(2);
  if (!inp || !out) { console.error("usage: sanitize-results.ts <raw.json> <out.json>"); process.exit(2); }
  writeFileSync(out, JSON.stringify(sanitize(JSON.parse(readFileSync(inp, "utf8"))), null, 2) + "\n");
  console.log(`wrote ${out}`);
}
