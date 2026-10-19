import { llmJSON } from "../../clients/openrouter";
import type { ConformanceStateT } from "../state";

/** Characters of the implementation document that the extraction step reads. Anything beyond is ignored. */
export const EXTRACT_MAX_CHARS = 12000;

export async function extractRequirements(text: string, docName: string): Promise<{ requirement: string; section?: string }[]> {
  const sys =
    "Extract atomic, individually testable requirements from a wireless implementation " +
    "document. Do not invent requirements. Reply ONLY with JSON: " +
    '{"requirements":[{"requirement":"...","section":"3.4"}]}.';
  const data = await llmJSON<{ requirements: { requirement: string; section?: string }[] }>(
    sys, `IMPLEMENTATION DOCUMENT (${docName}):\n${text.slice(0, EXTRACT_MAX_CHARS)}`
  );
  return data.requirements ?? [];
}

export async function extractNode(s: ConformanceStateT): Promise<Partial<ConformanceStateT>> {
  return { requirements: await extractRequirements(s.implDocText, s.implDocName), cursor: 0 };
}
