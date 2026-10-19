// Per-requirement TRACE: what the assessor said BEFORE the guards, what the guards did, what the verifier said.
//
// Stored as JSON next to each evaluated requirement so a case such as "why was this true gap sent to review?" can be read
// afterwards. Privacy rule: the trace contains no specification text beyond what is already stored for committed verdicts.
//   - an ACCEPTED quote (verbatim in the clause) is kept with its text: it is the citation excerpt that is stored anyway;
//   - a REJECTED or too-short quote is kept as SHA-256 + length only, its full text is returned separately in `rejectedQuoteText`
//     for a local table that no export, API route, public file or attestation reads (see lib/graph/persist.ts);
//   - the gap check keeps its outcome and the two yes/no answers, never the passage, the raw replies or the words it copied.
import { createHash } from "node:crypto";
import { canonicalizeQuote, checkQuote, firstLetterCaseOnly, normalizeWs } from "./citation-check";
import type { ReviewReason, Verdict, VerifierResult } from "./conformance-contract";

export type QuoteStatus = "verified" | "too_short" | "not_verbatim" | "none";

export interface RequirementTrace {
  version: "trace-v1";
  assessor: {
    rawVerdict: Verdict;               // before any guard
    confidence: number;                // the assessor's own confidence
    quote: { status: QuoteStatus; length: number; sha256: string | null; text?: string; firstLetterCaseFixed?: true };
  };
  guard: { reason: ReviewReason | null };
  gapCheck?: { outcome: string; sameSubject: boolean | null; contradicts: boolean | null };
  verifier: { agrees: boolean; confidence: number; note: string };
  finalVerdict: Verdict;
  /** Request that produced this verdict (X-Request-Id / MCP call); absent for web-pipeline runs. */
  requestId?: string;
}

export interface TraceInput {
  rawVerdict: Verdict; assessorConfidence: number; quote?: string; clauseText: string;
  blockedReason?: ReviewReason;
  gapCheck?: { outcome: string; parsed?: unknown };
  verifier: VerifierResult; finalVerdict: Verdict;
}

export const sha256Text = (s: string) => createHash("sha256").update(normalizeWs(s), "utf8").digest("hex");

export function buildTrace(i: TraceInput): { trace: RequirementTrace; rejectedQuoteText?: string } {
  const q = i.quote ?? "";
  const present = normalizeWs(q).length > 0;
  const status: QuoteStatus = !present ? "none" : (({ ok: "verified", too_short: "too_short", not_verbatim: "not_verbatim" } as const)[checkQuote(q, i.clauseText)]);
  const quote: RequirementTrace["assessor"]["quote"] = { status, length: present ? q.length : 0, sha256: present ? sha256Text(q) : null };
  if (status === "verified") {
    quote.text = canonicalizeQuote(q, i.clauseText);  // the clause's own spelling; sha256/length above stay those of what the model wrote
    if (firstLetterCaseOnly(q, i.clauseText)) quote.firstLetterCaseFixed = true;
  }
  const parsed = (i.gapCheck?.parsed ?? {}) as { same_subject?: unknown; contradicts?: unknown };
  const trace: RequirementTrace = {
    version: "trace-v1",
    assessor: { rawVerdict: i.rawVerdict, confidence: i.assessorConfidence, quote },
    guard: { reason: i.blockedReason ?? null },
    ...(i.gapCheck ? { gapCheck: { outcome: i.gapCheck.outcome,
      sameSubject: typeof parsed.same_subject === "boolean" ? parsed.same_subject : null,
      contradicts: typeof parsed.contradicts === "boolean" ? parsed.contradicts : null } } : {}),
    verifier: { agrees: i.verifier.agrees, confidence: i.verifier.confidence, note: i.verifier.note },
    finalVerdict: i.finalVerdict,
  };
  return { trace, rejectedQuoteText: present && status !== "verified" ? q : undefined };
}
