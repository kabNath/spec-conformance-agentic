// Production wiring of McpDeps: Prisma, Neo4j, Qdrant, OpenRouter and the vidimus sidecar.
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/clients/prisma";
import { getClause } from "../lib/clients/neo4j";
import { searchClauses } from "../lib/clients/qdrant";
import { signCall, verifyAttestation } from "../lib/clients/vidimus";
import { evaluateRequirement } from "../lib/evaluate-requirement";
import { citationFromClause, embed, retrieveForRequirement } from "../lib/graph/nodes/retrieve";
import { extractRequirements } from "../lib/graph/nodes/extract";
import { persistRows } from "../lib/graph/persist";
import type { EvaluatedRequirement } from "../lib/conformance-contract";
import type { McpDeps, SpecInfo } from "./deps";
import { McpToolError } from "./errors";

const slug = (spec: string) => spec.toLowerCase().replace(/[^a-z0-9]+/g, ""); // same rule as app/api/runs/route.ts

async function listSpecs(orgId: string): Promise<SpecInfo[]> {
  const assets = await prisma.asset.findMany({ where: { orgId, kind: "standard", spec: { not: null } }, orderBy: { createdAt: "desc" } });
  const seen = new Map<string, SpecInfo>();
  for (const a of assets) {
    const id = slug(a.spec!);
    if (!seen.has(id)) seen.set(id, { id, spec: a.spec!, version: a.version ?? "", release: a.release ?? "", name: a.name });
  }
  return [...seen.values()];
}

const upstream = (what: string, e: unknown) => new McpToolError("upstream_unavailable", `${what} is unavailable`, { cause: (e as Error).message });

export function createRealDeps(): McpDeps {
  return {
    keys: {
      findByPrefix: (prefix) => prisma.apiKey.findUnique({ where: { prefix } }),
      touch: async (id) => { await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } }); },
    },
    specs: { list: listSpecs },
    async search(orgId, spec, query, topK) {
      try {
        const ids = await searchClauses(orgId, spec.id, await embed(query), topK);
        return await Promise.all(ids.map((c) => citationFromClause(spec, spec.id, c, query)));
      } catch (e) { throw upstream("The vector index or the graph", e); }
    },
    async citations(orgId, spec, requirement, clause) {
      try {
        if (clause) {
          if (!(await getClause(spec.id, clause))) throw new McpToolError("clause_not_found", `Clause ${clause} is not in ${spec.spec}`, { clause });
          return { citations: [await citationFromClause(spec, spec.id, clause, requirement)], path: [`hint:${clause}`] };
        }
        return await retrieveForRequirement({ requirement, orgId, standardId: spec.id, standardMeta: spec });
      } catch (e) { throw e instanceof McpToolError ? e : upstream("Retrieval", e); }
    },
    evaluate: (input) => evaluateRequirement(input),
    extract: async (text) => {
      try { return await extractRequirements(text, "mcp:extract_requirements"); } catch (e) { throw upstream("The model provider", e); }
    },
    verdicts: {
      async create(orgId, apiKeyId, build) {
        const run = await prisma.conformanceRun.create({ data: { orgId, name: "MCP check_conformance", status: "running", createdBy: `apikey:${apiKeyId}` } });
        try {
          const row = await build(run.id);
          await persistRows(prisma, orgId, [row]);
          await prisma.conformanceRun.update({ where: { id: run.id }, data: { status: "complete", completedAt: new Date(),
            summary: { total: 1, needsReview: row.review.required ? 1 : 0 } as Prisma.InputJsonValue } });
          return row;
        } catch (e) {
          await prisma.conformanceRun.update({ where: { id: run.id }, data: { status: "failed" } }).catch(() => undefined);
          throw e instanceof McpToolError ? e : upstream("The conformance pipeline", e);
        }
      },
      async get(orgId, id) {
        const r = await prisma.evaluatedRequirement.findFirst({ where: { id, orgId } }); // org-scoped: another tenant's id is "not found"
        if (!r) return null;
        return {
          id: r.id, runId: r.runId, requirement: r.requirement, source: r.source, citations: r.citations, verdict: r.verdict,
          normative: r.normative, confidence: r.confidence, verifier: r.verifier, review: r.review, gapNote: r.gapNote ?? undefined,
          retrievalPath: r.retrievalPath ?? [], attestation: r.attestation ?? undefined, model: r.model ?? "",
          evaluatedAt: r.evaluatedAt.toISOString(),
        } as unknown as EvaluatedRequirement;
      },
    },
    sidecar: {
      async verify(v) { try { return await verifyAttestation(v); } catch (e) { throw upstream("The signing sidecar", e); } },
      signCall: (rec) => signCall(rec),
    },
    calls: {
      async record(r) {
        const row = await prisma.mcpToolCall.create({ data: {
          orgId: r.orgId, apiKeyId: r.apiKeyId, tool: r.tool, requestId: r.request_id, inputSha256: r.input_sha256, outputSha256: r.output_sha256,
          outcome: r.outcome, errorCode: r.error_code, latencyMs: r.latency_ms, verdictId: r.verdict_id, signed: (r.signed ?? undefined) as Prisma.InputJsonValue | undefined,
          channel: r.channel, llmCalls: r.llmCalls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd } });
        return row.id;
      },
    },
  };
}
