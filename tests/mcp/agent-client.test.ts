import { describe, it, expect } from "vitest";
import { runConformanceTask } from "../../examples/mcp/agent-client";
import { ORG_A, connect, makeFakes } from "./fakes";

describe("examples/mcp/agent-client.ts (LangGraph workflow over the MCP server)", () => {
  it("completes a multi-step task: committed verdicts are verified, abstentions go to a human", async () => {
    const f = makeFakes();
    const client = await connect(f, { orgId: ORG_A, apiKeyId: "key-a" });
    const out = await runConformanceTask(client, "lcp100", [
      "The terminal sends a SessionRequest message on session set-up.",
      "The terminal encrypts the control channel with a rotating key.",
    ]);
    expect(out.findings.map((x) => [x.verdict, x.abstained])).toEqual([["conformant", false], ["insufficient_evidence", true]]);
    expect(out.findings[0]).toMatchObject({ integrity_valid: true, signer_trusted: false, clause: "5.3.3" });
    expect(out.needsHumanReview).toEqual(["The terminal encrypts the control channel with a rotating key."]);
    // search + check + verify for the first requirement, search + check for the second: 5 calls, 5 signed records
    expect(f.calls.rows.map((r) => r.tool)).toEqual(["search_spec", "check_conformance", "verify_verdict", "search_spec", "check_conformance"]);
    expect(f.calls.rows.every((r) => r.signed !== null)).toBe(true);
  });
});
