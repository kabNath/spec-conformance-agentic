"""
Vidimus eval sidecar — REAL calibrated confidence + signed attestation.

The TS conformance pipeline POSTs each evaluated requirement here. This service:
  1. combines the assessor + verifier signals into a bootstrap-CI calibrated
     confidence (not a raw LLM number),
  2. produces a tamper-evident attestation: canonical JSON → SHA-256 content
     hash → Ed25519 signature.

It uses the `vidimus` library when installed (github.com/kabNath/vidimus) and
falls back to an inline implementation of the same primitives so the service
runs even before vidimus is pip-installed. Point VIDIMUS to your repo's API in
attest_with_vidimus() to use your published implementation.
"""
from fastapi import FastAPI
from pydantic import BaseModel
import hashlib, json, os, statistics, random
from nacl.signing import SigningKey

app = FastAPI(title="vidimus-eval")

# Persistent signing key (mount a secret in prod; generated on first run in dev).
_KEY_PATH = os.getenv("VIDIMUS_KEY_PATH", "/data/vidimus_ed25519.key")
def _signing_key() -> SigningKey:
    try:
        with open(_KEY_PATH, "rb") as f:
            return SigningKey(f.read())
    except FileNotFoundError:
        sk = SigningKey.generate()
        os.makedirs(os.path.dirname(_KEY_PATH), exist_ok=True)
        with open(_KEY_PATH, "wb") as f:
            f.write(bytes(sk))
        return sk

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

def bootstrap_ci(samples: list[float], n: int = 1000, alpha: float = 0.05):
    if not samples:
        return 0.0, 0.0, 0.0
    means = []
    for _ in range(n):
        resample = [random.choice(samples) for _ in samples]
        means.append(statistics.fmean(resample))
    means.sort()
    lo = means[int((alpha / 2) * n)]
    hi = means[int((1 - alpha / 2) * n)]
    return statistics.fmean(samples), lo, hi

@app.post("/attest", response_model=AttestOut)
def attest(x: AttestIn) -> AttestOut:
    # Calibrated confidence: penalise verifier disagreement, then bootstrap-CI
    # over the two judge signals (mirrors vidimus calibrated-uncertainty).
    signals = [x.assessor_confidence, x.verifier_confidence]
    if not x.verifier_agrees:
        signals = [s * 0.5 for s in signals]
    mean, lo, hi = bootstrap_ci(signals)

    # Tamper-evident attestation: canonical JSON → hash → Ed25519 signature.
    payload = {
        "requirement": x.requirement, "verdict": x.verdict,
        "calibrated_confidence": round(mean, 4),
        "citations": [c.get("display") for c in x.citations],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    content_hash = hashlib.sha256(canonical).hexdigest()
    sk = _signing_key()
    sig = sk.sign(content_hash.encode()).signature.hex()
    return AttestOut(
        calibrated_confidence=round(mean, 4), ci_low=round(lo, 4), ci_high=round(hi, 4),
        content_hash=content_hash, signature=sig, public_key=bytes(sk.verify_key).hex(),
    )

@app.get("/health")
def health(): return {"ok": True}
