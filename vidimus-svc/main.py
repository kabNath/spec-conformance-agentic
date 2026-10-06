"""
Vidimus eval sidecar — REAL calibrated confidence + signed attestation.

The TS conformance pipeline POSTs each evaluated requirement here. This service
delegates its cryptographic + statistical work to the published `vidimus`
library (github.com/kabNath/vidimus), calling its real primitives:

  * calibrated confidence + CI  -> empirical tranche accuracy + Wilson 95% interval
                                   (calibration.py, table in eval/calibration.json)
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

from vidimus.audit.canonical import canonicalize
from vidimus.audit.signing import sign_hex
from vidimus.audit.keys import KeyPair, generate_keypair, load_keypair, save_keypair

import calibration

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
    # None when the raw-confidence tranche has fewer than MIN_N reference
    # predictions (or no calibration file is loaded): no number, no fake interval.
    calibrated: bool
    calibrated_confidence: float | None
    ci_low: float | None
    ci_high: float | None
    raw_confidence: float
    calibration_version: str
    n_reference: int
    tranche_n: int
    content_hash: str
    signature: str
    public_key: str


def _calibration_path() -> Path:
    default = Path(__file__).resolve().parent.parent / "eval" / "calibration.json"
    return Path(os.getenv("VIDIMUS_CALIBRATION_FILE", str(default)))


def _calibrate(raw: float) -> dict:
    """Map a raw confidence to the empirical accuracy of its tranche."""
    cal = calibration.load_calibration(_calibration_path())
    if cal is None:
        return {"calibrated": False, "calibrated_confidence": None, "ci_low": None,
                "ci_high": None, "calibration_version": "none", "n_reference": 0, "tranche_n": 0}
    t = calibration.lookup(cal, raw)
    ok = bool(t["calibrated"])
    return {
        "calibrated": ok,
        "calibrated_confidence": t["accuracy"] if ok else None,
        "ci_low": t["ci_low"] if ok else None,
        "ci_high": t["ci_high"] if ok else None,
        "calibration_version": cal["version"],
        "n_reference": cal["n_reference"],
        "tranche_n": t["n"],
    }


def signed_payload(requirement: str, verdict: str, d: dict, citations: list[dict]) -> dict:
    """The exact object that is canonicalised, hashed and signed.

    Everything the response claims about confidence is in here, together with
    the calibration it came from, so it cannot be altered or re-attributed.
    """
    return {
        "requirement": requirement,
        "verdict": verdict,
        "calibrated": d["calibrated"],
        "calibrated_confidence": d["calibrated_confidence"],
        "ci_low": d["ci_low"],
        "ci_high": d["ci_high"],
        "raw_confidence": d["raw_confidence"],
        "calibration_version": d["calibration_version"],
        "n_reference": d["n_reference"],
        "tranche_n": d["tranche_n"],
        "citations": [c.get("display") for c in citations],
    }


@app.post("/attest", response_model=AttestOut)
def attest(x: AttestIn) -> AttestOut:
    raw = calibration.raw_confidence(x.assessor_confidence, x.verifier_confidence, x.verifier_agrees)
    d = _calibrate(raw)
    d["raw_confidence"] = round(raw, 4)

    # Tamper-evident attestation: canonical JSON (RFC 8785) -> SHA-256 ->
    # Ed25519 signature, all via vidimus primitives.
    payload = signed_payload(x.requirement, x.verdict, d, x.citations)
    content_hash = hashlib.sha256(canonicalize(payload)).hexdigest()
    kp = _keypair()
    signature = sign_hex(kp.private_key, content_hash.encode())

    return AttestOut(**d, content_hash=content_hash, signature=signature, public_key=kp.public_key_hex)


@app.get("/health")
def health():
    return {"ok": True}
