// The five operations of the product, independent of the transport: the MCP tools (mcp/tools.ts) and the REST API
// (api/v1.ts) both call these, so a verdict means the same thing whichever door it came through.
import { randomUUID } from "node:crypto";
import type { ClauseCitation, EvaluatedRequirement } from "../lib/conformance-contract";
import type { StepEvent } from "../lib/evaluate-requirement";
import { EXTRACT_MAX_CHARS } from "../lib/graph/nodes/extract";
import { estimateCostUsd, newMeter, totals, withMeter } from "../lib/usage";
import type { Principal } from "./auth";
import type { McpDeps, SidecarAttestation, SpecInfo } from "./deps";
import { McpToolError, toErrorBody } from "./errors";
import { hashValue, sha256Hex } from "./hash";
import type { CheckConformanceArgs, CitationOut, ExtractRequirementsArgs, SearchSpecArgs, VerdictIdArgs } from "./schemas";

export const REVIEW_THRESHOLD = 0.75; // the same default as the web pipeline (lib/graph/pipeline.ts)

export type Step = StepEvent | { name: "retrieval"; clauses: string[]; path: string[] };
export interface CallContext { requestId?: string; onStep?: (s: Step) => void }
export interface Done { out: Record<string, unknown>; verdictId?: string; abstained?: boolean }

export const citationOut = (c: ClauseCitation): CitationOut => ({
  spec: c.spec, version: c.version, release: c.release, clause: c.clause, clause_title: c.clauseTitle ?? null,
  display: c.display, text: c.text, normative: c.normative,
});

export function verdictBody(r: EvaluatedRequirement) {
  const a = r.attestation;
  return {
    verdict_id: r.id, requirement: r.requirement, verdict: r.verdict,
    abstained: r.review.required, review: { required: r.review.required, reason: r.review.reason ?? null },
    confidence: r.confidence, citations: r.citations.map(citationOut), verifier: r.verifier,
    attestation: a ? {
      key_id: a.keyId, issued_at: a.issuedAt, content_hash: a.contentHash, signature: a.signature, public_key: a.publicKey,
      calibrated: a.calibrated, calibrated_confidence: a.calibratedConfidence, ci_low: a.ciLow, ci_high: a.ciHigh,
      raw_confidence: a.rawConfidence, calibration_version: a.calibrationVersion,
    } : null,
    evaluated_at: r.evaluatedAt,
  };
}

const toSidecarAttestation = (r: EvaluatedRequirement): SidecarAttestation => {
  const a = r.attestation!;
  return {
    calibrated: a.calibrated, calibrated_confidence: a.calibratedConfidence, ci_low: a.ciLow, ci_high: a.ciHigh,
    raw_confidence: a.rawConfidence, calibration_version: a.calibrationVersion, n_reference: a.nReference, tranche_n: a.trancheN,
    key_id: a.keyId, issued_at: a.issuedAt, content_hash: a.contentHash, signature: a.signature, public_key: a.publicKey,
  };
};

export interface Outcome {
  ok: boolean;
  /** Response body: the result, or `{error}`; carries `call` (the id of this call's record) unless the record failed. */
  body: Record<string, unknown>;
  error?: McpToolError;
}

/**
 * Runs one operation and writes ONE record for it: SHA-256 of input and output, outcome, latency, tokens and
 * estimated cost, and the Ed25519 signature from the sidecar (/sign-call). Fails closed if the record cannot be stored.
 */
export async function instrument(
  deps: McpDeps, p: Principal, meta: { tool: string; channel: "mcp" | "http"; requestId?: string },
  input: unknown, run: (requestId: string) => Promise<Done>,
): Promise<Outcome> {
  const requestId = meta.requestId ?? randomUUID(), t0 = Date.now(), meter = newMeter();
  let done: Done | undefined, err: McpToolError | undefined;
  try {
    done = await withMeter(meter, () => run(requestId));
  } catch (e) {
    if (e instanceof McpToolError) err = e;
    else { console.error(`[api] ${meta.tool} ${requestId} failed:`, e); err = new McpToolError("internal", "Unexpected error; see the server log with this request_id", { request_id: requestId }); }
  }
  const body = err ? toErrorBody(err) : done!.out;
  const rec = {
    tool: meta.tool, org_id_sha256: sha256Hex(p.orgId), request_id: requestId, input_sha256: hashValue(input), output_sha256: hashValue(body),
    outcome: (err ? "error" : done!.abstained ? "abstained" : "ok") as "ok" | "abstained" | "error",
    error_code: err?.code ?? null, latency_ms: Date.now() - t0, verdict_id: done?.verdictId ?? null,
  };
  let signed: Record<string, unknown> | null = null;
  try { signed = await deps.sidecar.signCall(rec); } catch (e) { console.error(`[api] ${meta.tool} ${requestId}: sign-call failed:`, (e as Error).message); }
  const t = totals(meter);
  let recordId: string;
  try {
    recordId = await deps.calls.record({ ...rec, orgId: p.orgId, apiKeyId: p.apiKeyId, signed, channel: meta.channel,
      llmCalls: t.calls, inputTokens: t.inputTokens, outputTokens: t.outputTokens, costUsd: estimateCostUsd(meter) });
  } catch (e) {
    console.error(`[api] ${meta.tool} ${requestId}: cannot store the call record:`, e);
    const f = new McpToolError("audit_failed", "The call could not be recorded, so its result is withheld", { request_id: requestId });
    return { ok: false, body: toErrorBody(f), error: f };
  }
  const call = { request_id: requestId, record_id: recordId, signed: signed !== null };
  return { ok: !err, body: { ...body, call }, ...(err ? { error: err } : {}) };
}

export function makeOps(deps: McpDeps, p: Principal) {
  const needSpec = async (specId: string): Promise<SpecInfo> => {
    const s = (await deps.specs.list(p.orgId)).find((x) => x.id === specId);
    if (!s) throw new McpToolError("spec_not_found", `Spec "${specId}" is not ingested for this organisation`, { spec_id: specId });
    return s;
  };
  const needVerdict = async (id: string) => {
    const row = await deps.verdicts.get(p.orgId, id);
    if (!row) throw new McpToolError("verdict_not_found", "No such verdict for this organisation");
    return row;
  };

  return {
    async searchSpec(input: SearchSpecArgs): Promise<Done> {
      const specs = input.spec_id ? [await needSpec(input.spec_id)] : await deps.specs.list(p.orgId);
      const hits: (CitationOut & { spec_id: string })[] = [];
      for (const s of specs) for (const c of await deps.search(p.orgId, s, input.query, input.top_k)) hits.push({ spec_id: s.id, ...citationOut(c) });
      return { out: { hits: hits.slice(0, input.top_k) } };
    },

    async checkConformance(input: CheckConformanceArgs, ctx: CallContext = {}): Promise<Done> {
      const spec = await needSpec(input.spec_id);
      const { citations, path } = await deps.citations(p.orgId, spec, input.requirement_text, input.clause);
      ctx.onStep?.({ name: "retrieval", clauses: citations.map((c) => c.clause), path });
      const row = await deps.verdicts.create(p.orgId, p.apiKeyId, (runId) => deps.evaluate({
        runId, requirement: input.requirement_text, standardId: spec.id, implDocName: "api:check_conformance",
        citations, path, reviewThreshold: REVIEW_THRESHOLD, requestId: ctx.requestId, onStep: ctx.onStep,
      }));
      return { out: verdictBody(row), verdictId: row.id, abstained: row.review.required };
    },

    async extractRequirements(input: ExtractRequirementsArgs): Promise<Done> {
      const reqs = await deps.extract(input.document_text);
      return { out: {
        requirements: reqs.map((r) => ({ requirement: r.requirement, section: r.section ?? null })),
        chars_read: Math.min(input.document_text.length, EXTRACT_MAX_CHARS), truncated: input.document_text.length > EXTRACT_MAX_CHARS,
      } };
    },

    async getVerdict(input: VerdictIdArgs): Promise<Done> {
      const row = await needVerdict(input.verdict_id);
      return { out: verdictBody(row), verdictId: row.id, abstained: row.review.required };
    },

    async verifyVerdict(input: VerdictIdArgs): Promise<Done> {
      const row = await needVerdict(input.verdict_id);
      if (!row.attestation) throw new McpToolError("no_attestation", "This verdict has no signed attestation");
      const v = await deps.sidecar.verify({
        requirement: row.requirement, verdict: row.verdict, citations: row.citations.map((c) => ({ display: c.display })),
        attestation: toSidecarAttestation(row),
      });
      return { out: { verdict_id: row.id, ...v }, verdictId: row.id };
    },
    specs: () => deps.specs.list(p.orgId),
  };
}
export type Ops = ReturnType<typeof makeOps>;

/** What is logged for extract_requirements instead of the document itself. */
export const extractInputForRecord = (a: ExtractRequirementsArgs) => ({ document_sha256: sha256Hex(a.document_text), length: a.document_text.length });
