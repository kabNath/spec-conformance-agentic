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
    calibrated: d.calibrated, calibratedConfidence: d.calibrated_confidence,
    ciLow: d.ci_low, ciHigh: d.ci_high, rawConfidence: d.raw_confidence,
    calibrationVersion: d.calibration_version, nReference: d.n_reference, trancheN: d.tranche_n,
    keyId: d.key_id, issuedAt: d.issued_at,
    contentHash: d.content_hash, signature: d.signature, publicKey: d.public_key,
  };
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${URL}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`vidimus ${path} ${res.status}`);
  return (await res.json()) as T;
};

/** Integrity and signer trust of a stored verdict attestation (sidecar POST /verify). */
export const verifyAttestation = <T>(body: unknown) => post<T>("/verify", body);
/** Signed tool-call record (sidecar POST /sign-call). */
export const signCall = <T>(body: unknown) => post<T>("/sign-call", body);
