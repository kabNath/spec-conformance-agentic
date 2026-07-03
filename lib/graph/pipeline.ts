// LangGraph pipeline — the DETERMINISTIC shell as an explicit state machine.
// extract → ( retrieve → compile )*  → END
// Agentic reasoning lives inside retrieve/assess/verify; the graph itself is
// fixed, which is what keeps every row reproducible and clause-addressable.

import { StateGraph, END, START } from "@langchain/langgraph";
import { ConformanceState, type ConformanceStateT } from "./state";
import { extractNode } from "./nodes/extract";
import { retrieveNode } from "./nodes/retrieve";
import { assess } from "./nodes/assess";
import { verify } from "./nodes/verify";
import { prisma } from "../clients/prisma";
import type { EvaluatedRequirement, RunSummary, ReviewReason } from "../conformance-contract";
import { attest } from "../clients/vidimus";

// compile = assess + verify + build one matrix row + advance the cursor.
async function compileNode(s: ConformanceStateT): Promise<Partial<ConformanceStateT>> {
  const req = s.requirements[s.cursor];
  const a = await assess(req.requirement, s.citations);
  const v = await verify(req.requirement, a.verdict, s.citations);

  // Vidimus: calibrated confidence (bootstrap-CI over both judges) + signed attestation.
  const att = await attest({
    requirement: req.requirement, verdict: a.verdict,
    assessorConfidence: a.confidence, verifierConfidence: v.confidence,
    verifierAgrees: v.agrees, citations: s.citations,
  });
  const confidence = att.calibratedConfidence;

  let review: { required: boolean; reason?: ReviewReason };
  if (s.citations.length === 0) review = { required: true, reason: "no_clause_found" };
  else if (!v.agrees) review = { required: true, reason: "verifier_disagreement" };
  else if (confidence < s.reviewThreshold) review = { required: true, reason: "low_confidence" };
  else review = { required: false };

  const row: EvaluatedRequirement = {
    id: crypto.randomUUID(), runId: s.runId, requirement: req.requirement,
    source: { documentId: s.standardId, documentName: s.implDocName, section: req.section },
    citations: s.citations, verdict: a.verdict, normative: a.normative, confidence,
    verifier: v, review, gapNote: a.gapNote, retrievalPath: s.path, attestation: att,
    model: process.env.OPENROUTER_MODEL ?? "", evaluatedAt: new Date().toISOString(),
  };
  return { rows: [row], cursor: s.cursor + 1, citations: [], path: [] };
}

// conditional edge: more requirements → retrieve again, else finish.
function hasMore(s: ConformanceStateT): "retrieve" | typeof END {
  return s.cursor < s.requirements.length ? "retrieve" : END;
}

export function buildGraph() {
  return new StateGraph(ConformanceState)
    .addNode("extract", extractNode)
    .addNode("retrieve", retrieveNode)
    .addNode("compile", compileNode)
    .addEdge(START, "extract")
    .addConditionalEdges("extract", hasMore, { retrieve: "retrieve", [END]: END })
    .addEdge("retrieve", "compile")
    .addConditionalEdges("compile", hasMore, { retrieve: "retrieve", [END]: END })
    .compile();
}

export interface RunInput {
  runId: string; orgId: string;
  standardId: string; standardMeta: { spec: string; version: string; release: string };
  implDocText: string; implDocName: string; reviewThreshold?: number;
}

/** Execute the graph and persist rows + summary via Prisma. */
export async function runConformance(input: RunInput): Promise<RunSummary> {
  const graph = buildGraph();
  const final = (await graph.invoke({
    runId: input.runId, orgId: input.orgId, standardId: input.standardId,
    standardMeta: input.standardMeta, implDocText: input.implDocText,
    implDocName: input.implDocName, reviewThreshold: input.reviewThreshold ?? 0.75,
  })) as ConformanceStateT;

  const rows = final.rows;
  if (rows.length) {
    await prisma.evaluatedRequirement.createMany({
      data: rows.map((r) => ({
        id: r.id, runId: r.runId, orgId: input.orgId, requirement: r.requirement,
        source: r.source as object, citations: r.citations as object, verdict: r.verdict,
        normative: r.normative, confidence: r.confidence, verifier: r.verifier as object,
        review: r.review as object, gapNote: r.gapNote, retrievalPath: r.retrievalPath as object, attestation: r.attestation as object,
        model: r.model, evaluatedAt: new Date(r.evaluatedAt),
      })),
    });
  }

  const summary: RunSummary = {
    total: rows.length,
    conformant: rows.filter((r) => r.verdict === "conformant" && !r.review.required).length,
    gaps: rows.filter((r) => r.verdict === "gap" && !r.review.required).length,
    insufficientEvidence: rows.filter((r) => r.verdict === "insufficient_evidence" && !r.review.required).length,
    needsReview: rows.filter((r) => r.review.required).length,
  };
  await prisma.conformanceRun.update({
    where: { id: input.runId },
    data: { status: "complete", summary: summary as object, completedAt: new Date() },
  });
  return summary;
}
