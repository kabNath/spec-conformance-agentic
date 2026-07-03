// LangGraph state — the bounded pipeline's shared memory.
// LangGraph gives us the deterministic shell (fixed node graph) with agentic
// cells inside nodes (graph-walk, reflexive re-query, adversarial verify).
import { Annotation } from "@langchain/langgraph";
import type { EvaluatedRequirement, ClauseCitation } from "../conformance-contract";

export const ConformanceState = Annotation.Root({
  // inputs
  runId: Annotation<string>(),
  orgId: Annotation<string>(),
  standardId: Annotation<string>(),
  standardMeta: Annotation<{ spec: string; version: string; release: string }>(),
  implDocText: Annotation<string>(),
  implDocName: Annotation<string>(),
  reviewThreshold: Annotation<number>(),

  // working memory
  requirements: Annotation<{ requirement: string; section?: string }[]>({
    reducer: (_, next) => next, default: () => [],
  }),
  cursor: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),

  // per-requirement scratch
  citations: Annotation<ClauseCitation[]>({ reducer: (_, n) => n, default: () => [] }),
  path: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),

  // outputs
  rows: Annotation<EvaluatedRequirement[]>({
    reducer: (prev, next) => [...prev, ...next], default: () => [],
  }),
});

export type ConformanceStateT = typeof ConformanceState.State;
