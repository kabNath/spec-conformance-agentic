// Plain-English explanation of every human-review reason (the interface is English-only, there is no i18n layer).
// Shown instead of a percentage when a row is in review: a flagged row has no committed confidence to display.
import type { ReviewReason } from "./conformance-contract";

export const REVIEW_REASON_TEXT: Record<ReviewReason, string> = {
  low_confidence: "The confidence is too low to commit a verdict (below the review threshold, or not enough reference items to calibrate it).",
  verifier_disagreement: "The independent verifier disagrees with the verdict proposed by the assessor, so it is not committed.",
  no_clause_found: "No governing clause was found in the specification, so there is no evidence to judge against.",
  conflicting_clauses: "Several clauses point in different directions; a human has to decide which one governs.",
  citation_not_verbatim: "The excerpt quoted as evidence is not found word for word in the clause, so no verdict is committed.",
  citation_too_short: "The excerpt quoted as evidence is exact but too short (fewer than 4 words) to support a verdict.",
  gap_not_grounded: "A gap needs a shall/must sentence about the requirement's own subject; none was found in the cited passage.",
  verifier_same_family: "A gap must be confirmed by a verifier from a different model family; none is configured, so it is not committed.",
  gap_off_subject: "The independent verifier judged that the cited passage is not about the same subject as the requirement, so the gap is not committed.",
  gap_no_contradiction: "The passage is on the right subject but the verifier found no contradiction (silence, a permission or an exception is not a gap).",
  gap_verifier_unusable: "The verifier's answer to the gap check was unusable, so the gap is not committed.",
};

export function reviewReasonText(reason: ReviewReason | undefined): string {
  if (!reason) return "Flagged for human review.";
  return REVIEW_REASON_TEXT[reason] ?? `Flagged for human review (reason code: ${reason}).`;
}
