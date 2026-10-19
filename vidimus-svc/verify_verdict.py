"""Verify a per-verdict attestation file exported from the conformance app (vidimus-svc.verdict-attestation.v1).

    python vidimus-svc/verify_verdict.py demo/attestation-valid.json [--trusted-key <fingerprint or public key hex>]...

Exit code 0 = valid, 1 = refused. Without --trusted-key only integrity is checked (the signer is NOT identified).
This is NOT `vidimus verify`: that command verifies batch attestations (vidimus.attestation.v1).
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trust  # noqa: E402

TYPE = "vidimus-svc.verdict-attestation.v1"


def check(doc: dict, pins: list[str] | None) -> tuple[bool, list[str], list[str]]:
    """Returns (ok, issues, warnings)."""
    if doc.get("type") != TYPE:
        return False, [f"unsupported type {doc.get('type')!r}, expected {TYPE}"], []
    a = doc["attestation"]
    warnings: list[str] = []
    if pins is None:
        warnings.append("signer not pinned: the signature proves integrity, not identity")
        trusted_ids = {a["key_id"]}
    else:
        pins_l = {p.strip().lower() for p in pins}
        trusted_ids = {a["key_id"]} if (a["key_id"] in pins_l or a["public_key"].lower() in pins_l) else set()
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    trusted = [{"key_id": k, "_from": epoch, "_until": None} for k in trusted_ids]
    ok, issues = trust.verify_attestation(a, doc["requirement"], doc["verdict"], [{"display": c} for c in doc["citations"]], trusted)
    if not a["calibrated"]:
        warnings.append(f"confidence NOT calibrated (raw {a['raw_confidence']} is an uncalibrated LLM signal)")
    return ok, issues, warnings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--trusted-key", action="append", dest="pins")
    args = ap.parse_args()
    doc = json.loads(Path(args.file).read_text())
    ok, issues, warnings = check(doc, args.pins)
    name = Path(args.file).name
    if ok:
        print(f"✓ {name}: signature and content are valid" + (" (signer pinned)" if args.pins else " (integrity only)"))
    else:
        print(f"✗ {name}: REFUSED")
        for i in issues:
            print(f"    - {i}")
    for w in warnings:
        print(f"  ! {w}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
