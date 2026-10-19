// Per-request usage meter: tokens by model, attributed to the request that caused them (AsyncLocalStorage, so
// concurrent requests never mix). lib/clients/openrouter.ts adds to the current meter; nothing else reads it.
// Cost is NEVER invented: it is computed only for models that have a price in MODEL_PRICES_JSON, otherwise null.
import { AsyncLocalStorage } from "node:async_hooks";

export interface ModelUsage { calls: number; inputTokens: number; outputTokens: number }
export interface UsageMeter { byModel: Record<string, ModelUsage> }

const store = new AsyncLocalStorage<UsageMeter>();

export const newMeter = (): UsageMeter => ({ byModel: {} });
export const withMeter = <T>(meter: UsageMeter, fn: () => Promise<T>): Promise<T> => store.run(meter, fn);
export const currentMeter = () => store.getStore();

export function addUsage(model: string, inputTokens: number, outputTokens: number): void {
  const m = store.getStore();
  if (!m) return;
  const u = (m.byModel[model] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
  u.calls++; u.inputTokens += inputTokens; u.outputTokens += outputTokens;
}

export const totals = (m: UsageMeter) => Object.values(m.byModel).reduce(
  (t, u) => ({ calls: t.calls + u.calls, inputTokens: t.inputTokens + u.inputTokens, outputTokens: t.outputTokens + u.outputTokens }),
  { calls: 0, inputTokens: 0, outputTokens: 0 });

/**
 * MODEL_PRICES_JSON='{"anthropic/claude-sonnet-4.6":{"inPerMTok":<usd>,"outPerMTok":<usd>}, ...}' (USD per million tokens).
 * Returns null unless EVERY model used by the request has a price: a partial sum would understate the cost.
 */
export function estimateCostUsd(m: UsageMeter, env: Record<string, string | undefined> = process.env): number | null {
  let prices: Record<string, { inPerMTok: number; outPerMTok: number }>;
  try { prices = JSON.parse(env.MODEL_PRICES_JSON ?? "{}"); } catch { return null; }
  const models = Object.entries(m.byModel);
  if (!models.length) return null;
  let usd = 0;
  for (const [model, u] of models) {
    const p = prices[model];
    if (!p || !Number.isFinite(p.inPerMTok) || !Number.isFinite(p.outPerMTok)) return null;
    usd += (u.inputTokens * p.inPerMTok + u.outputTokens * p.outPerMTok) / 1e6;
  }
  return usd;
}
