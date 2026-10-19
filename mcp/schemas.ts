import { z } from "zod";

export const SPEC_ID = z.string().min(1).max(64).regex(/^[a-z0-9]+$/, "spec_id is the lowercase slug of the spec, e.g. ts38331");

export const searchSpecIn = {
  query: z.string().min(3).max(1000).describe("What to look for, in natural language."),
  spec_id: SPEC_ID.optional().describe("Restrict to one ingested spec (see the spec:// resources). Default: all specs of the organisation."),
  top_k: z.number().int().min(1).max(10).default(5),
};

export const checkConformanceIn = {
  requirement_text: z.string().min(10).max(4000).describe("ONE atomic, testable requirement of the implementation."),
  spec_id: SPEC_ID,
  clause: z.string().min(1).max(32).regex(/^[0-9A-Za-z.]+$/).optional()
    .describe("Optional clause hint (e.g. 5.3.3). If given, retrieval is skipped and this clause is assessed."),
};

export const EXTRACT_DESCRIPTION_LIMIT =
  "Only the FIRST 12,000 characters of document_text are read; the rest is ignored (the response says so in `truncated`).";
export const extractRequirementsIn = {
  document_text: z.string().min(20).max(500_000).describe("Plain text of the implementation document. " + EXTRACT_DESCRIPTION_LIMIT),
};

export const verdictIdIn = { verdict_id: z.string().uuid() };

const citation = z.object({
  spec: z.string(), version: z.string(), release: z.string(), clause: z.string(),
  clause_title: z.string().nullable(), display: z.string(), text: z.string(), normative: z.string(),
});
export type CitationOut = z.infer<typeof citation>;

/** Reference to the signed tool-call record of THIS call (one per call). */
const call = z.object({
  request_id: z.string(), record_id: z.string(),
  signed: z.boolean().describe("false if the signing sidecar was unreachable: the record exists but carries no signature"),
});

const attestation = z.object({
  key_id: z.string(), issued_at: z.string(), content_hash: z.string(), signature: z.string(), public_key: z.string(),
  calibrated: z.boolean(), calibrated_confidence: z.number().nullable(), ci_low: z.number().nullable(), ci_high: z.number().nullable(),
  raw_confidence: z.number(), calibration_version: z.string(),
});

const verdictCore = z.object({
  verdict_id: z.string(),
  requirement: z.string(),
  verdict: z.enum(["conformant", "gap", "insufficient_evidence"]),
  abstained: z.boolean().describe("true when the system did NOT commit: the item is routed to a human reviewer"),
  review: z.object({ required: z.boolean(), reason: z.string().nullable() }),
  confidence: z.number(),
  citations: z.array(citation),
  verifier: z.object({ agrees: z.boolean(), confidence: z.number(), note: z.string() }),
  attestation: attestation.nullable(),
  evaluated_at: z.string(),
});

export const searchSpecOut = {
  hits: z.array(citation.extend({ spec_id: z.string() })),
  call,
};
export const checkConformanceOut = { ...verdictCore.shape, call };
export const getVerdictOut = { ...verdictCore.shape, call };
export const extractRequirementsOut = {
  requirements: z.array(z.object({ requirement: z.string(), section: z.string().nullable() })),
  chars_read: z.number().int(), truncated: z.boolean(), call,
};
export const verifyVerdictOut = {
  verdict_id: z.string(),
  integrity_valid: z.boolean().describe("The content hash and the Ed25519 signature are consistent with the stored verdict."),
  signer_trusted: z.boolean().describe("...and the signing key is listed in the sidecar's trusted-keys.json (currently an empty list: false)."),
  key_id: z.string().nullable(), issues: z.array(z.string()), trust_issues: z.array(z.string()), warnings: z.array(z.string()), call,
};
