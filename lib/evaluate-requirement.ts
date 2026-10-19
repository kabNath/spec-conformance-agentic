// One requirement → one matrix row: assess + deterministic citation guards + verifier (lib/graph/judge.ts),
// Vidimus attestation, review decision. Shared by the LangGraph `compile` node and the MCP `check_conformance` tool,
// so both apply exactly the same rules. Behaviour is pinned by tests/compile-regression.test.ts.
import { judge as realJudge } from "./graph/judge";
import { attest as realAttest } from "./clients/vidimus";
import type { ClauseCitation, EvaluatedRequirement, ReviewReason } from "./conformance-contract";

export interface EvaluateInput {
  runId: string;
  requirement: string;
  section?: string;
  standardId: string;
  implDocName: string;
  citations: ClauseCitation[];
  path: string[];
  reviewThreshold: number;
}

export interface EvaluateDeps {
  judge: typeof realJudge;
  attest: typeof realAttest;
}
const realDeps: EvaluateDeps = { judge: realJudge, attest: realAttest };

export type EvaluatedRow = EvaluatedRequirement & { rejectedQuoteText?: string };

export async function evaluateRequirement(s: EvaluateInput, deps: EvaluateDeps = realDeps): Promise<EvaluatedRow> {
  // assess + deterministic citation guards + verifier (see lib/graph/judge.ts)
  const { a, v, blockedReason, citations, trace, rejectedQuoteText } = await deps.judge(s.requirement, s.standardId, s.citations);

  // Vidimus: empirical (tranche-accuracy) confidence + signed attestation. When the
  // tranche is too small to calibrate, fall back to the raw LLM signal and route to review.
  const att = await deps.attest({
    requirement: s.requirement, verdict: a.verdict,
    assessorConfidence: a.confidence, verifierConfidence: v.confidence,
    verifierAgrees: v.agrees, citations,
  });
  const confidence = att.calibrated && att.calibratedConfidence !== null
    ? att.calibratedConfidence : att.rawConfidence;

  let review: { required: boolean; reason?: ReviewReason };
  if (s.citations.length === 0) review = { required: true, reason: "no_clause_found" };
  else if (blockedReason) review = { required: true, reason: blockedReason };
  else if (!v.agrees) review = { required: true, reason: "verifier_disagreement" };
  else if (!att.calibrated || confidence < s.reviewThreshold) review = { required: true, reason: "low_confidence" };
  else review = { required: false };

  return {
    id: crypto.randomUUID(), runId: s.runId, requirement: s.requirement,
    source: { documentId: s.standardId, documentName: s.implDocName, section: s.section },
    citations, verdict: a.verdict, normative: a.normative, confidence,
    verifier: v, review, gapNote: a.gapNote, retrievalPath: s.path, attestation: att,
    model: process.env.OPENROUTER_MODEL ?? "", evaluatedAt: new Date().toISOString(),
    trace, rejectedQuoteText,
  } as EvaluatedRow;
}
