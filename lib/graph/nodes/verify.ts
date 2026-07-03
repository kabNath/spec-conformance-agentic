import { llmJSON } from "../../clients/openrouter";
import type { Verdict, VerifierResult } from "../../conformance-contract";
import type { ConformanceStateT } from "../state";

export async function verify(req: string, verdict: Verdict, citations: ConformanceStateT["citations"]): Promise<VerifierResult> {
  if (citations.length === 0) return { agrees: verdict === "insufficient_evidence", confidence: 0.5, note: "No clause to verify." };
  const sys =
    "You are an adversarial verifier. Check whether the quoted clause text genuinely " +
    'supports the verdict. Be skeptical. Reply ONLY JSON {"agrees":<bool>,"confidence":0.0,"note":"..."}';
  const block = citations.map((c) => `[${c.display}]\n${c.text}`).join("\n---\n");
  const d = await llmJSON<VerifierResult>(sys, `REQUIREMENT:\n${req}\nVERDICT: ${verdict}\nCLAUSES:\n${block}`);
  return { agrees: Boolean(d.agrees), confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)), note: d.note ?? "" };
}
