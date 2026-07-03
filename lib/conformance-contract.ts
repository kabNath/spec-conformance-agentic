/**
 * Conformance matrix — shared contract (v1)
 * ------------------------------------------------------------------
 * Single source of truth for the front end and the back end. The API
 * serializes to exactly these shapes; the UI consumes exactly these
 * shapes. Freeze this before touching either side.
 *
 * Design rules baked in:
 *  - Verdict (the assessment) is SEPARATE from review status (a flag).
 *  - Every claim is addressable to an exact clause (liability firewall).
 *  - Confidence is 0..1; the review threshold lives in config, not here.
 *  - Provenance on both sides (impl-doc span + cited clauses) = auditable.
 */

/* ── Enums ──────────────────────────────────────────────────────── */

/** The assessment itself. Never includes "needs review" — that's a flag. */
export type Verdict = "conformant" | "gap" | "insufficient_evidence";

/** 3GPP normative force of the governing clause text. */
export type NormativeKeyword =
  | "shall" | "shall_not" | "should" | "should_not" | "may" | "none";

/** Why an item was routed to human review (when review.required === true). */
export type ReviewReason =
  | "low_confidence"
  | "verifier_disagreement"
  | "no_clause_found"
  | "conflicting_clauses";

export type RunStatus = "queued" | "running" | "complete" | "failed";

/* ── Citation: the addressable unit of evidence ─────────────────── */

export interface ClauseCitation {
  spec: string;              // e.g. "TS 38.331"
  version: string;           // e.g. "18.3.0"
  release: string;           // e.g. "Rel-18"
  clause: string;            // clause path, e.g. "5.5.3"
  clauseTitle?: string;      // e.g. "Ephemeris and timing validity"
  text: string;              // EXACT span that grounds the claim, verbatim
  normative: NormativeKeyword;
  page?: number;
  charStart?: number;
  charEnd?: number;
  /** Canonical display string, derived. e.g. "3GPP TS 38.331 v18.3.0 §5.5.3" */
  display: string;
}

/* ── The verifier's independent result ──────────────────────────── */

export interface VerifierResult {
  agrees: boolean;
  note: string;
  confidence: number;        // 0..1
}

/* ── Vidimus attestation — calibrated confidence + tamper-evident signature ── */
export interface Attestation {
  calibratedConfidence: number; // bootstrap-CI mean over judge signals
  ciLow: number;
  ciHigh: number;
  contentHash: string;          // SHA-256 of canonical payload
  signature: string;            // Ed25519 signature of the content hash
  publicKey: string;            // verifier's public key (hex)
}

/* ── Review flag (orthogonal to verdict) ────────────────────────── */

export interface ReviewState {
  required: boolean;
  reason?: ReviewReason;
  resolvedBy?: string;
  resolvedAt?: string;
  overrideVerdict?: Verdict;
}

/* ── Where the requirement came from (impl-doc side provenance) ──── */

export interface RequirementSource {
  documentId: string;
  documentName: string;      // e.g. "ntn_feature_spec.docx"
  section?: string;          // e.g. "3.4"
  charStart?: number;
  charEnd?: number;
}

/* ── The core object: one row of the conformance matrix ─────────── */

export interface EvaluatedRequirement {
  id: string;
  runId: string;

  requirement: string;       // atomic, testable requirement text
  source: RequirementSource;

  citations: ClauseCitation[]; // empty ⇒ verdict must be insufficient_evidence
  verdict: Verdict;
  normative: NormativeKeyword; // strongest force across cited clauses
  confidence: number;          // 0..1 (trust layer)

  verifier: VerifierResult;
  review: ReviewState;

  gapNote?: string;
  retrievalPath?: string[];    // ToC → section → clause trail (audit trail)
  attestation?: Attestation;   // vidimus: calibrated confidence + signed proof

  model: string;
  evaluatedAt: string;
}

/* ── The parent run ─────────────────────────────────────────────── */

export interface AssetRef {
  documentId: string;
  documentName: string;
  kind: "standard" | "implementation";
}

export interface RunSummary {
  total: number;
  conformant: number;
  gaps: number;
  insufficientEvidence: number;
  needsReview: number;
}

export interface ConformanceRun {
  id: string;
  tenantId: string;          // multi-tenant isolation (Postgres RLS)
  name: string;
  targetRelease: string;     // e.g. "Rel-18"
  status: RunStatus;

  assets: AssetRef[];

  summary: RunSummary;
  requirements: EvaluatedRequirement[];

  reviewThreshold: number;   // below ⇒ review.required
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

/* ── Derived display verdict (UI helper, not stored) ────────────── */

export type DisplayVerdict = Verdict | "needs_review";

/** Review override wins over the raw verdict. The ONLY place the two collapse. */
export function displayVerdict(r: EvaluatedRequirement): DisplayVerdict {
  return r.review.required ? "needs_review" : r.verdict;
}

/** Build the canonical citation display string. */
export function citationDisplay(c: Omit<ClauseCitation, "display">): string {
  return `3GPP ${c.spec} v${c.version} §${c.clause}`;
}
