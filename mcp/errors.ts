// Typed errors of the MCP tools. Every failure a client can see has a stable `code`.
export type ErrorCode =
  | "unauthorized"          // missing, unknown or revoked API key
  | "invalid_input"
  | "spec_not_found"        // spec_id is not an ingested standard of this organisation
  | "clause_not_found"      // the clause hint is not in the graph
  | "verdict_not_found"     // unknown id, or it belongs to another organisation (indistinguishable on purpose)
  | "no_attestation"        // the stored verdict has no signed attestation
  | "upstream_unavailable"  // sidecar / model provider / graph / vector store unreachable
  | "audit_failed"          // the tool-call record could not be stored: the call fails closed
  | "internal";

export class McpToolError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "McpToolError";
  }
}

export const toErrorBody = (e: McpToolError) => ({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
