// OpenRouter — LLM gateway. We use the LangChain ChatOpenAI adapter pointed at
// OpenRouter's OpenAI-compatible endpoint, so LangGraph nodes get a standard LLM.
import { ChatOpenAI } from "@langchain/openai";
import { extractJSON } from "../json";

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

function llm(model: string = assessorModel()): ChatOpenAI {
  let c = _llms.get(model);
  if (!c) {
    c = new ChatOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      model,
      temperature: 0,
      configuration: { baseURL: "https://openrouter.ai/api/v1" },
    });
    _llms.set(model, c);
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

async function callJSON<T>(system: string, user: string, model?: string): Promise<T> {
  const res = await llm(model).invoke([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  llmStats.calls++;
  const u = (res as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
  if (u) { llmStats.inputTokens += u.input_tokens ?? 0; llmStats.outputTokens += u.output_tokens ?? 0; }
  return JSON.parse(extractJSON(String(res.content))) as T;
}

/** Ask for strict JSON and parse it, tolerating fences/prose; retry once. */
export async function llmJSON<T>(system: string, user: string, opts: { model?: string } = {}): Promise<T> {
  try {
    return await callJSON<T>(system, user, opts.model);
  } catch {
    // Models occasionally append a trailing sentence — retry once, insisting on raw JSON.
    return await callJSON<T>(
      `${system}\nReturn ONLY the raw JSON value — no prose, no markdown, no code fences.`,
      user, opts.model
    );
  }
}
