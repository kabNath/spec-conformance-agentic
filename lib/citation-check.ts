// Deterministic citation guards — pure functions, no network, no LLM.
//
// 1. Every committed verdict must rest on an excerpt that appears VERBATIM
//    (modulo whitespace) in the ingested clause text. A quote the model
//    paraphrased or invented cannot ground a verdict.
// 2. A `gap` may only be committed if the excerpt contains a normative
//    sentence (shall / shall not / must) that is about the requirement's
//    subject: enough of the requirement's salient terms occur in that sentence.
//    "Shall" somewhere in an on-topic-looking clause is not enough (R10).
//
// These run BEFORE the LLM verifier; the LLM verifier is then a second,
// independent check (different model family), not the only line of defence.
import type { Verdict } from "./conformance-contract";

export type GuardReason = "citation_not_verbatim" | "gap_not_grounded";

/** Minimum words in a quote: shorter strings are trivially "verbatim". */
export const MIN_QUOTE_WORDS = 4;
/** A gap's normative sentence must cover at least this share of the requirement's salient terms… */
export const MIN_SUBJECT_COVERAGE = 0.4;
/** …and at least this many of them in absolute terms. */
export const MIN_SHARED_TERMS = 2;

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** True iff `quote` (non-trivial) occurs verbatim in `clauseText`, whitespace-normalised. */
export function isVerbatim(quote: string | undefined | null, clauseText: string): boolean {
  const q = normalizeWs(quote ?? "");
  if (q.split(" ").filter(Boolean).length < MIN_QUOTE_WORDS) return false;
  return normalizeWs(clauseText).includes(q);
}

const NORMATIVE_RE = /\b(shall(?:\s+not)?|must(?:\s+not)?)\b/i;

const STOP = new Set((
  "that this with from have been being were will would could should shall must upon when then than " +
  "their there they them into onto each every only also such does done more most over under both " +
  "which while where whose what whom ensure ensures performs perform performed following " +
  "network message procedure clause specified indicated include included includes"
).split(" "));

/** Salient terms: lower-cased words of length >= 4, minus stop-words; plural/-ed/-ing folded. */
export function salientTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w.replace(/(ing|ed|es|s)$/, "") || w);
  }
  return out;
}

export interface GroundingResult { ok: boolean; coverage: number; shared: string[]; sentence?: string }

/** Is there a normative sentence in `quote` that is about the requirement's subject? */
export function gapGrounding(quote: string, requirement: string): GroundingResult {
  const req = salientTerms(requirement);
  let best: GroundingResult = { ok: false, coverage: 0, shared: [] };
  for (const sentence of quote.split(/(?<=[.;:])\s+|\n+/)) {
    if (!NORMATIVE_RE.test(sentence)) continue;
    const words = salientTerms(sentence);
    const shared = [...req].filter((t) => words.has(t));
    const coverage = req.size ? shared.length / req.size : 0;
    if (shared.length > best.shared.length) best = { ok: false, coverage, shared, sentence };
  }
  best.ok = best.coverage >= MIN_SUBJECT_COVERAGE && best.shared.length >= MIN_SHARED_TERMS;
  return best;
}

export interface GuardOutcome { verdict: Verdict; reason?: GuardReason; detail?: string }

/**
 * Apply the deterministic guards to an assessor verdict.
 * `insufficient_evidence` is always allowed (it asserts nothing). Anything
 * else needs a verbatim quote; a `gap` additionally needs grounding.
 * On failure the verdict is forced to `insufficient_evidence`.
 */
export function guardVerdict(i: {
  verdict: Verdict; quote?: string; requirement: string; clauseText: string;
}): GuardOutcome {
  if (i.verdict === "insufficient_evidence") return { verdict: i.verdict };
  if (!isVerbatim(i.quote, i.clauseText)) {
    return { verdict: "insufficient_evidence", reason: "citation_not_verbatim",
      detail: "the cited excerpt is missing, too short, or not found verbatim in the clause text" };
  }
  if (i.verdict === "gap") {
    const g = gapGrounding(i.quote!, i.requirement);
    if (!g.ok) {
      return { verdict: "insufficient_evidence", reason: "gap_not_grounded",
        detail: `no shall/must sentence in the excerpt covers the requirement's subject ` +
          `(best coverage ${g.coverage.toFixed(2)}, shared: ${g.shared.join(", ") || "none"})` };
    }
  }
  return { verdict: i.verdict };
}

/** Provider prefix of an OpenRouter model id: "anthropic/claude-sonnet-4.6" → "anthropic". */
export function modelFamily(model: string): string {
  return model.split("/")[0].toLowerCase();
}

/**
 * May a `gap` be committed given the verifier? Only if an independent LLM family
 * checked it and agreed. Unset or same-family verifier ⇒ no.
 */
export function gapVerifierDecision(i: {
  assessorModel: string; verifierModel?: string; verifierAgrees: boolean;
}): { ok: boolean; reason?: "verifier_same_family" | "verifier_disagreement" } {
  if (!i.verifierModel || modelFamily(i.verifierModel) === modelFamily(i.assessorModel)) {
    return { ok: false, reason: "verifier_same_family" };
  }
  return i.verifierAgrees ? { ok: true } : { ok: false, reason: "verifier_disagreement" };
}
