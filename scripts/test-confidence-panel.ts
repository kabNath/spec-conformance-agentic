// Component test (no browser, no new dependency): renders the confidence panel of the matrix detail view to static HTML
// and checks what a user would read. Run: npx tsx --tsconfig tsconfig.test.json scripts/test-confidence-panel.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConfidencePanel from "../components/ConfidencePanel";
import { confidenceDisplay } from "../lib/confidence-display";
import { reviewReasonText } from "../lib/review-reasons";
import type { EvaluatedRequirement, ReviewReason } from "../lib/conformance-contract";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

const att = { calibrated: true, calibratedConfidence: 0.9423, ciLow: 0.7842, ciHigh: 0.9866, rawConfidence: 0.9, calibrationVersion: "cal-x",
  nReference: 40, trancheN: 26, keyId: "k", issuedAt: "t", contentHash: "h", signature: "s", publicKey: "p" };
const row = (over: Partial<EvaluatedRequirement>): EvaluatedRequirement => ({
  id: "1", runId: "r", requirement: "x", source: { documentId: "d", documentName: "n" }, citations: [], verdict: "gap", normative: "shall",
  confidence: 0.9423, verifier: { agrees: true, note: "", confidence: 0.9 }, review: { required: false }, model: "m", evaluatedAt: "t",
  attestation: att, ...over } as EvaluatedRequirement);
const html = (r: EvaluatedRequirement) => renderToStaticMarkup(createElement(ConfidencePanel, { r }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// 1. committed verdict: calibrated confidence, interval, and where the number comes from
const committed = text(html(row({})));
check("committed: shows the calibrated confidence", committed.includes("94%"), committed);
check("committed: shows the 95 % interval", /78\s*[–-]\s*99\s*%/.test(committed), committed);
check("committed: says 'observed accuracy on 26 items of this tranche'", committed.includes("observed accuracy on 26 items of this tranche"), committed);
check("committed: the misleading label 'citation confidence' is gone", !/citation confidence/i.test(committed));

// 2. the row seen on screen: forced to insufficient (gap_off_subject), review required, stored confidence 0.942
const review = text(html(row({ verdict: "insufficient_evidence", review: { required: true, reason: "gap_off_subject" } })));
check("in review: NO percentage at all (the stored 94 % must not be displayed)", !/\d\s*%/.test(review), review);
check("in review: the reason is written out in full", review.includes(reviewReasonText("gap_off_subject")) && reviewReasonText("gap_off_subject").length > 60, review);
check("in review: says it is flagged for human review", /human review/i.test(review));
check("in review: no progress bar is drawn", !html(row({ review: { required: true, reason: "gap_off_subject" } })).includes("bg-accent\""));

// 3. every review reason has a full sentence (no raw code shown as the explanation)
const reasons: ReviewReason[] = ["low_confidence", "verifier_disagreement", "no_clause_found", "conflicting_clauses", "citation_not_verbatim", "citation_too_short",
  "gap_not_grounded", "verifier_same_family", "gap_off_subject", "gap_no_contradiction", "gap_verifier_unusable"];
check("all 11 review reasons have a plain-English sentence of their own", reasons.every((r) => reviewReasonText(r).length > 40 && !reviewReasonText(r).includes("_")) &&
  new Set(reasons.map(reviewReasonText)).size === reasons.length);
check("an unknown reason code is still explained (and shown)", reviewReasonText("brand_new_reason" as ReviewReason).includes("brand_new_reason"));

// 4. rows saved before calibration existed (no calibrated flag): say that it is a raw LLM signal, never 'calibrated'
const legacy = text(html(row({ attestation: { ...att, calibrated: undefined, trancheN: undefined, ciLow: 0.8, ciHigh: 0.9 } as never, confidence: 0.85 })));
check("legacy committed row: labelled as an uncalibrated LLM signal", /not calibrated|uncalibrated/i.test(legacy) && legacy.includes("85%") && !legacy.includes("observed accuracy on"), legacy);
check("no attestation at all: still renders, labelled uncalibrated", /uncalibrated|not calibrated/i.test(text(html(row({ attestation: undefined, confidence: 0.7 })))));

// 5. the pure function
check("confidenceDisplay: kinds", confidenceDisplay(row({})).kind === "calibrated" &&
  confidenceDisplay(row({ review: { required: true, reason: "no_clause_found" } })).kind === "review" &&
  confidenceDisplay(row({ attestation: undefined })).kind === "uncalibrated");
check("confidenceDisplay: a calibrated 0 / low value is not mistaken for 'missing'", confidenceDisplay(row({ attestation: { ...att, calibratedConfidence: 0.0, ciLow: 0, ciHigh: 0.2 } })).kind === "calibrated");

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall confidence-panel tests passed");
