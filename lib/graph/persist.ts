// Persistence of evaluated rows. The ONLY module that writes (or may ever read) the local rejected-quote table:
// it holds the full text of evaluator quotes that a guard rejected, for local debugging. It is never read by an export,
// an API route, a page or the attestation code (scripts/test-trace.ts enforces this by scanning the sources).
import type { PrismaClient } from "@prisma/client";
import type { EvaluatedRequirement } from "../conformance-contract";
import { sha256Text } from "../trace";

export type RowToPersist = EvaluatedRequirement & { rejectedQuoteText?: string };

export async function persistRows(prisma: Pick<PrismaClient, "evaluatedRequirement" | "rejectedQuote">, orgId: string, rows: RowToPersist[]): Promise<void> {
  if (!rows.length) return;
  await prisma.evaluatedRequirement.createMany({
    data: rows.map((r) => ({
      id: r.id, runId: r.runId, orgId, requirement: r.requirement,
      source: r.source as object, citations: r.citations as object, verdict: r.verdict,
      normative: r.normative, confidence: r.confidence, verifier: r.verifier as object,
      review: r.review as object, gapNote: r.gapNote, retrievalPath: r.retrievalPath as object, attestation: r.attestation as object,
      trace: r.trace as object | undefined, model: r.model, evaluatedAt: new Date(r.evaluatedAt),
    })),
  });
  const rejected = rows.filter((r) => r.rejectedQuoteText);
  if (rejected.length) {
    await prisma.rejectedQuote.createMany({
      data: rejected.map((r) => ({ requirementId: r.id, orgId, text: r.rejectedQuoteText!, sha256: sha256Text(r.rejectedQuoteText!), length: r.rejectedQuoteText!.length })),
    });
  }
}
