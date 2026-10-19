// OpenRouter — LLM gateway. We use the LangChain ChatOpenAI adapter pointed at
// OpenRouter's OpenAI-compatible endpoint, so LangGraph nodes get a standard LLM.
import { ChatOpenAI } from "@langchain/openai";
import { extractJSON } from "../json";
import { addUsage } from "../usage";

// Lazily construct the client on first use, NOT at import time — so `next build`
// can collect page data (which imports the route modules) without
// OPENROUTER_API_KEY set. ChatOpenAI throws in its constructor when the key is
// missing, which otherwise fails the build.
const _llms = new Map<string, ChatOpenAI>();

/** Model used by the assessor / navigator. */
export function assessorModel(): string {
  return process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6";
}
/** Model used by the verifier: OPENROUTER_VERIFIER_MODEL, else (unset) the assessor's model. */
export function verifierModel(): string | undefined {
  return process.env.OPENROUTER_VERIFIER_MODEL || undefined;
}

/**
 * Provider pin for verifier calls: OPENROUTER_VERIFIER_PROVIDER="google-vertex" (comma-separated slugs) sends
 * provider: { only: [...], allow_fallbacks: false, data_collection: "deny" } so the request goes to that provider
 * or fails — never silently to another one. See https://openrouter.ai/docs/guides/routing/provider-selection
 */
export function verifierProviderPin(): { only: string[]; allow_fallbacks: false; data_collection: "deny" } | undefined {
  const slugs = (process.env.OPENROUTER_VERIFIER_PROVIDER ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return slugs.length ? { only: slugs, allow_fallbacks: false, data_collection: "deny" } : undefined;
}

function llm(model: string = assessorModel(), pin = false): ChatOpenAI {
  const provider = pin ? verifierProviderPin() : undefined;
  const key = `${model}|${provider ? JSON.stringify(provider) : ""}`;
  let c = _llms.get(key);
  if (!c) {
    c = new ChatOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      model,
      temperature: 0,
      configuration: { baseURL: "https://openrouter.ai/api/v1" },
      ...(provider ? { modelKwargs: { provider } } : {}),
    });
    _llms.set(key, c);
  }
  return c;
}

// Lightweight, opt-in usage meter. Off the hot path (a couple of adds per call);
// the eval harness reads it to report real token counts + cost. Production code
// never inspects it, so this changes no behaviour.
export const llmStats = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  reset() { this.calls = 0; this.inputTokens = 0; this.outputTokens = 0; },
};

/** One entry per LLM call: lets the eval harness look up real provider + cost on OpenRouter afterwards. */
export const callLog: { id: string | undefined; model: string; role: string }[] = [];

async function callText(system: string, user: string, model?: string, role = "assessor", pin = false): Promise<string> {
  const res = await llm(model, pin).invoke([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  llmStats.calls++;
  callLog.push({ id: (res as unknown as { id?: string }).id, model: model ?? assessorModel(), role });
  const u = (res as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
  if (u) { llmStats.inputTokens += u.input_tokens ?? 0; llmStats.outputTokens += u.output_tokens ?? 0; }
  addUsage(model ?? assessorModel(), u?.input_tokens ?? 0, u?.output_tokens ?? 0); // per-request meter (lib/usage.ts); no-op outside a metered request
  return String(res.content);
}

async function callJSON<T>(system: string, user: string, model?: string, role = "assessor", pin = false): Promise<T> {
  return JSON.parse(extractJSON(await callText(system, user, model, role, pin))) as T;
}

/** Raw model reply (no parsing), so callers can log it verbatim. */
export async function llmText(system: string, user: string, opts: { model?: string; role?: string; pin?: boolean } = {}): Promise<string> {
  return callText(system, user, opts.model, opts.role, opts.pin);
}

/** Ask for strict JSON and parse it, tolerating fences/prose; retry once. */
export async function llmJSON<T>(system: string, user: string, opts: { model?: string; role?: string; pin?: boolean } = {}): Promise<T> {
  try {
    return await callJSON<T>(system, user, opts.model, opts.role, opts.pin);
  } catch {
    // Models occasionally append a trailing sentence — retry once, insisting on raw JSON.
    return await callJSON<T>(
      `${system}\nReturn ONLY the raw JSON value — no prose, no markdown, no code fences.`,
      user, opts.model, opts.role, opts.pin
    );
  }
}
