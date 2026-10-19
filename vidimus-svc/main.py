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
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import logging
import os
import threading

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from pydantic import BaseModel

from vidimus.audit.canonical import canonicalize
from vidimus.audit.signing import sign_hex
from vidimus.audit.keys import KeyPair, generate_keypair, load_keypair, save_keypair

import calibration
from trust import (  # noqa: F401  (signed_payload re-exported)
    TrustedKeysError, load_trusted, signed_payload, tool_call_payload, verify_attestation,
)

log = logging.getLogger("vidimus-svc")

# --- Signing key -----------------------------------------------------------------------------------
# Source, in order:  1. $VIDIMUS_SIGNING_KEY_PEM (secret env, for platforms without volumes)
#                    2. a key file in $VIDIMUS_KEYS_DIR (mount a persistent volume there)
#                    3. generate one — ONLY if VIDIMUS_ALLOW_EPHEMERAL=1 (local development).
# Otherwise the service refuses to start: an attestation signed by a key that vanishes on restart
# cannot be verified later. Key material is never logged; only the public key id is.
_KEYS_DIR = Path(os.getenv("VIDIMUS_KEYS_DIR", "/data/vidimus-keys"))
_TRUSTED_FILE = Path(os.getenv("VIDIMUS_TRUSTED_KEYS", str(Path(__file__).resolve().parent / "trusted-keys.json")))
_key_lock = threading.Lock()
_key: KeyPair | None = None


class KeyConfigError(RuntimeError):
    pass


def _keypair_from_pem(pem: str) -> KeyPair:
    if "\n" not in pem and "\\n" in pem:  # one-line env values carrying a literal backslash-n
        pem = pem.replace("\\n", "\n")
    try:
        priv = serialization.load_pem_private_key(pem.encode(), password=None)
        if not isinstance(priv, Ed25519PrivateKey):
            raise ValueError("not an Ed25519 key")
    except Exception:  # deliberately generic: never echo the value or the parser's details
        raise KeyConfigError(
            "VIDIMUS_SIGNING_KEY_PEM is set but is not a valid unencrypted Ed25519 private key in PEM format"
        ) from None
    pub = priv.public_key()
    raw = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return KeyPair(private_key=priv, public_key=pub, fingerprint=hashlib.sha256(raw).hexdigest())


def _load_signing_key() -> tuple[KeyPair, str]:
    pem = os.getenv("VIDIMUS_SIGNING_KEY_PEM")
    if pem:
        return _keypair_from_pem(pem), "env VIDIMUS_SIGNING_KEY_PEM"
    existing = sorted(_KEYS_DIR.glob("*.priv.pem"))
    if existing:
        return load_keypair(existing[0]), f"file in {_KEYS_DIR}"
    if os.getenv("VIDIMUS_ALLOW_EPHEMERAL") == "1":
        kp = generate_keypair()
        save_keypair(kp, _KEYS_DIR)
        return kp, f"generated (VIDIMUS_ALLOW_EPHEMERAL=1) and saved in {_KEYS_DIR}"
    raise KeyConfigError(
        f"No signing key found in {_KEYS_DIR} and VIDIMUS_SIGNING_KEY_PEM is not set. Refusing to start: "
        "mount a persistent volume holding the key at that path, or provide the key through the "
        "VIDIMUS_SIGNING_KEY_PEM secret. For LOCAL DEVELOPMENT ONLY, set VIDIMUS_ALLOW_EPHEMERAL=1 to "
        "generate one on first start."
    )


def get_signing_key() -> KeyPair:
    global _key
    with _key_lock:
        if _key is None:
            _key, source = _load_signing_key()
            log.warning("signing key loaded: key_id=%s source=%s", _key.fingerprint, source)
            try:
                if _key.fingerprint not in {k["key_id"] for k in load_trusted(_TRUSTED_FILE)}:
                    log.warning("key_id %s is NOT listed in trusted-keys.json: verifiers pinned to that file "
                                "will reject its attestations", _key.fingerprint)
            except TrustedKeysError as e:
                log.warning("trusted-keys.json problem: %s", e)
        return _key


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_signing_key()  # fail fast, at startup, with a clear message
    yield


app = FastAPI(title="vidimus-eval", lifespan=lifespan)


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
    key_id: str          # fingerprint of the signing key; part of the signed payload
    issued_at: str       # UTC, part of the signed payload (used for key-rotation windows)
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


@app.post("/attest", response_model=AttestOut)
def attest(x: AttestIn) -> AttestOut:
    raw = calibration.raw_confidence(x.assessor_confidence, x.verifier_confidence, x.verifier_agrees)
    d = _calibrate(raw)
    d["raw_confidence"] = round(raw, 4)
    kp = get_signing_key()
    d["key_id"] = kp.fingerprint
    d["issued_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    # Tamper-evident attestation: canonical JSON (RFC 8785) -> SHA-256 ->
    # Ed25519 signature, all via vidimus primitives.
    payload = signed_payload(x.requirement, x.verdict, d, x.citations)
    content_hash = hashlib.sha256(canonicalize(payload)).hexdigest()
    signature = sign_hex(kp.private_key, content_hash.encode())

    return AttestOut(**d, content_hash=content_hash, signature=signature, public_key=kp.public_key_hex)


class VerifyIn(BaseModel):
    requirement: str
    verdict: str
    citations: list[dict]  # [{"display": "..."}]: only `display` is signed
    attestation: dict      # the AttestOut fields stored with the verdict


class VerifyOut(BaseModel):
    integrity_valid: bool  # hash and Ed25519 signature check out, whoever the signer is
    signer_trusted: bool   # ...and the signing key is listed in trusted-keys.json and was valid at issued_at
    key_id: str | None
    issues: list[str]      # integrity problems (empty when integrity_valid)
    trust_issues: list[str]
    warnings: list[str]


@app.post("/verify", response_model=VerifyOut)
def verify(x: VerifyIn) -> VerifyOut:
    """Check a stored verdict attestation. Integrity and trust are reported separately: an unlisted key
    (today's state: trusted-keys.json is empty) gives integrity_valid=True, signer_trusted=False."""
    a = x.attestation
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    own = [{"key_id": a.get("key_id"), "_from": epoch, "_until": None}]
    ok, issues = verify_attestation(a, x.requirement, x.verdict, x.citations, own)
    try:
        trusted = load_trusted(_TRUSTED_FILE)
    except TrustedKeysError as e:
        trusted, issues = [], issues + [f"trusted-keys.json problem: {e}"]
    trust_ok, trust_issues = verify_attestation(a, x.requirement, x.verdict, x.citations, trusted) if ok else (False, [])
    warnings = []
    if ok and not trust_ok:
        warnings.append("signer not pinned: the signature proves integrity, not identity")
    if ok and not a.get("calibrated"):
        warnings.append("confidence NOT calibrated (raw value is an uncalibrated LLM signal)")
    return VerifyOut(integrity_valid=ok, signer_trusted=ok and trust_ok, key_id=a.get("key_id"),
                     issues=issues, trust_issues=trust_issues, warnings=warnings)


class SignCallIn(BaseModel):
    tool: str
    org_id_sha256: str
    request_id: str
    input_sha256: str
    output_sha256: str | None = None
    outcome: str            # "ok" | "abstained" | "error"
    error_code: str | None = None
    latency_ms: int
    verdict_id: str | None = None


class SignCallOut(SignCallIn):
    key_id: str
    issued_at: str
    content_hash: str
    signature: str
    public_key: str


@app.post("/sign-call", response_model=SignCallOut)
def sign_call(x: SignCallIn) -> SignCallOut:
    """Sign one MCP tool-call record (hashes only, never the content). Own `type`, so a record can never be
    mistaken for a verdict attestation. Like /attest this endpoint has no caller authentication: keep the
    sidecar on a private network (a signing oracle otherwise)."""
    kp = get_signing_key()
    rec = {**x.model_dump(), "key_id": kp.fingerprint,
           "issued_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}
    content_hash = hashlib.sha256(canonicalize(tool_call_payload(rec))).hexdigest()
    signature = sign_hex(kp.private_key, content_hash.encode())
    return SignCallOut(**rec, content_hash=content_hash, signature=signature, public_key=kp.public_key_hex)


@app.get("/pubkey")
def pubkey() -> dict:
    """Public identity of the signing key (pin this in verifiers / trusted-keys.json)."""
    kp = get_signing_key()
    return {"key_id": kp.fingerprint, "public_key": kp.public_key_hex, "algorithm": "Ed25519"}


@app.get("/health")
def health():
    return {"ok": True}
