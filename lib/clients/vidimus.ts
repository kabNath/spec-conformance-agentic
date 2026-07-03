// Vidimus eval sidecar client — calibrated confidence + signed attestation.
import type { Attestation, ClauseCitation } from "../conformance-contract";

const URL = process.env.VIDIMUS_URL ?? "http://localhost:4319";

export async function attest(input: {
  requirement: string; verdict: string;
  assessorConfidence: number; verifierConfidence: number; verifierAgrees: boolean;
  citations: ClauseCitation[];
}): Promise<Attestation> {
  const res = await fetch(`${URL}/attest`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requirement: input.requirement, verdict: input.verdict,
      assessor_confidence: input.assessorConfidence,
      verifier_confidence: input.verifierConfidence,
      verifier_agrees: input.verifierAgrees, citations: input.citations,
    }),
  });
  if (!res.ok) throw new Error(`vidimus /attest ${res.status}`);
  const d = await res.json();
  return {
    calibratedConfidence: d.calibrated_confidence, ciLow: d.ci_low, ciHigh: d.ci_high,
    contentHash: d.content_hash, signature: d.signature, publicKey: d.public_key,
  };
}
