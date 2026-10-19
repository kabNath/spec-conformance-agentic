"""Sign a document attestation (vidimus.document-attestation.v1) with an Ed25519 key kept OUTSIDE the repository.

    python vidimus-svc/sign_document.py <document> --origin-commit <sha> --origin-commit-date <iso> \
        --key-file <private key PEM> [--out attestation.json]

The payload has exactly the fields of docs/preregistration.md. The key file is read, never printed or copied.
Verify with: python vidimus-svc/sign_document.py --verify attestation.json [--trusted vidimus-svc/trusted-keys.json]
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from vidimus.audit.canonical import canonicalize
from vidimus.audit.keys import public_key_from_hex
from vidimus.audit.signing import sign_hex, verify_hex

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trust  # noqa: E402

TYPE = "vidimus.document-attestation.v1"
STATEMENT = "The signer vouches that the document with this SHA-256 is the pre-registration committed at origin_commit."


def sign(document: Path, root: Path, origin_commit: str, origin_commit_date: str, key_file: Path) -> dict:
    priv = serialization.load_pem_private_key(key_file.read_bytes(), password=None)
    raw = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    payload = {
        "type": TYPE, "document": str(document.resolve().relative_to(root)),
        "sha256": hashlib.sha256(document.read_bytes()).hexdigest(),
        "origin_commit": origin_commit, "origin_commit_date": origin_commit_date,
        "signed_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "statement": STATEMENT,
    }
    canonical = canonicalize(payload)
    return {"payload": payload, "canonical_bytes": len(canonical), "key_id": hashlib.sha256(raw).hexdigest(),
            "public_key": raw.hex(), "signature": sign_hex(priv, canonical)}


def verify(att: dict, trusted_file: Path | None, document: Path | None = None) -> tuple[bool, list[str]]:
    issues: list[str] = []
    pub = att["public_key"]
    if trust.key_id_of(pub) != att["key_id"]:
        issues.append("key_id is not the fingerprint of public_key")
    if not verify_hex(public_key_from_hex(pub), att["signature"], canonicalize(att["payload"])):
        issues.append("Ed25519 signature does not verify")
    if document is not None and hashlib.sha256(document.read_bytes()).hexdigest() != att["payload"]["sha256"]:
        issues.append("the document no longer has the signed SHA-256")
    if trusted_file is not None:
        entry = next((k for k in trust.load_trusted(trusted_file) if k["key_id"] == att["key_id"]), None)
        if entry is None:
            issues.append("signing key is not in trusted-keys.json")
        else:
            at = trust.parse_time(att["payload"]["signed_at"])
            if at < entry["_from"] or (entry["_until"] is not None and at > entry["_until"]):
                issues.append("signed_at is outside the validity window of the key")
    return not issues, issues


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("document", nargs="?")
    ap.add_argument("--root", default=".")
    ap.add_argument("--origin-commit"); ap.add_argument("--origin-commit-date"); ap.add_argument("--key-file")
    ap.add_argument("--out"); ap.add_argument("--verify"); ap.add_argument("--trusted")
    a = ap.parse_args()
    if a.verify:
        att = json.loads(Path(a.verify).read_text())
        doc = Path(a.document) if a.document else None
        ok, issues = verify(att, Path(a.trusted) if a.trusted else None, doc)
        print("valid" if ok else "REFUSED: " + "; ".join(issues))
        return 0 if ok else 1
    att = sign(Path(a.document), Path(a.root).resolve(), a.origin_commit, a.origin_commit_date, Path(a.key_file))
    text = json.dumps(att, indent=2) + "\n"
    if a.out: Path(a.out).write_text(text)
    else: print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
