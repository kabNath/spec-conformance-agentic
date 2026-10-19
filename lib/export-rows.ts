// One Excel row per evaluated requirement, built here (pure, no DB, no exceljs) so the export can be tested.
// The "Confidence" cell follows the same rule and the same texts as the interface (lib/confidence-display.ts):
//   - a row in review: NO percentage, the review reason as a full sentence;
//   - a committed verdict: calibrated confidence, 95% interval and the tranche mention;
//   - a row saved before calibration: the raw LLM figure, labelled "not calibrated".
import { displayVerdict, type EvaluatedRequirement, type ClauseCitation } from "./conformance-contract";
import { confidenceDisplay } from "./confidence-display";

export type ExportInput = Pick<EvaluatedRequirement, "requirement" | "normative" | "confidence" | "review" | "attestation"> & {
  citations: ClauseCitation[]; gapNote?: string | null; verdict: EvaluatedRequirement["verdict"];
};

export function exportRow(r: ExportInput) {
  const cites = r.citations ?? [];
  const conf = confidenceDisplay(r);
  return {
    req: r.requirement, clause: cites.map((c) => c.display).join("; "), norm: r.normative,
    verdict: displayVerdict(r as unknown as EvaluatedRequirement),
    conf: conf.kind === "review" ? conf.reasonText : conf.text,
    text: cites.map((c) => c.text).join("\n---\n"), notes: r.gapNote ?? "",
  };
}
