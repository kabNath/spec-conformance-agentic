// assess → deterministic citation guards → verify → gap-commit decision.
// Shared by the production pipeline (compileNode) and the eval harness so both
// apply exactly the same rules.
import { getClause } from "../clients/neo4j";
import { assessorModel, verifierModel } from "../clients/openrouter";
import { guardVerdict, gapVerifierDecision } from "../citation-check";
import type { ReviewReason, VerifierResult } from "../conformance-contract";
import { assess, type AssessOut } from "./nodes/assess";
import { verify } from "./nodes/verify";
import type { ConformanceStateT } from "./state";

export interface Judgement {
  a: AssessOut;                  // final assessment (verdict possibly forced to insufficient_evidence)
  v: VerifierResult;
  rawVerdict: AssessOut["verdict"];
  /** Why the guards/verifier policy forbids committing this verdict (⇒ human review). */
  blockedReason?: ReviewReason;
  citations: ConformanceStateT["citations"];  // citation carries `excerpt` once verified verbatim
}

/** Injectable collaborators (real ones by default) so the policy can be tested offline. */
export interface JudgeDeps {
  assess: typeof assess;
  verify: typeof verify;
  clauseText: (standardId: string, clause: string) => Promise<string>;
}
const realDeps: JudgeDeps = {
  assess, verify,
  clauseText: async (standardId, clause) => String((await getClause(standardId, clause))?.text ?? ""),
};

export async function judge(
  requirement: string, standardId: string, citations: ConformanceStateT["citations"],
  deps: JudgeDeps = realDeps,
): Promise<Judgement> {
  let a = await deps.assess(requirement, citations);
  const rawVerdict = a.verdict;
  let blockedReason: ReviewReason | undefined;
  let cited = citations;

  if (citations.length > 0 && a.verdict !== "insufficient_evidence") {
    const full = await deps.clauseText(standardId, citations[0].clause);
    const g = guardVerdict({ verdict: a.verdict, quote: a.quote, requirement, clauseText: full });
    if (g.reason) { a = { ...a, verdict: g.verdict }; blockedReason = g.reason; }
    else cited = citations.map((c, i) => (i === 0 ? { ...c, excerpt: a.quote } : c));
  }

  const v = await deps.verify(requirement, a.verdict, citations, blockedReason ? undefined : a.quote);

  if (!blockedReason && a.verdict === "gap") {
    const d = gapVerifierDecision({ assessorModel: assessorModel(), verifierModel: verifierModel(), verifierAgrees: v.agrees });
    if (!d.ok) blockedReason = d.reason === "verifier_disagreement" ? undefined : d.reason; // disagreement is flagged by the usual rule
  }
  return { a, v, rawVerdict, blockedReason, citations: cited };
}
