"""/verify (verdict attestations) and /sign-call (tool-call records): round trips, tampering, trust reporting.

Run: python vidimus-svc/test_verify_and_sign.py   (needs the `vidimus` package + fastapi + httpx, no network)
"""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("VIDIMUS_KEYS_DIR", tempfile.mkdtemp(prefix="vidimus-keys-"))
os.environ.setdefault("VIDIMUS_ALLOW_EPHEMERAL", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import trust  # noqa: E402

client = TestClient(main.app)
CITES = [{"display": "LCP 100 v1.0.0 Rel-0 §5.3.3"}]
REQ = "The terminal starts timer T901 and sends a SessionRequest message."


def attested() -> dict:
    r = client.post("/attest", json={"requirement": REQ, "verdict": "conformant", "assessor_confidence": 0.9,
                                     "verifier_confidence": 0.9, "verifier_agrees": True, "citations": CITES})
    assert r.status_code == 200, r.text
    return r.json()


def verify(req=REQ, verdict="conformant", cites=CITES, att=None):
    r = client.post("/verify", json={"requirement": req, "verdict": verdict, "citations": cites, "attestation": att or attested()})
    assert r.status_code == 200, r.text
    return r.json()


def test_valid_attestation_is_intact_but_signer_is_not_pinned():
    v = verify()
    assert v["integrity_valid"] and not v["signer_trusted"] and v["issues"] == []
    assert any("not pinned" in w for w in v["warnings"])


def test_altered_requirement_verdict_or_citation_is_refused():
    att = attested()
    for kw in ({"req": REQ + "!"}, {"verdict": "gap"}, {"cites": [{"display": "other"}]}):
        v = verify(att=att, **kw)
        assert not v["integrity_valid"] and any("content hash" in i for i in v["issues"]), kw


def test_altered_signature_or_confidence_is_refused():
    att = attested(); att["signature"] = "00" * 64
    assert not verify(att=att)["integrity_valid"]
    att = attested(); att["raw_confidence"] = 0.99
    assert not verify(att=att)["integrity_valid"]


def test_malformed_attestation_is_refused_not_a_500():
    v = verify(att={"key_id": "x"})
    assert not v["integrity_valid"] and v["issues"]


RECORD = {"tool": "check_conformance", "org_id_sha256": "a" * 64, "request_id": "req-1", "input_sha256": "b" * 64,
          "output_sha256": "c" * 64, "outcome": "ok", "error_code": None, "latency_ms": 123, "verdict_id": "v-1"}


def test_tool_call_record_round_trip_and_tamper_detection():
    r = client.post("/sign-call", json=RECORD)
    assert r.status_code == 200, r.text
    rec = r.json()
    own = [{"key_id": rec["key_id"], "_from": trust.parse_time("1970-01-01T00:00:00Z"), "_until": None}]
    assert trust.verify_tool_call_record(rec, own) == (True, [])
    assert trust.verify_tool_call_record(rec, [])[0] is False  # unlisted signer is reported
    for field, value in (("outcome", "error"), ("latency_ms", 1), ("input_sha256", "d" * 64), ("tool", "get_verdict")):
        bad = {**rec, field: value}
        ok, issues = trust.verify_tool_call_record(bad, own)
        assert not ok and any("content hash" in i for i in issues), field


def test_tool_call_record_cannot_pass_as_a_verdict_attestation():
    rec = client.post("/sign-call", json=RECORD).json()
    v = verify(att=rec)
    assert not v["integrity_valid"]


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"ok   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1; print(f"FAIL {name}: {e!r}")
    sys.exit(1 if failed else 0)
