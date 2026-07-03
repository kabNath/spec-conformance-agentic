"""
Vidimus eval sidecar — REAL calibrated confidence + signed attestation.

The TS conformance pipeline POSTs each evaluated requirement here. This service
delegates its cryptographic + statistical work to the published `vidimus`
library (github.com/kabNath/vidimus), calling its real primitives:

  * calibrated confidence + CI  -> vidimus.audit.uncertainty.bootstrap_ci
  * canonical JSON (RFC 8785)    -> vidimus.audit.canonical.canonicalize
  * Ed25519 signature            -> vidimus.audit.signing.sign_hex
  * issuer keypair (persisted)   -> vidimus.audit.keys.{generate,load,save}_keypair

The library's high-level `attest()` is a *batch, store-backed, multi-judge*
audit over a time window — a different shape from this per-requirement endpoint —
so we compose its primitives directly rather than misusing that function.
"""
from pathlib import Path
import hashlib
import os

from fastapi import FastAPI
from pydantic import BaseModel

from vidimus.audit.uncertainty import bootstrap_ci
from vidimus.audit.canonical import canonicalize
from vidimus.audit.signing import sign_hex
from vidimus.audit.keys import KeyPair, generate_keypair, load_keypair, save_keypair

app = FastAPI(title="vidimus-eval")

# Persistent issuer keypair (PEM files named by fingerprint, written by vidimus).
# Mount a secret dir in prod; generated on first run in dev.
_KEYS_DIR = Path(os.getenv("VIDIMUS_KEYS_DIR", "/data/vidimus-keys"))


def _keypair() -> KeyPair:
    existing = sorted(_KEYS_DIR.glob("*.priv.pem"))
    if existing:
        return load_keypair(existing[0])
    kp = generate_keypair()
    save_keypair(kp, _KEYS_DIR)
    return kp


class AttestIn(BaseModel):
    requirement: str
    verdict: str
    assessor_confidence: float
    verifier_confidence: float
    verifier_agrees: bool
    citations: list[dict]


class AttestOut(BaseModel):
    calibrated_confidence: float
    ci_low: float
    ci_high: float
    content_hash: str
    signature: str
    public_key: str


@app.post("/attest", response_model=AttestOut)
def attest(x: AttestIn) -> AttestOut:
    # Calibrated confidence: penalise verifier disagreement, then a real
    # non-parametric bootstrap CI over the two judge signals (vidimus).
    signals = [x.assessor_confidence, x.verifier_confidence]
    if not x.verifier_agrees:
        signals = [s * 0.5 for s in signals]
    ci = bootstrap_ci(signals, iterations=1000)

    # Tamper-evident attestation: canonical JSON (RFC 8785) -> SHA-256 ->
    # Ed25519 signature, all via vidimus primitives.
    payload = {
        "requirement": x.requirement,
        "verdict": x.verdict,
        "calibrated_confidence": round(ci.point_estimate, 4),
        "citations": [c.get("display") for c in x.citations],
    }
    content_hash = hashlib.sha256(canonicalize(payload)).hexdigest()
    kp = _keypair()
    signature = sign_hex(kp.private_key, content_hash.encode())

    return AttestOut(
        calibrated_confidence=round(ci.point_estimate, 4),
        ci_low=round(ci.ci_low, 4),
        ci_high=round(ci.ci_high, 4),
        content_hash=content_hash,
        signature=signature,
        public_key=kp.public_key_hex,
    )


@app.get("/health")
def health():
    return {"ok": True}
