// POST /api/runs — create + execute a conformance run on the agentic stack.
// Clerk org = tenant. Cloudinary stores raw uploads. LangGraph runs the pipeline.
// TODO(prod): move runConformance() to a queue/worker — a full run exceeds serverless limits.
import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/clients/prisma";
import { uploadDoc } from "@/lib/clients/cloudinary";
import { runConformance } from "@/lib/graph/pipeline";

export const runtime = "nodejs";
// A full agentic run (extract + per-requirement graph-walk + assess/verify/attest)
// runs synchronously and takes ~100s on this sample — well past 60s. Give the
// request room. TODO(prod): move runConformance() to a queue/worker instead.
export const maxDuration = 300;

async function fileToText(f: File): Promise<string> {
  const buf = Buffer.from(await f.arrayBuffer());
  const lower = f.name.toLowerCase();
  if (lower.endsWith(".pdf")) return (await (await import("pdf-parse")).default(buf)).text;
  if (lower.endsWith(".docx")) return (await import("mammoth")).extractRawText({ buffer: buf }).then((r) => r.value);
  return buf.toString("utf8");
}

export async function POST(req: Request) {
  const { orgId, userId } = await requireOrg();
  const form = await req.formData();
  const std = form.get("standard"), impl = form.get("impl");
  if (!(std instanceof File) || !(impl instanceof File))
    return NextResponse.json({ error: "Upload one standard and one implementation file" }, { status: 400 });

  const spec = String(form.get("spec") ?? "TS 38.331");
  const version = String(form.get("version") ?? "18.3.0");
  const release = String(form.get("release") ?? "Rel-18");

  // standardId must match the value scripts/ingest.ts keyed on, or the graph-walk
  // queries Neo4j/Qdrant for a standard that isn't there. Derive a stable slug from
  // the spec ("TS 38.331" → "ts38331") — NOT the random asset id used before, which
  // no ingestion ever keyed on.
  const standardId = spec.toLowerCase().replace(/[^a-z0-9]+/g, "");

  const [stdText, implText, stdUrl, implUrl] = await Promise.all([
    fileToText(std), fileToText(impl),
    uploadDoc(Buffer.from(await std.arrayBuffer()), std.name, orgId).catch(() => null),
    uploadDoc(Buffer.from(await impl.arrayBuffer()), impl.name, orgId).catch(() => null),
  ]);

  await prisma.organization.upsert({ where: { id: orgId }, update: {}, create: { id: orgId, name: orgId } });
  await prisma.asset.create({ data: { orgId, kind: "standard", name: std.name, spec, version, release, cloudinaryUrl: stdUrl } });
  await prisma.asset.create({ data: { orgId, kind: "implementation", name: impl.name, cloudinaryUrl: implUrl } });
  const run = await prisma.conformanceRun.create({
    data: { orgId, name: String(form.get("name") ?? "Untitled run"), targetRelease: release, status: "running", createdBy: userId },
  });

  // NOTE: the standard must already be ingested into Neo4j+Qdrant (scripts/ingest.ts)
  // so the graph-walk has a graph to walk. TODO: trigger ingest here if missing.
  try {
    const summary = await runConformance({
      runId: run.id, orgId, standardId,
      standardMeta: { spec, version, release }, implDocText: implText, implDocName: impl.name,
    });
    return NextResponse.json({ ok: true, runId: run.id, summary });
  } catch (e) {
    console.error(`[/api/runs] run ${run.id} failed:`, e); // surface the real stack in dev logs
    await prisma.conformanceRun.update({ where: { id: run.id }, data: { status: "failed" } });
    return NextResponse.json({ error: (e as Error).message, runId: run.id }, { status: 500 });
  }
}
