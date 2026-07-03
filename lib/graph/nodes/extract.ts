import { llmJSON } from "../../clients/openrouter";
import type { ConformanceStateT } from "../state";

export async function extractNode(s: ConformanceStateT): Promise<Partial<ConformanceStateT>> {
  const sys =
    "Extract atomic, individually testable requirements from a wireless implementation " +
    "document. Do not invent requirements. Reply ONLY with JSON: " +
    '{"requirements":[{"requirement":"...","section":"3.4"}]}.';
  const data = await llmJSON<{ requirements: { requirement: string; section?: string }[] }>(
    sys, `IMPLEMENTATION DOCUMENT (${s.implDocName}):\n${s.implDocText.slice(0, 12000)}`
  );
  return { requirements: data.requirements ?? [], cursor: 0 };
}
