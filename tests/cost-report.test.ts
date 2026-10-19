import { describe, it, expect } from "vitest";
import { percentile, summarize, type Row } from "../scripts/cost-report";

const r = (o: Partial<Row>): Row => ({ tool: "POST /api/v1/check", channel: "http", outcome: "ok", latencyMs: 100, inputTokens: 1000, outputTokens: 200, costUsd: null, ...o });

describe("cost-report", () => {
  it("uses nearest-rank percentiles", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50); expect(percentile(xs, 95)).toBe(100); expect(percentile([7], 95)).toBe(7);
  });
  it("groups per endpoint and channel, counts outcomes, never fills in a missing cost", () => {
    const s = summarize([r({ latencyMs: 100 }), r({ latencyMs: 300, outcome: "abstained" }), r({ latencyMs: 200, outcome: "error", inputTokens: null, outputTokens: null }),
      r({ tool: "search_spec", channel: "mcp", latencyMs: 5 })]);
    const check = s.find((x) => x.endpoint.endsWith("POST /api/v1/check"))!;
    expect(check).toMatchObject({ n: 3, ok: 1, abstained: 1, error: 1, p50: 200, p95: 300, meanIn: 1000, meanUsd: null, costN: 0 });
    expect(s).toHaveLength(2);
  });
  it("averages the cost over the calls that have one", () => {
    const s = summarize([r({ costUsd: 0.02 }), r({ costUsd: 0.04 }), r({ costUsd: null })]);
    expect(s[0].meanUsd).toBeCloseTo(0.03); expect(s[0].costN).toBe(2);
  });
});
