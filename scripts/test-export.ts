// Excel export: the "Confidence" cell must follow the interface (committed / in review / saved before calibration).
// Run: npx tsx scripts/test-export.ts
import { exportRow, type ExportInput } from "../lib/export-rows";
import { reviewReasonText } from "../lib/review-reasons";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

const att = { calibrated: true, calibratedConfidence: 0.9423, ciLow: 0.7842, ciHigh: 0.9866, rawConfidence: 0.9, calibrationVersion: "cal-x",
  nReference: 40, trancheN: 26, keyId: "k", issuedAt: "t", contentHash: "h", signature: "s", publicKey: "p" };
const cite = { display: "5.3.5", text: "Invented clause text.", clause: "5.3.5" } as unknown as ExportInput["citations"][number];
const row = (over: Partial<ExportInput>): ExportInput => ({ requirement: "The terminal shall do X.", normative: "shall", confidence: 0.9423,
  review: { required: false }, attestation: att, citations: [cite], verdict: "conformant", gapNote: null, ...over } as ExportInput);

const committed = exportRow(row({}));
check("committed: calibrated confidence, interval and tranche mention", committed.conf ===
  "Calibrated confidence 94% (95% interval 78–99%) — observed accuracy on 26 items of this tranche", committed.conf);

const reasons = ["gap_off_subject", "citation_not_verbatim", "verifier_disagreement", "no_clause_found"] as const;
for (const reason of reasons) {
  const r = exportRow(row({ verdict: "insufficient_evidence", review: { required: true, reason } }));
  check(`in review (${reason}): full sentence, same text as the interface, no percentage`, r.conf === reviewReasonText(reason) && !/\d\s*%/.test(r.conf), r.conf);
}

const legacy = exportRow(row({ attestation: undefined, confidence: 0.87 }));
check("saved before calibration: raw figure labelled 'not calibrated'", legacy.conf === "LLM confidence 87% — not calibrated (no observed accuracy behind this number)", legacy.conf);
const legacyNull = exportRow(row({ attestation: null as unknown as undefined, confidence: 0.87 }));
check("attestation null (older rows) behaves the same", legacyNull.conf === legacy.conf);
check("not-calibrated attestation behaves the same", exportRow(row({ attestation: { ...att, calibrated: false } as ExportInput["attestation"], confidence: 0.87 })).conf === legacy.conf);

check("the other columns are unchanged", committed.req === "The terminal shall do X." && committed.clause === "5.3.5" && committed.norm === "shall" && committed.text === "Invented clause text.");

// real workbook round trip: what a user opening the file reads
(async () => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("t");
  ws.columns = [{ header: "Confidence / review reason", key: "conf" }];
  for (const r of [row({}), row({ verdict: "insufficient_evidence", review: { required: true, reason: "gap_off_subject" } }), row({ attestation: undefined })]) ws.addRow(exportRow(r));
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(await wb.xlsx.writeBuffer() as unknown as ArrayBuffer);
  const cells = [2, 3, 4].map((i) => String(wb2.getWorksheet("t")!.getRow(i).getCell(1).value));
  check("xlsx round trip: the three cells read back as expected", cells[0].includes("94%") && cells[1] === reviewReasonText("gap_off_subject") && cells[2].includes("not calibrated"), cells.join(" | "));
  if (failed) { console.error(`${failed} export test(s) failed`); process.exit(1); }
  console.log("all export tests passed");
})();
