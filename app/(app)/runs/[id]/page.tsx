import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/clients/prisma";
import MatrixClient from "./MatrixClient";
import type { ConformanceRun, EvaluatedRequirement } from "@/lib/conformance-contract";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await requireOrg();
  const { id } = await params;
  const run = await prisma.conformanceRun.findFirst({ where: { id, orgId } });
  if (!run) redirect("/dashboard");
  const rows = await prisma.evaluatedRequirement.findMany({ where: { runId: run.id, orgId }, orderBy: { evaluatedAt: "asc" } });

  const requirements = rows.map((r) => ({
    id: r.id, runId: r.runId, requirement: r.requirement, source: r.source,
    citations: r.citations, verdict: r.verdict, normative: r.normative, confidence: r.confidence,
    verifier: r.verifier, review: r.review, gapNote: r.gapNote ?? undefined,
    retrievalPath: (r.retrievalPath as string[]) ?? undefined, model: r.model ?? "", evaluatedAt: r.evaluatedAt.toISOString(),
  })) as unknown as EvaluatedRequirement[];

  const data: ConformanceRun = {
    id: run.id, tenantId: run.orgId, name: run.name, targetRelease: run.targetRelease ?? "", status: run.status as ConformanceRun["status"],
    assets: [], summary: (run.summary as unknown as ConformanceRun["summary"]) ?? { total: 0, conformant: 0, gaps: 0, insufficientEvidence: 0, needsReview: 0 },
    requirements, reviewThreshold: run.reviewThreshold, createdBy: run.createdBy ?? "", createdAt: run.createdAt.toISOString(), completedAt: run.completedAt?.toISOString(),
  };
  return <MatrixClient run={data} />;
}
