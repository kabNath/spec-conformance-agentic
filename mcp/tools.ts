import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Principal } from "./auth";
import type { McpDeps } from "./deps";
import { McpToolError } from "./errors";
import { extractInputForRecord, instrument, makeOps, type Done } from "./operations";
import {
  checkConformanceIn, checkConformanceOut, extractRequirementsIn, extractRequirementsOut, getVerdictOut,
  searchSpecIn, searchSpecOut, verdictIdIn, verifyVerdictOut,
} from "./schemas";

export function registerTools(server: McpServer, deps: McpDeps, p: Principal, ctx: { requestId?: string } = {}): void {
  const ops = makeOps(deps, p);
  const call = async (tool: string, input: unknown, run: (requestId: string) => Promise<Done>): Promise<CallToolResult> => {
    const r = await instrument(deps, p, { tool, channel: "mcp", requestId: ctx.requestId }, input, run);
    const text = JSON.stringify(r.body);
    return r.ok ? { content: [{ type: "text", text }], structuredContent: r.body } : { isError: true, content: [{ type: "text", text }] };
  };

  server.registerTool("search_spec", {
    title: "Search the specification",
    description: "Retrieve the clauses of an ingested spec that best match a query. Every hit carries its citation (spec, version, release, clause) and the clause text window.",
    inputSchema: searchSpecIn, outputSchema: searchSpecOut,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => call("search_spec", input, () => ops.searchSpec(input)));

  server.registerTool("check_conformance", {
    title: "Check one requirement against the specification",
    description: "Runs the conformance agent on ONE requirement: retrieval, assessment, deterministic citation guards, cross-family verifier, signed attestation. " +
      "The verdict is persisted (verdict_id). `abstained: true` means the system did not commit and a human must review it; this happens often by design.",
    inputSchema: checkConformanceIn, outputSchema: checkConformanceOut,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => call("check_conformance", input, (requestId) => ops.checkConformance(input, { requestId })));

  server.registerTool("extract_requirements", {
    title: "Extract atomic requirements from a document",
    description: "Splits an implementation document into atomic, individually testable requirements (the extraction step of the web pipeline). " +
      "Output is always {requirement, section}; there is no custom schema. Reads only the first 12,000 characters of document_text; the response reports `truncated`.",
    inputSchema: extractRequirementsIn, outputSchema: extractRequirementsOut,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, (input) => call("extract_requirements", extractInputForRecord(input), () => ops.extractRequirements(input)));

  server.registerTool("get_verdict", {
    title: "Read a stored verdict",
    description: "Returns a verdict produced earlier by check_conformance (or by the web app) for this organisation.",
    inputSchema: verdictIdIn, outputSchema: getVerdictOut,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => call("get_verdict", input, () => ops.getVerdict(input)));

  server.registerTool("verify_verdict", {
    title: "Verify the signature of a stored verdict",
    description: "Checks the Ed25519-signed attestation of a stored verdict through the signing sidecar: the content hash and signature must match the stored requirement, verdict and citations. " +
      "`integrity_valid` and `signer_trusted` are reported separately: a valid signature from a key that is not pinned proves integrity, not identity.",
    inputSchema: verdictIdIn, outputSchema: verifyVerdictOut,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => call("verify_verdict", input, () => ops.verifyVerdict(input)));

  server.registerResource("spec", new ResourceTemplate("spec://{id}", {
    list: async () => ({ resources: (await ops.specs()).map((s) => ({ uri: `spec://${s.id}`, name: s.spec + " " + s.version, mimeType: "application/json" })) }),
  }), { title: "Ingested specification", description: "Metadata of a specification ingested for this organisation.", mimeType: "application/json" },
  async (uri, vars) => {
    const s = (await ops.specs()).find((x) => x.id === String(vars.id));
    if (!s) throw new McpToolError("spec_not_found", `Spec "${String(vars.id)}" is not ingested for this organisation`);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(s) }] };
  });
}
