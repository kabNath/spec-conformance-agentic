"""Document attestations and the production key registry.

 * the COMMITTED production attestation of the pre-registration verifies against the committed trusted-keys.json
   and against the committed pre-registration file (the private key is not needed, nor present, here);
 * tampering with the document, the payload or the signature is refused; an unlisted key is reported;
 * a sidecar started with a signing key that is listed in trusted-keys.json (VIDIMUS_SIGNING_KEY_FILE, a mounted
   secret) reports signer_trusted=True from /verify (the mechanism that makes it true in production).

Run: python vidimus-svc/test_sign_document.py   (needs vidimus + fastapi + httpx, no network)
"""
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
os.environ.setdefault("VIDIMUS_KEYS_DIR", tempfile.mkdtemp(prefix="vidimus-keys-"))

from cryptography.hazmat.primitives import serialization  # noqa: E402
from vidimus.audit.keys import generate_keypair  # noqa: E402

import sign_document as sd  # noqa: E402

DOC = ROOT / "eval" / "PREREGISTRATION-gap-guard.md"
ATT = ROOT / "docs" / "preregistration.attestation-prod.json"
TRUSTED = HERE / "trusted-keys.json"


def test_committed_attestation_is_valid_and_trusted():
    att = json.loads(ATT.read_text())
    ok, issues = sd.verify(att, TRUSTED, DOC)
    assert ok, issues
    assert att["payload"]["origin_commit"] != "ad3175f1ffef683855172fdde73093373483004e"  # the rewritten history's SHA


def test_tampering_is_refused():
    att = json.loads(ATT.read_text())
    bad = json.loads(json.dumps(att)); bad["payload"]["origin_commit"] = "0" * 40
    assert not sd.verify(bad, TRUSTED, DOC)[0]
    bad = json.loads(json.dumps(att)); bad["signature"] = "00" * 64
    assert not sd.verify(bad, TRUSTED, DOC)[0]
    with tempfile.TemporaryDirectory() as d:
        other = Path(d) / "doc.md"; other.write_text(DOC.read_text() + "x")
        ok, issues = sd.verify(att, TRUSTED, other)
        assert not ok and any("SHA-256" in i for i in issues)


def test_unlisted_key_is_reported():
    with tempfile.TemporaryDirectory() as d:
        kp = generate_keypair(); keyf = Path(d) / "k.pem"
        keyf.write_bytes(kp.private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        att = sd.sign(DOC, ROOT, "a" * 40, "2026-10-06T19:37:18+08:00", keyf)
        ok, issues = sd.verify(att, None, DOC)
        assert ok, issues  # integrity only
        ok, issues = sd.verify(att, TRUSTED, DOC)
        assert not ok and any("not in trusted-keys" in i for i in issues)


def test_sidecar_with_a_listed_key_reports_signer_trusted():
    with tempfile.TemporaryDirectory() as d:
        kp = generate_keypair(); keyf = Path(d) / "secret.pem"
        keyf.write_bytes(kp.private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        trusted = Path(d) / "trusted-keys.json"
        trusted.write_text(json.dumps({"schema": "vidimus-svc.trusted-keys.v1", "keys": [
            {"key_id": kp.fingerprint, "public_key": kp.public_key_hex, "valid_from": "2020-01-01T00:00:00Z", "valid_until": None}]}))
        os.environ["VIDIMUS_SIGNING_KEY_FILE"] = str(keyf)
        os.environ["VIDIMUS_TRUSTED_KEYS"] = str(trusted)
        for m in ("main", "trust"):
            sys.modules.pop(m, None)
        try:
            from fastapi.testclient import TestClient
            import main
            c = TestClient(main.app)
            cites = [{"display": "X §1"}]
            att = c.post("/attest", json={"requirement": "R", "verdict": "conformant", "assessor_confidence": 0.9, "verifier_confidence": 0.9,
                                          "verifier_agrees": True, "citations": cites}).json()
            assert att["key_id"] == kp.fingerprint
            v = c.post("/verify", json={"requirement": "R", "verdict": "conformant", "citations": cites, "attestation": att}).json()
            assert v["integrity_valid"] and v["signer_trusted"], v
            assert not any("not pinned" in w for w in v["warnings"])
        finally:
            for k in ("VIDIMUS_SIGNING_KEY_FILE", "VIDIMUS_TRUSTED_KEYS"):
                os.environ.pop(k, None)


def test_unreadable_key_file_refuses_to_start_without_echoing_anything():
    os.environ["VIDIMUS_SIGNING_KEY_FILE"] = "/nonexistent/secret.pem"
    sys.modules.pop("main", None)
    try:
        import main
        try:
            main._load_signing_key()
            raise AssertionError("started without a readable key")
        except main.KeyConfigError as e:
            assert "/nonexistent" not in str(e)
    finally:
        os.environ.pop("VIDIMUS_SIGNING_KEY_FILE", None)


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"ok   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1; print(f"FAIL {name}: {e!r}")
    sys.exit(1 if failed else 0)
