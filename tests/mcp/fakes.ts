// In-memory McpDeps: two organisations, one invented spec each (no 3GPP text). Nothing here touches a network.
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateApiKey, type ApiKeyRow, type Principal } from "../../mcp/auth";
import type { CallRow, McpDeps, SpecInfo } from "../../mcp/deps";
import { createMcpServer } from "../../mcp/server";
import type { ClauseCitation, EvaluatedRequirement } from "../../lib/conformance-contract";
import type { EvaluatedRow } from "../../lib/evaluate-requirement";
import { addUsage } from "../../lib/usage";
import { CLAUSES } from "../helpers/world";
import { fakeAttestResponse } from "../helpers/world";

export const ORG_A = "org_a", ORG_B = "org_b";
const SPEC_A: SpecInfo = { id: "lcp100", spec: "LCP 100", version: "1.0.0", release: "Rel-0", name: "lcp100.txt" };
const SPEC_B: SpecInfo = { id: "xyz200", spec: "XYZ 200", version: "2.0.0", release: "Rel-1", name: "xyz200.txt" };

export const citation = (clause: string, spec: SpecInfo = SPEC_A): ClauseCitation => ({
  spec: spec.spec, version: spec.version, release: spec.release, clause, clauseTitle: CLAUSES[clause]?.title,
  text: CLAUSES[clause]?.text ?? "", charStart: 0, charEnd: 10, normative: "shall",
  display: `${spec.spec} v${spec.version} ${spec.release} §${clause}`,
});

export interface Fakes extends McpDeps {
  calls: McpDeps["calls"] & { rows: (CallRow & { id: string })[]; failNext: boolean };
  sidecar: McpDeps["sidecar"] & { signUp: boolean; verifyCalls: number };
  stored: Map<string, EvaluatedRequirement & { orgId: string }>;
  keyRows: Map<string, ApiKeyRow>;
  keyA: string; keyB: string;
}

export function makeFakes(): Fakes {
  const a = generateApiKey(), b = generateApiKey();
  const keyRows = new Map<string, ApiKeyRow>([
    [a.prefix, { id: "key-a", orgId: ORG_A, keyHash: a.keyHash, revokedAt: null }],
    [b.prefix, { id: "key-b", orgId: ORG_B, keyHash: b.keyHash, revokedAt: null }],
  ]);
  const stored = new Map<string, EvaluatedRequirement & { orgId: string }>();
  const rows: (CallRow & { id: string })[] = [];
  const specsOf = (org: string) => (org === ORG_A ? [SPEC_A] : org === ORG_B ? [SPEC_B] : []);

  const fakes: Fakes = {
    keyA: a.key, keyB: b.key, keyRows, stored,
    keys: { findByPrefix: async (p) => keyRows.get(p) ?? null, touch: async () => undefined },
    specs: { list: async (org) => specsOf(org) },
    search: async (_o, spec, query, topK) => (/session/i.test(query) ? ["5.3.3", "5.3.5"] : []).slice(0, topK).map((c) => citation(c, spec)),
    citations: async (_o, spec, requirement, clause) => {
      if (clause) {
        if (!CLAUSES[clause]) { const { McpToolError } = await import("../../mcp/errors"); throw new McpToolError("clause_not_found", `Clause ${clause} is not in ${spec.spec}`); }
        return { citations: [citation(clause, spec)], path: [`hint:${clause}`] };
      }
      return /SessionRequest/.test(requirement) ? { citations: [citation("5.3.3", spec)], path: [] } : { citations: [], path: [] };
    },
    evaluate: async (i): Promise<EvaluatedRow> => {
      const none = i.citations.length === 0;
      addUsage("test/model", 100, 50); // the real call chain meters tokens in lib/clients/openrouter.ts
      i.onStep?.({ name: "assessment", rawVerdict: none ? "insufficient_evidence" : "conformant", verdict: none ? "insufficient_evidence" : "conformant", guardReason: none ? null : null, verifierAgrees: true });
      const att = fakeAttestResponse({ requirement: i.requirement, verdict: none ? "insufficient_evidence" : "conformant", assessor_confidence: 0.95, verifier_confidence: 0.9, verifier_agrees: true });
      i.onStep?.({ name: "attestation", calibrated: att.calibrated, keyId: att.key_id });
      return {
        id: randomUUID(), runId: i.runId, requirement: i.requirement, source: { documentId: i.standardId, documentName: i.implDocName },
        citations: i.citations, verdict: none ? "insufficient_evidence" : "conformant", normative: "shall", confidence: att.calibrated_confidence ?? att.raw_confidence,
        verifier: { agrees: true, confidence: 0.9, note: "ok" }, review: none ? { required: true, reason: "no_clause_found" } : { required: false },
        retrievalPath: i.path, model: "test", evaluatedAt: "2026-01-01T00:00:00.000Z", trace: { requestId: i.requestId },
        attestation: { calibrated: att.calibrated, calibratedConfidence: att.calibrated_confidence, ciLow: att.ci_low, ciHigh: att.ci_high, rawConfidence: att.raw_confidence,
          calibrationVersion: att.calibration_version, nReference: att.n_reference, trancheN: att.tranche_n, keyId: att.key_id, issuedAt: att.issued_at,
          contentHash: att.content_hash, signature: att.signature, publicKey: att.public_key },
      } as unknown as EvaluatedRow;
    },
    extract: async (t) => t.split("\n").filter(Boolean).map((l, i) => ({ requirement: l, section: String(i + 1) })),
    verdicts: {
      create: async (orgId, _k, build) => { const row = await build(randomUUID()); stored.set(row.id, { ...row, orgId }); return row; },
      get: async (orgId, id) => { const r = stored.get(id); return r && r.orgId === orgId ? r : null; }, // the same org filter as the Prisma query
    },
    sidecar: {
      signUp: true, verifyCalls: 0,
      verify: async function (v) {
        (fakes.sidecar as Fakes["sidecar"]).verifyCalls++;
        const intact = v.attestation.signature.startsWith("sig-");
        return { integrity_valid: intact, signer_trusted: false, key_id: v.attestation.key_id, issues: intact ? [] : ["Ed25519 signature does not verify"],
          trust_issues: intact ? ["signing key keyid-test is not in trusted-keys.json"] : [], warnings: ["signer not pinned: the signature proves integrity, not identity"] };
      },
      signCall: async (rec) => {
        if (!(fakes.sidecar as Fakes["sidecar"]).signUp) throw new Error("sidecar down");
        return { ...rec, key_id: "keyid-test", issued_at: "2026-01-01T00:00:00Z", content_hash: "h".repeat(64), signature: "s".repeat(128), public_key: "p".repeat(64) };
      },
    },
    calls: {
      rows, failNext: false,
      record: async (row) => {
        if ((fakes.calls as Fakes["calls"]).failNext) { (fakes.calls as Fakes["calls"]).failNext = false; throw new Error("db down"); }
        const id = randomUUID(); rows.push({ ...row, id }); return id;
      },
    },
  } as Fakes;
  return fakes;
}

export async function connect(deps: McpDeps, principal: Principal): Promise<Client> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps, principal).connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  return client;
}

export const text = (r: { content?: unknown }) => JSON.parse(((r.content as { text: string }[])[0]).text);
