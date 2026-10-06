"""What a sidecar attestation signs, and who is allowed to have signed it.

Dependency-light on purpose (only vidimus primitives): usable by offline verifiers.

  * `signed_payload`   – the exact object canonicalised, hashed and signed by /attest
  * `load_trusted`     – trusted-keys.json: past and current signing keys with validity dates
  * `verify_attestation` – recompute the hash, check the signature, check the signer is a trusted
                         key that was valid when the attestation says it was issued

Limit: `issued_at` is asserted by the signer. Validity windows stop a *retired* key from being accepted
for new attestations only as far as the signer is honest about the date; a leaked old key could backdate.
Revoke by removing the key (or setting valid_until before the abuse) and re-publishing trusted-keys.json.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from vidimus.audit.canonical import canonicalize
from vidimus.audit.keys import public_key_from_hex
from vidimus.audit.signing import verify_hex

TRUSTED_SCHEMA = "vidimus-svc.trusted-keys.v1"


class TrustedKeysError(ValueError):
    pass


def key_id_of(public_key_hex: str) -> str:
    """Fingerprint = SHA-256 of the raw 32-byte public key (same as vidimus.audit.keys)."""
    return hashlib.sha256(bytes.fromhex(public_key_hex)).hexdigest()


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def signed_payload(requirement: str, verdict: str, d: dict, citations: list[dict]) -> dict:
    """The exact object that is canonicalised, hashed and signed.

    Everything the response claims about confidence is in here, together with the calibration it came
    from and the identity (`key_id`) and time (`issued_at`) of the signer, so none can be altered or
    re-attributed after signing.
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
        "key_id": d["key_id"],
        "issued_at": d["issued_at"],
        "citations": [c.get("display") for c in citations],
    }


def load_trusted(path) -> list[dict]:
    """Load and validate trusted-keys.json. Exactly zero or one key may be current (valid_until null)."""
    try:
        doc = json.loads(Path(path).read_text())
    except (OSError, ValueError) as e:
        raise TrustedKeysError(f"cannot read {path}: {e}") from e
    if doc.get("schema") != TRUSTED_SCHEMA:
        raise TrustedKeysError(f"{path}: schema must be {TRUSTED_SCHEMA!r}")
    keys, seen, current = [], set(), 0
    for k in doc.get("keys", []):
        try:
            kid, pub = k["key_id"], k["public_key"]
            frm = parse_time(k["valid_from"])
            until = parse_time(k["valid_until"]) if k.get("valid_until") else None
            bytes.fromhex(pub)
        except (KeyError, ValueError) as e:
            raise TrustedKeysError(f"malformed entry {k!r}: {e}") from e
        if key_id_of(pub) != kid:
            raise TrustedKeysError(f"key_id {kid} is not the fingerprint of its public_key")
        if kid in seen:
            raise TrustedKeysError(f"duplicate key {kid}")
        if until is not None and until < frm:
            raise TrustedKeysError(f"key {kid}: valid_until is before valid_from")
        seen.add(kid)
        current += until is None
        keys.append({**k, "_from": frm, "_until": until})
    if current > 1:
        raise TrustedKeysError("more than one current key (valid_until null): retire the old one first")
    return keys


def verify_attestation(resp: dict, requirement: str, verdict: str, citations: list[dict],
                       trusted: list[dict]) -> tuple[bool, list[str]]:
    """Fully verify one /attest response against the request it answers and the trusted-key list."""
    issues: list[str] = []
    try:
        pub = resp["public_key"]
        if key_id_of(pub) != resp["key_id"]:
            return False, ["key_id is not the fingerprint of public_key"]
        payload = signed_payload(requirement, verdict, resp, citations)
        h = hashlib.sha256(canonicalize(payload)).hexdigest()
        if h != resp["content_hash"]:
            issues.append("content hash does not match the signed payload (content altered, or wrong request)")
        if not verify_hex(public_key_from_hex(pub), resp["signature"], resp["content_hash"].encode()):
            issues.append("Ed25519 signature does not verify")
        issued = parse_time(resp["issued_at"])
    except (KeyError, ValueError) as e:
        return False, [f"malformed attestation: {e}"]

    entry = next((k for k in trusted if k["key_id"] == resp["key_id"]), None)
    if entry is None:
        issues.append(f"signing key {resp['key_id']} is not in trusted-keys.json")
    elif issued < entry["_from"] or (entry["_until"] is not None and issued > entry["_until"]):
        issues.append(f"issued_at {resp['issued_at']} is outside the validity window of key {resp['key_id']}")
    return not issues, issues
