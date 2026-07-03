import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/clients/prisma";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await requireOrg();
  const { id } = await params;
  const run = await prisma.conformanceRun.findFirst({ where: { id, orgId } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const requirements = await prisma.evaluatedRequirement.findMany({ where: { runId: run.id, orgId }, orderBy: { evaluatedAt: "asc" } });
  return NextResponse.json({ run, requirements });
}
