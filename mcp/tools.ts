import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ClauseCitation, EvaluatedRequirement } from "../lib/conformance-contract";
import { EXTRACT_MAX_CHARS } from "../lib/graph/nodes/extract";
import type { Principal } from "./auth";
import type { McpDeps, SidecarAttestation, SpecInfo } from "./deps";
import { McpToolError, toErrorBody } from "./errors";
import { hashValue, sha256Hex } from "./hash";
import {
  checkConformanceIn, checkConformanceOut, extractRequirementsIn, extractRequirementsOut, getVerdictOut,
  searchSpecIn, searchSpecOut, verdictIdIn, verifyVerdictOut, type CitationOut,
} from "./schemas";

const REVIEW_THRESHOLD = 0.75; // the same default as the web pipeline (lib/graph/pipeline.ts)

const citationOut = (c: ClauseCitation): CitationOut => ({
  spec: c.spec, version: c.version, release: c.release, clause: c.clause, clause_title: c.clauseTitle ?? null,
  display: c.display, text: c.text, normative: c.normative,
});

function verdictBody(r: EvaluatedRequirement) {
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

interface Done { out: Record<string, unknown>; verdictId?: string; abstained?: boolean }

/**
 * Runs one tool call and writes ONE tool-call record for it: hashes of input and output, outcome, latency, and the
 * Ed25519 signature from the sidecar (/sign-call). The call fails closed if the record cannot be stored.
 */
async function instrumented(deps: McpDeps, p: Principal, tool: string, input: unknown, run: () => Promise<Done>): Promise<CallToolResult> {
  const requestId = randomUUID(), t0 = Date.now();
  let done: Done | undefined, err: McpToolError | undefined;
  try {
    done = await run();
  } catch (e) {
    if (e instanceof McpToolError) err = e;
    else { console.error(`[mcp] ${tool} ${requestId} failed:`, e); err = new McpToolError("internal", "Unexpected error; see the server log with this request_id", { request_id: requestId }); }
  }
  const body = err ? toErrorBody(err) : done!.out;
  const rec = {
    tool, org_id_sha256: sha256Hex(p.orgId), request_id: requestId, input_sha256: hashValue(input), output_sha256: hashValue(body),
    outcome: (err ? "error" : done!.abstained ? "abstained" : "ok") as "ok" | "abstained" | "error",
    error_code: err?.code ?? null, latency_ms: Date.now() - t0, verdict_id: done?.verdictId ?? null,
  };
  let signed: Record<string, unknown> | null = null;
  try { signed = await deps.sidecar.signCall(rec); } catch (e) { console.error(`[mcp] ${tool} ${requestId}: sign-call failed:`, (e as Error).message); }
  let recordId: string;
  try {
    recordId = await deps.calls.record({ ...rec, orgId: p.orgId, apiKeyId: p.apiKeyId, signed });
  } catch (e) {
    console.error(`[mcp] ${tool} ${requestId}: cannot store the tool-call record:`, e);
    const f = toErrorBody(new McpToolError("audit_failed", "The call could not be recorded, so its result is withheld", { request_id: requestId }));
    return { isError: true, content: [{ type: "text", text: JSON.stringify(f) }] };
  }
  const call = { request_id: requestId, record_id: recordId, signed: signed !== null };
  const payload = { ...body, call };
  return err
    ? { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] }
    : { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

export function registerTools(server: McpServer, deps: McpDeps, p: Principal): void {
  const needSpec = async (specId: string): Promise<SpecInfo> => {
    const s = (await deps.specs.list(p.orgId)).find((x) => x.id === specId);
    if (!s) throw new McpToolError("spec_not_found", `Spec "${specId}" is not ingested for this organisation`, { spec_id: specId });
    return s;
  };

  server.registerTool("search_spec", {
    title: "Search the specification",
    description: "Retrieve the clauses of an ingested spec that best match a query. Every hit carries its citation (spec, version, release, clause) and the clause text window.",
    inputSchema: searchSpecIn, outputSchema: searchSpecOut,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => instrumented(deps, p, "search_spec", input, async () => {
    const specs = input.spec_id ? [await needSpec(input.spec_id)] : await deps.specs.list(p.orgId);
    const hits: (CitationOut & { spec_id: string })[] = [];
    for (const s of specs) for (const c of await deps.search(p.orgId, s, input.query, input.top_k)) hits.push({ spec_id: s.id, ...citationOut(c) });
    return { out: { hits: hits.slice(0, input.top_k) } };
  }));

  server.registerTool("check_conformance", {
    title: "Check one requirement against the specification",
    description: "Runs the conformance agent on ONE requirement: retrieval, assessment, deterministic citation guards, cross-family verifier, signed attestation. " +
      "The verdict is persisted (verdict_id). `abstained: true` means the system did not commit and a human must review it; this happens often by design.",
    inputSchema: checkConformanceIn, outputSchema: checkConformanceOut,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => instrumented(deps, p, "check_conformance", input, async () => {
    const spec = await needSpec(input.spec_id);
    const { citations, path } = await deps.citations(p.orgId, spec, input.requirement_text, input.clause);
    const row = await deps.verdicts.create(p.orgId, p.apiKeyId, (runId) => deps.evaluate({
      runId, requirement: input.requirement_text, standardId: spec.id, implDocName: "mcp:check_conformance",
      citations, path, reviewThreshold: REVIEW_THRESHOLD,
    }));
    return { out: verdictBody(row), verdictId: row.id, abstained: row.review.required };
  }));

  server.registerTool("extract_requirements", {
    title: "Extract atomic requirements from a document",
    description: "Splits an implementation document into atomic, individually testable requirements (the extraction step of the web pipeline). " +
      "Output is always {requirement, section}; there is no custom schema. Reads only the first 12,000 characters of document_text; the response reports `truncated`.",
    inputSchema: extractRequirementsIn, outputSchema: extractRequirementsOut,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, (input) => instrumented(deps, p, "extract_requirements", { document_sha256: sha256Hex(input.document_text), length: input.document_text.length }, async () => {
    const reqs = await deps.extract(input.document_text);
    return { out: {
      requirements: reqs.map((r) => ({ requirement: r.requirement, section: r.section ?? null })),
      chars_read: Math.min(input.document_text.length, EXTRACT_MAX_CHARS), truncated: input.document_text.length > EXTRACT_MAX_CHARS,
    } };
  }));

  server.registerTool("get_verdict", {
    title: "Read a stored verdict",
    description: "Returns a verdict produced earlier by check_conformance (or by the web app) for this organisation.",
    inputSchema: verdictIdIn, outputSchema: getVerdictOut,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => instrumented(deps, p, "get_verdict", input, async () => {
    const row = await deps.verdicts.get(p.orgId, input.verdict_id);
    if (!row) throw new McpToolError("verdict_not_found", "No such verdict for this organisation");
    return { out: verdictBody(row), verdictId: row.id, abstained: row.review.required };
  }));

  server.registerTool("verify_verdict", {
    title: "Verify the signature of a stored verdict",
    description: "Checks the Ed25519-signed attestation of a stored verdict through the signing sidecar: the content hash and signature must match the stored requirement, verdict and citations. " +
      "`integrity_valid` and `signer_trusted` are reported separately: a valid signature from a key that is not pinned proves integrity, not identity.",
    inputSchema: verdictIdIn, outputSchema: verifyVerdictOut,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => instrumented(deps, p, "verify_verdict", input, async () => {
    const row = await deps.verdicts.get(p.orgId, input.verdict_id);
    if (!row) throw new McpToolError("verdict_not_found", "No such verdict for this organisation");
    if (!row.attestation) throw new McpToolError("no_attestation", "This verdict has no signed attestation");
    const v = await deps.sidecar.verify({
      requirement: row.requirement, verdict: row.verdict, citations: row.citations.map((c) => ({ display: c.display })),
      attestation: toSidecarAttestation(row),
    });
    return { out: { verdict_id: row.id, ...v }, verdictId: row.id };
  }));

  server.registerResource("spec", new ResourceTemplate("spec://{id}", {
    list: async () => ({ resources: (await deps.specs.list(p.orgId)).map((s) => ({ uri: `spec://${s.id}`, name: s.spec + " " + s.version, mimeType: "application/json" })) }),
  }), { title: "Ingested specification", description: "Metadata of a specification ingested for this organisation.", mimeType: "application/json" },
  async (uri, vars) => {
    const s = (await deps.specs.list(p.orgId)).find((x) => x.id === String(vars.id));
    if (!s) throw new McpToolError("spec_not_found", `Spec "${String(vars.id)}" is not ingested for this organisation`);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(s) }] };
  });
}
