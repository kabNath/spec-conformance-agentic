"""Signing-key persistence, startup policy, /pubkey, signed key_id and rotation.

Plain asserts; run with `python vidimus-svc/test_keys.py` (CI, inside the image) or pytest.
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import trust  # noqa: E402
from vidimus.audit.keys import generate_keypair, save_keypair  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402

BODY = {"requirement": "The UE shall do X.", "verdict": "gap", "assessor_confidence": 0.9,
        "verifier_confidence": 0.8, "verifier_agrees": True, "citations": [{"display": "§5.3.3"}]}


def pem_of(kp) -> str:
    return kp.private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()).decode()


def run_service(env_extra: dict, keys_dir: Path):
    """Start uvicorn on a free port; returns (proc, port)."""
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    env = {k: v for k, v in os.environ.items() if not k.startswith("VIDIMUS_")}
    env.update({"VIDIMUS_KEYS_DIR": str(keys_dir), "PYTHONPATH": str(HERE), **env_extra})
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
                         cwd=HERE, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return p, port


def wait_up(p, port, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if p.poll() is not None:
            return False
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1); return True
        except Exception:
            time.sleep(0.2)
    return False


def get_json(port, path, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method="POST" if body else "GET",
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"content-type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


def stop(p) -> str:
    if p.poll() is None:
        p.terminate()
    try:
        return p.communicate(timeout=10)[0]
    except subprocess.TimeoutExpired:
        p.kill(); return p.communicate()[0]


# --- startup policy ---------------------------------------------------------------------------
def test_refuses_to_start_without_a_key_unless_ephemeral_allowed():
    d = Path(tempfile.mkdtemp())
    p, port = run_service({}, d)
    up = wait_up(p, port, timeout=15)
    out = stop(p)
    assert not up and p.returncode != 0, "service must refuse to start"
    assert "VIDIMUS_ALLOW_EPHEMERAL" in out and "Refusing to start" in out, out[-600:]
    assert not list(d.glob("*.pem")), "no key may be generated implicitly"


def test_ephemeral_dev_mode_generates_a_key_and_restart_keeps_the_same_public_key():
    d = Path(tempfile.mkdtemp())
    p, port = run_service({"VIDIMUS_ALLOW_EPHEMERAL": "1"}, d)
    assert wait_up(p, port), stop(p)
    first = get_json(port, "/pubkey"); stop(p)
    assert list(d.glob("*.priv.pem")), "key must be persisted in the keys dir"
    p2, port2 = run_service({}, d)  # restart WITHOUT the ephemeral flag: the persisted key is enough
    assert wait_up(p2, port2), stop(p2)
    second = get_json(port2, "/pubkey"); stop(p2)
    assert first == second and first["key_id"] == hashlib.sha256(bytes.fromhex(first["public_key"])).hexdigest()
    assert first["algorithm"] == "Ed25519"


def test_key_from_env_pem_is_used_and_never_logged():
    kp = generate_keypair(); pem = pem_of(kp)
    body_b64 = "".join(pem.splitlines()[1:-1])
    d = Path(tempfile.mkdtemp())  # empty: the env key must be enough
    p, port = run_service({"VIDIMUS_SIGNING_KEY_PEM": pem}, d)
    assert wait_up(p, port), stop(p)
    pub = get_json(port, "/pubkey")
    a = get_json(port, "/attest", BODY)
    out = stop(p)
    assert pub["public_key"] == kp.public_key_hex and pub["key_id"] == kp.fingerprint
    assert a["key_id"] == kp.fingerprint
    assert body_b64 not in out and "PRIVATE KEY" not in out, "key material leaked into the logs"
    assert not list(d.glob("*.pem")), "env key must not be written to disk"


def test_escaped_newlines_in_env_pem_are_accepted():
    kp = generate_keypair()
    p, port = run_service({"VIDIMUS_SIGNING_KEY_PEM": pem_of(kp).replace("\n", "\\n")}, Path(tempfile.mkdtemp()))
    assert wait_up(p, port), stop(p)
    assert get_json(port, "/pubkey")["key_id"] == kp.fingerprint
    stop(p)


def test_invalid_env_pem_fails_without_echoing_it():
    p, port = run_service({"VIDIMUS_SIGNING_KEY_PEM": "not-a-pem SECRETMARKER"}, Path(tempfile.mkdtemp()))
    up = wait_up(p, port, timeout=15); out = stop(p)
    assert not up and "VIDIMUS_SIGNING_KEY_PEM" in out and "SECRETMARKER" not in out


# --- key_id is signed ---------------------------------------------------------------------------
def test_key_id_and_issued_at_are_in_the_signed_payload():
    d = Path(tempfile.mkdtemp())
    p, port = run_service({"VIDIMUS_ALLOW_EPHEMERAL": "1"}, d)
    assert wait_up(p, port), stop(p)
    a = get_json(port, "/attest", BODY); stop(p)
    payload = trust.signed_payload(BODY["requirement"], BODY["verdict"], a, BODY["citations"])
    assert payload["key_id"] == a["key_id"] and payload["issued_at"] == a["issued_at"]
    assert hashlib.sha256(trust.canonicalize(payload)).hexdigest() == a["content_hash"]
    # changing key_id changes the hash, i.e. it cannot be re-attributed after signing
    forged = dict(a, key_id="00" * 32)
    assert hashlib.sha256(trust.canonicalize(
        trust.signed_payload(BODY["requirement"], BODY["verdict"], forged, BODY["citations"]))).hexdigest() != a["content_hash"]


# --- rotation / trusted-keys.json -----------------------------------------------------------------
def _attest_with(kp, issued_at: str) -> dict:
    """Produce a response exactly like the service would, signed by ``kp`` at ``issued_at``."""
    from vidimus.audit.signing import sign_hex
    d = {"calibrated": True, "calibrated_confidence": 0.875, "ci_low": 0.69, "ci_high": 0.95,
         "raw_confidence": 0.85, "calibration_version": "cal-x", "n_reference": 38, "tranche_n": 24,
         "key_id": kp.fingerprint, "issued_at": issued_at}
    payload = trust.signed_payload(BODY["requirement"], BODY["verdict"], d, BODY["citations"])
    h = hashlib.sha256(trust.canonicalize(payload)).hexdigest()
    return {**d, "content_hash": h, "signature": sign_hex(kp.private_key, h.encode()), "public_key": kp.public_key_hex}


def _trusted_file(entries) -> Path:
    p = Path(tempfile.mkdtemp()) / "trusted-keys.json"
    p.write_text(json.dumps({"schema": trust.TRUSTED_SCHEMA, "keys": entries}))
    return p


def _entry(kp, valid_from, valid_until=None, note=""):
    return {"key_id": kp.fingerprint, "public_key": kp.public_key_hex, "valid_from": valid_from,
            "valid_until": valid_until, "note": note}


def test_rotation_old_key_still_verifies_new_key_verifies_unknown_refused():
    old, new, rogue = generate_keypair(), generate_keypair(), generate_keypair()
    tk = trust.load_trusted(_trusted_file([
        _entry(old, "2026-01-01T00:00:00Z", "2026-09-01T00:00:00Z", "retired at rotation"),
        _entry(new, "2026-09-01T00:00:00Z", None, "current"),
    ]))
    args = (BODY["requirement"], BODY["verdict"], BODY["citations"], tk)
    ok, issues = trust.verify_attestation(_attest_with(old, "2026-05-01T12:00:00Z"), *args)
    assert ok, issues  # signed by the OLD key while it was valid: still verifiable today
    ok, issues = trust.verify_attestation(_attest_with(new, "2026-10-01T12:00:00Z"), *args)
    assert ok, issues
    ok, issues = trust.verify_attestation(_attest_with(rogue, "2026-10-01T12:00:00Z"), *args)
    assert not ok and any("not in trusted-keys" in i for i in issues), issues
    # the retired key must not be accepted for attestations claiming a date after its retirement
    ok, issues = trust.verify_attestation(_attest_with(old, "2026-10-01T12:00:00Z"), *args)
    assert not ok and any("outside" in i for i in issues), issues
    # nor before it was valid
    ok, _ = trust.verify_attestation(_attest_with(new, "2026-01-01T00:00:00Z"), *args)
    assert not ok


def test_tampered_or_mismatched_attestation_is_refused():
    kp = generate_keypair()
    tk = trust.load_trusted(_trusted_file([_entry(kp, "2026-01-01T00:00:00Z")]))
    args = (BODY["requirement"], BODY["verdict"], BODY["citations"], tk)
    good = _attest_with(kp, "2026-10-01T00:00:00Z")
    assert trust.verify_attestation(good, *args)[0]
    assert not trust.verify_attestation({**good, "calibrated_confidence": 0.99}, *args)[0]   # content altered
    assert not trust.verify_attestation({**good, "signature": "00" * 64}, *args)[0]
    other = generate_keypair()
    swapped = {**good, "public_key": other.public_key_hex}  # pubkey swapped: key_id no longer matches
    assert not trust.verify_attestation(swapped, *args)[0]
    assert not trust.verify_attestation(good, BODY["requirement"], "conformant", BODY["citations"], tk)[0]


def test_trusted_file_validation():
    a, b = generate_keypair(), generate_keypair()
    for bad, why in [
        ([_entry(a, "2026-01-01T00:00:00Z"), _entry(b, "2026-02-01T00:00:00Z")], "two current keys"),
        ([_entry(a, "2026-05-01T00:00:00Z", "2026-01-01T00:00:00Z")], "valid_until before valid_from"),
        ([_entry(a, "2026-01-01T00:00:00Z"), _entry(a, "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z")], "duplicate key"),
        ([{**_entry(a, "2026-01-01T00:00:00Z"), "key_id": "ab" * 32}], "key_id is not the public key's fingerprint"),
    ]:
        try:
            trust.load_trusted(_trusted_file(bad)); raise AssertionError("accepted: " + why)
        except trust.TrustedKeysError:
            pass


def test_committed_trusted_keys_file_is_valid():
    trust.load_trusted(HERE / "trusted-keys.json")


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                failed += 1; print("FAIL", name, "->", repr(e)[:300])
    sys.exit(1 if failed else 0)
