"""Export one verdict attestation from a demo run and derive the tampered and wrong-key variants.

    python scripts/export-demo-attestations.py <runId> [--api http://localhost:3000] [--pick R-index|first-gap]

Reads the run through the local app API (demo mode), writes demo/attestation-valid.json, demo/attestation-tampered.json
(one character of the requirement changed) and demo/attestation-wrong-key.json (same verdict re-signed by ANOTHER test key,
perfectly self-consistent). The test key is derived from a public seed string: it is a demo key, never use it for anything real.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "vidimus-svc"))
import trust  # noqa: E402
from vidimus.audit.canonical import canonicalize  # noqa: E402
from vidimus.audit.keys import _fingerprint  # noqa: E402
from vidimus.audit.signing import sign_hex  # noqa: E402

TYPE = "vidimus-svc.verdict-attestation.v1"


def to_doc(row: dict) -> dict:
    a = row["attestation"]
    return {"type": TYPE, "requirement": row["requirement"], "verdict": row["verdict"],
            "citations": [c["display"] for c in row["citations"]],
            "attestation": {"calibrated": a["calibrated"], "calibrated_confidence": a["calibratedConfidence"], "ci_low": a["ciLow"],
                            "ci_high": a["ciHigh"], "raw_confidence": a["rawConfidence"], "calibration_version": a["calibrationVersion"],
                            "n_reference": a["nReference"], "tranche_n": a["trancheN"], "key_id": a["keyId"], "issued_at": a["issuedAt"],
                            "content_hash": a["contentHash"], "signature": a["signature"], "public_key": a["publicKey"]}}


def main() -> None:
    run_id = sys.argv[1]
    api = sys.argv[sys.argv.index("--api") + 1] if "--api" in sys.argv else "http://localhost:3000"
    data = json.load(urllib.request.urlopen(f"{api}/api/runs/{run_id}", timeout=30))
    rows = [r for r in data["requirements"] if r.get("attestation")]
    pick = sys.argv[sys.argv.index("--pick") + 1] if "--pick" in sys.argv else "first-gap"
    row = next((r for r in rows if r["verdict"] == "gap" and not r["review"]["required"]), None) if pick == "first-gap" else None
    row = row or next((r for r in rows if r["attestation"]["calibrated"]), rows[0])
    valid = to_doc(row)

    out = ROOT / "demo"
    out.mkdir(exist_ok=True)
    (out / "attestation-valid.json").write_text(json.dumps(valid, indent=2, ensure_ascii=False) + "\n")

    tampered = json.loads(json.dumps(valid))
    r = tampered["requirement"]
    tampered["requirement"] = r[:4] + ("X" if r[4] != "X" else "Y") + r[5:]  # ONE character changed
    (out / "attestation-tampered.json").write_text(json.dumps(tampered, indent=2, ensure_ascii=False) + "\n")

    other = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"vidimus-demo-other-signer").digest())
    pub = other.public_key()
    raw_pub = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    forged = json.loads(json.dumps(valid))
    fa = forged["attestation"]
    fa["key_id"], fa["public_key"] = _fingerprint(pub), raw_pub.hex()
    payload = trust.signed_payload(forged["requirement"], forged["verdict"], fa, [{"display": c} for c in forged["citations"]])
    fa["content_hash"] = hashlib.sha256(canonicalize(payload)).hexdigest()
    fa["signature"] = sign_hex(other, fa["content_hash"].encode())
    (out / "attestation-wrong-key.json").write_text(json.dumps(forged, indent=2, ensure_ascii=False) + "\n")

    print(f"exported verdict={valid['verdict']} calibrated={valid['attestation']['calibrated']} key_id={valid['attestation']['key_id']}")
    print(f"valid signer fingerprint (to pin): {valid['attestation']['key_id']}")
    print(f"wrong-key signer fingerprint:      {fa['key_id']}")


if __name__ == "__main__":
    main()
