// LangGraph pipeline — the DETERMINISTIC shell as an explicit state machine.
// extract → ( retrieve → compile )*  → END
// Agentic reasoning lives inside retrieve/assess/verify; the graph itself is
// fixed, which is what keeps every row reproducible and clause-addressable.

import { StateGraph, END, START } from "@langchain/langgraph";
import { ConformanceState, type ConformanceStateT } from "./state";
import { extractNode } from "./nodes/extract";
import { retrieveNode } from "./nodes/retrieve";
import { evaluateRequirement } from "../evaluate-requirement";
import { persistRows } from "./persist";
import { prisma } from "../clients/prisma";
import type { RunSummary } from "../conformance-contract";

// compile = assess + verify + build one matrix row + advance the cursor
// (the per-requirement logic lives in lib/evaluate-requirement.ts, shared with the MCP server).
async function compileNode(s: ConformanceStateT): Promise<Partial<ConformanceStateT>> {
  const req = s.requirements[s.cursor];
  const row = await evaluateRequirement({
    runId: s.runId, requirement: req.requirement, section: req.section, standardId: s.standardId,
    implDocName: s.implDocName, citations: s.citations, path: s.path, reviewThreshold: s.reviewThreshold,
  });
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
  await persistRows(prisma, input.orgId, rows);

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
