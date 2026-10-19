// Everything the tools need from the outside world, behind one interface: the real wiring is mcp/real-deps.ts,
// tests inject in-memory fakes (tests/mcp). Tools never import Prisma, Neo4j, Qdrant or fetch directly.
import type { ClauseCitation, EvaluatedRequirement } from "../lib/conformance-contract";
import type { EvaluateInput, EvaluatedRow } from "../lib/evaluate-requirement";
import type { KeyStore } from "./auth";

export interface SpecInfo { id: string; spec: string; version: string; release: string; name: string }

/** Attestation as the sidecar returns it (snake_case), the shape /verify expects back. */
export interface SidecarAttestation {
  calibrated: boolean; calibrated_confidence: number | null; ci_low: number | null; ci_high: number | null;
  raw_confidence: number; calibration_version: string; n_reference: number; tranche_n: number;
  key_id: string; issued_at: string; content_hash: string; signature: string; public_key: string;
}
export interface VerifyResult {
  integrity_valid: boolean; signer_trusted: boolean; key_id: string | null;
  issues: string[]; trust_issues: string[]; warnings: string[];
}
export interface CallSignInput {
  tool: string; org_id_sha256: string; request_id: string; input_sha256: string; output_sha256: string | null;
  outcome: "ok" | "abstained" | "error"; error_code: string | null; latency_ms: number; verdict_id: string | null;
}
export interface CallRow extends Omit<CallSignInput, "org_id_sha256"> {
  orgId: string; apiKeyId: string; signed: Record<string, unknown> | null;
  channel: "mcp" | "http";
  llmCalls: number; inputTokens: number; outputTokens: number;
  /** null unless every model used has a price in MODEL_PRICES_JSON (lib/usage.ts). */
  costUsd: number | null;
}

export interface McpDeps {
  keys: KeyStore;
  specs: { list(orgId: string): Promise<SpecInfo[]> };
  /** Nearest clauses of one spec, scoped to the organisation. */
  search(orgId: string, spec: SpecInfo, query: string, topK: number): Promise<ClauseCitation[]>;
  /** Governing clause(s) for one requirement; with `clause`, no navigation (throws clause_not_found if absent). */
  citations(orgId: string, spec: SpecInfo, requirement: string, clause?: string): Promise<{ citations: ClauseCitation[]; path: string[] }>;
  evaluate(input: EvaluateInput): Promise<EvaluatedRow>;
  extract(text: string): Promise<{ requirement: string; section?: string }[]>;
  verdicts: {
    /** Opens a run, lets `build` produce the row for it, persists it. */
    create(orgId: string, apiKeyId: string, build: (runId: string) => Promise<EvaluatedRow>): Promise<EvaluatedRow>;
    get(orgId: string, id: string): Promise<EvaluatedRequirement | null>;
  };
  sidecar: {
    verify(v: { requirement: string; verdict: string; citations: { display: string }[]; attestation: SidecarAttestation }): Promise<VerifyResult>;
    signCall(rec: CallSignInput): Promise<Record<string, unknown>>;
  };
  calls: { record(row: CallRow): Promise<string> };
}
