import { describe, it, expect } from "vitest";
import { addUsage, estimateCostUsd, newMeter, totals, withMeter } from "../lib/usage";

describe("usage meter", () => {
  it("keeps concurrent requests apart", async () => {
    const a = newMeter(), b = newMeter();
    await Promise.all([
      withMeter(a, async () => { addUsage("m1", 10, 1); await new Promise((r) => setTimeout(r, 5)); addUsage("m1", 10, 1); }),
      withMeter(b, async () => { await new Promise((r) => setTimeout(r, 2)); addUsage("m2", 7, 3); }),
    ]);
    expect(totals(a)).toEqual({ calls: 2, inputTokens: 20, outputTokens: 2 });
    expect(totals(b)).toEqual({ calls: 1, inputTokens: 7, outputTokens: 3 });
  });
  it("is a no-op outside a metered request", () => { expect(() => addUsage("m", 1, 1)).not.toThrow(); });
  it("never guesses a cost", () => {
    const m = newMeter();
    void withMeter(m, async () => { addUsage("a", 1_000_000, 0); addUsage("b", 0, 1_000_000); });
    return Promise.resolve().then(() => {
      expect(estimateCostUsd(m, {})).toBeNull();
      expect(estimateCostUsd(m, { MODEL_PRICES_JSON: JSON.stringify({ a: { inPerMTok: 3, outPerMTok: 15 } }) })).toBeNull(); // b has no price
      expect(estimateCostUsd(m, { MODEL_PRICES_JSON: JSON.stringify({ a: { inPerMTok: 3, outPerMTok: 15 }, b: { inPerMTok: 1, outPerMTok: 5 } }) })).toBe(8);
      expect(estimateCostUsd(m, { MODEL_PRICES_JSON: "not json" })).toBeNull();
      expect(estimateCostUsd(newMeter(), {})).toBeNull();
    });
  });
});
