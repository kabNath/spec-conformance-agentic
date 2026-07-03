import { llmJSON } from "../../clients/openrouter";
import type { Verdict, NormativeKeyword } from "../../conformance-contract";
import type { ConformanceStateT } from "../state";

export interface AssessOut { verdict: Verdict; confidence: number; gapNote?: string; normative: NormativeKeyword }

export async function assess(req: string, citations: ConformanceStateT["citations"]): Promise<AssessOut> {
  if (citations.length === 0) {
    return { verdict: "insufficient_evidence", confidence: 0.2, normative: "none",
      gapNote: "No governing clause found." };
  }
  const sys =
    "Assess conformance to the governing 3GPP clause(s). Judge ONLY from the clause text. " +
    'Reply ONLY JSON {"verdict":"conformant|gap|insufficient_evidence","confidence":0.0,"gapNote":"..."}';
  const block = citations.map((c) => `[${c.display}] (${c.normative})\n${c.text}`).join("\n---\n");
  const d = await llmJSON<Omit<AssessOut, "normative">>(sys, `REQUIREMENT:\n${req}\n\nCLAUSES:\n${block}`);
  const order: NormativeKeyword[] = ["shall_not", "shall", "should_not", "should", "may", "none"];
  const normative = order.find((k) => citations.some((c) => c.normative === k)) ?? "none";
  return { verdict: d.verdict, confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)), gapNote: d.gapNote, normative };
}
