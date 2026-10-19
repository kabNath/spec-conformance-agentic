// What the detail panel shows as "confidence", decided in one place so it can be tested.
//
// Rule: a row in review has no committed confidence, so NO percentage is shown (only the reason). The stored
// `confidence` of such a row is the calibrated accuracy of a tranche looked up from a raw score that mixes the
// assessor's confidence in its PRE-guard verdict with the verifier's confidence in the POST-guard one: displaying it next
// to "needs review" (e.g. 94 % on a gap that a guard refused) says nothing true about the displayed verdict.
import type { EvaluatedRequirement } from "./conformance-contract";
import { reviewReasonText } from "./review-reasons";

export type ConfidenceDisplay =
  | { kind: "calibrated"; pct: number; lowPct: number; highPct: number; n: number; text: string }
  | { kind: "uncalibrated"; pct: number; text: string }
  | { kind: "review"; reasonText: string };

const pc = (x: number) => Math.round(x * 100);

export function confidenceDisplay(r: Pick<EvaluatedRequirement, "review" | "confidence" | "attestation">): ConfidenceDisplay {
  if (r.review.required) return { kind: "review", reasonText: reviewReasonText(r.review.reason) };
  const a = r.attestation;
  if (a && a.calibrated === true && typeof a.calibratedConfidence === "number" && typeof a.ciLow === "number" && typeof a.ciHigh === "number") {
    const n = typeof a.trancheN === "number" ? a.trancheN : 0;
    return { kind: "calibrated", pct: pc(a.calibratedConfidence), lowPct: pc(a.ciLow), highPct: pc(a.ciHigh), n,
      text: `Calibrated confidence ${pc(a.calibratedConfidence)}% (95% interval ${pc(a.ciLow)}–${pc(a.ciHigh)}%) — observed accuracy on ${n} items of this tranche` };
  }
  // saved before calibration existed, or no attestation: say plainly that it is the raw LLM signal
  return { kind: "uncalibrated", pct: pc(r.confidence),
    text: `LLM confidence ${pc(r.confidence)}% — not calibrated (no observed accuracy behind this number)` };
}
