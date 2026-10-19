import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/clients/prisma";
import type { ClauseCitation } from "@/lib/conformance-contract";
import { exportRow, type ExportInput } from "@/lib/export-rows";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await requireOrg();
  const { id } = await params;
  const run = await prisma.conformanceRun.findFirst({ where: { id, orgId } });
  if (!run) return new Response("Not found", { status: 404 });
  const rows = await prisma.evaluatedRequirement.findMany({ where: { runId: run.id, orgId }, orderBy: { evaluatedAt: "asc" } });

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Conformance matrix");
  ws.columns = [
    { header: "Requirement", key: "req", width: 50 }, { header: "Governing clause", key: "clause", width: 26 },
    { header: "Normative", key: "norm", width: 12 }, { header: "Verdict", key: "verdict", width: 18 },
    { header: "Confidence / review reason", key: "conf", width: 60 }, { header: "Clause text (evidence)", key: "text", width: 60 }, { header: "Notes", key: "notes", width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(exportRow({ ...(r as unknown as ExportInput), citations: (r.citations as unknown as ClauseCitation[]) ?? [] }));
  }
  const buf = await wb.xlsx.writeBuffer();
  const safe = run.name.replace(/[^\w.-]+/g, "_");
  return new Response(buf, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${safe}_conformance.xlsx"`,
  }});
}
