// assess → deterministic citation guards → verify → gap-commit decision.
// Shared by the production pipeline (compileNode) and the eval harness so both
// apply exactly the same rules.
import { getClause } from "../clients/neo4j";
import { assessorModel, verifierModel, llmText } from "../clients/openrouter";
import { guardVerdict, gapVerifierDecision, modelFamily, canonicalizeQuote } from "../citation-check";
import { governingNormative } from "../normative";
import { buildTrace, type RequirementTrace } from "../trace";
import { GAP_CHECK_SYSTEM, buildPassage, gapCheckUser, interpretGapCheck, type GapOutcome } from "../gap-check";
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
  quote?: string;                // the assessor's exact quote (kept for the audit trail)
  gapCheck?: GapCheckRecord;     // GAP_GUARD=verifier: what the verifier was shown and answered
  trace: RequirementTrace;       // persisted next to the row (lib/trace.ts): raw verdict, confidence, quote status, guard, verifier
  rejectedQuoteText?: string;    // full text of a rejected quote: for the LOCAL table only (lib/graph/persist.ts)
}

export interface GapCheckRecord {
  guard: GapGuard; outcome: GapOutcome | "skipped_same_family"; detail: string;
  passage?: string; notes?: string[]; passageExtended?: boolean; notesTruncated?: boolean;
  rawReplies?: string[]; parsed?: unknown;
}

export type GapGuard = "lexical" | "verifier";
/** GAP_GUARD=lexical|verifier (default verifier). */
export function gapGuard(): GapGuard {
  const v = (process.env.GAP_GUARD ?? "verifier").toLowerCase();
  if (v !== "lexical" && v !== "verifier") throw new Error(`GAP_GUARD must be "lexical" or "verifier", got "${v}"`);
  return v;
}

/** Injectable collaborators (real ones by default) so the policy can be tested offline. */
export interface JudgeDeps {
  assess: typeof assess;
  verify: typeof verify;
  clauseText: (standardId: string, clause: string) => Promise<string>;
  /** One raw reply per attempt from the verifier model (gap check). */
  gapCheckCall: (system: string, user: string) => Promise<string>;
}
const realDeps: JudgeDeps = {
  assess, verify,
  clauseText: async (standardId, clause) => String((await getClause(standardId, clause))?.text ?? ""),
  gapCheckCall: (system, user) => llmText(system, user, { model: verifierModel(), role: "gap_check", pin: true }),
};

export async function judge(
  requirement: string, standardId: string, citations: ConformanceStateT["citations"],
  deps: JudgeDeps = realDeps,
): Promise<Judgement> {
  let a = await deps.assess(requirement, citations);
  const rawVerdict = a.verdict;
  const rawQuote = a.quote;
  const rawConfidence = a.confidence;
  let blockedReason: ReviewReason | undefined;
  let cited = citations;
  let gapCheck: GapCheckRecord | undefined;
  const mode = gapGuard();

  const full = citations.length > 0 ? await deps.clauseText(standardId, citations[0].clause) : "";
  // A quote that differs from the clause only by the case of its first letter is replaced by the clause's own spelling
  // (excerpt, gap passage and verifier then see an exact slice); the raw quote stays in the trace.
  if (a.quote && full) a = { ...a, quote: canonicalizeQuote(a.quote, full) };
  if (citations.length > 0 && a.verdict !== "insufficient_evidence") {
    const g = guardVerdict({ verdict: a.verdict, quote: a.quote, requirement, clauseText: full, lexicalGap: mode === "lexical" });
    if (g.reason) { a = { ...a, verdict: g.verdict }; blockedReason = g.reason; }
    else cited = citations.map((c, i) => (i === 0 ? { ...c, excerpt: a.quote } : c));

    // GAP_GUARD=verifier: a gap commits only if an independent model family confirms same subject AND contradiction.
    if (!blockedReason && a.verdict === "gap" && mode === "verifier") {
      const vm = verifierModel();
      if (!vm || modelFamily(vm) === modelFamily(assessorModel())) {
        gapCheck = { guard: mode, outcome: "skipped_same_family", detail: "no verifier model from another family" };
        a = { ...a, verdict: "insufficient_evidence" }; blockedReason = "verifier_same_family";
      } else {
        const p = buildPassage(full, a.quote ?? "");
        const user = gapCheckUser(requirement, citations[0].clause, p);
        const raws: string[] = [];
        try {
          raws.push(await deps.gapCheckCall(GAP_CHECK_SYSTEM, user));
          if (!interpretGapCheck(raws, requirement, p).parsed)  // not even parseable JSON: one retry
            raws.push(await deps.gapCheckCall(GAP_CHECK_SYSTEM + "\nReturn ONLY the raw JSON value — no prose, no markdown, no code fences.", user));
        } catch (e) { raws.push(`ERROR: ${(e as Error).message}`); }
        const r = interpretGapCheck(raws, requirement, p);
        gapCheck = { guard: mode, outcome: r.outcome, detail: r.detail, passage: p.passage, notes: p.notes,
          passageExtended: p.extended, notesTruncated: p.notesTruncated, rawReplies: raws, parsed: r.parsed };
        if (r.outcome !== "pass") { a = { ...a, verdict: "insufficient_evidence" }; blockedReason = r.outcome; }
      }
    }
  }

  // "Norm" column: force of the sentence that governs THIS requirement (verified excerpt, else the clause text);
  // when nothing overlaps, keep the clause-level value from the assessor.
  if (citations.length > 0) {
    const g = governingNormative(cited[0].excerpt ?? full, requirement);
    if (g) a = { ...a, normative: g.force };
  }

  const v = await deps.verify(requirement, a.verdict, citations, blockedReason ? undefined : a.quote);

  if (!blockedReason && a.verdict === "gap" && mode === "lexical") {
    const d = gapVerifierDecision({ assessorModel: assessorModel(), verifierModel: verifierModel(), verifierAgrees: v.agrees });
    if (!d.ok) blockedReason = d.reason === "verifier_disagreement" ? undefined : d.reason; // disagreement is flagged by the usual rule
  }
  const { trace, rejectedQuoteText } = buildTrace({ rawVerdict, assessorConfidence: rawConfidence, quote: rawQuote, clauseText: full,
    blockedReason, gapCheck, verifier: v, finalVerdict: a.verdict });
  return { a, v, rawVerdict, blockedReason, citations: cited, quote: rawQuote, gapCheck, trace, rejectedQuoteText };
}
