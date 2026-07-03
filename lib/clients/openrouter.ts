// OpenRouter — LLM gateway. We use the LangChain ChatOpenAI adapter pointed at
// OpenRouter's OpenAI-compatible endpoint, so LangGraph nodes get a standard LLM.
import { ChatOpenAI } from "@langchain/openai";
import { extractJSON } from "../json";

export const llm = new ChatOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
  temperature: 0,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
});

async function callJSON<T>(system: string, user: string): Promise<T> {
  const res = await llm.invoke([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
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
