// OpenRouter — LLM gateway. We use the LangChain ChatOpenAI adapter pointed at
// OpenRouter's OpenAI-compatible endpoint, so LangGraph nodes get a standard LLM.
import { ChatOpenAI } from "@langchain/openai";
import { extractJSON } from "../json";

// Lazily construct the client on first use, NOT at import time — so `next build`
// can collect page data (which imports the route modules) without
// OPENROUTER_API_KEY set. ChatOpenAI throws in its constructor when the key is
// missing, which otherwise fails the build.
let _llm: ChatOpenAI | null = null;
function llm(): ChatOpenAI {
  return (_llm ??= new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
    temperature: 0,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
  }));
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

async function callJSON<T>(system: string, user: string): Promise<T> {
  const res = await llm().invoke([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  llmStats.calls++;
  const u = (res as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
  if (u) { llmStats.inputTokens += u.input_tokens ?? 0; llmStats.outputTokens += u.output_tokens ?? 0; }
  return JSON.parse(extractJSON(String(res.content))) as T;
}

/** Ask for strict JSON and parse it, tolerating fences/prose; retry once. */
export async function llmJSON<T>(system: string, user: string): Promise<T> {
  try {
    return await callJSON<T>(system, user);
  } catch {
    // Models occasionally append a trailing sentence — retry once, insisting on raw JSON.
    return await callJSON<T>(
      `${system}\nReturn ONLY the raw JSON value — no prose, no markdown, no code fences.`,
      user
    );
  }
}
