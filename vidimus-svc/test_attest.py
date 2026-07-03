"""Smoke test for the /attest endpoint.

Verifies the service returns HTTP 200 and a valid Ed25519 signature produced
via the real vidimus primitives. Exits non-zero on any failure so CI shows red.

Run: pip install -r vidimus-svc/requirements.txt httpx && python vidimus-svc/test_attest.py
"""
import os
import sys
import tempfile
from pathlib import Path

# Ephemeral keys dir so the test never touches /data.
os.environ.setdefault("VIDIMUS_KEYS_DIR", tempfile.mkdtemp(prefix="vidimus-keys-"))
# Make `import main` work regardless of the current working directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402
from vidimus.audit.keys import public_key_from_hex  # noqa: E402
from vidimus.audit.signing import verify_hex  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)

resp = client.post(
    "/attest",
    json={
        "requirement": "On establishment failure, the UE shall initiate RRC re-establishment.",
        "verdict": "gap",
        "assessor_confidence": 0.9,
        "verifier_confidence": 0.8,
        "verifier_agrees": True,
        "citations": [{"display": "3GPP TS 38.331 v18.3.0 §5.3.3"}],
    },
)

assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
d = resp.json()
for field in ("calibrated_confidence", "ci_low", "ci_high", "content_hash", "signature", "public_key"):
    assert field in d, f"missing response field: {field}"

# Signature must verify under the returned public key (real vidimus primitives).
pk = public_key_from_hex(d["public_key"])
assert verify_hex(pk, d["signature"], d["content_hash"].encode()), "Ed25519 signature failed to verify"

# Tamper-evidence: a flipped hash must NOT verify under the same signature.
tampered = ("1" if d["content_hash"][0] == "0" else "0") + d["content_hash"][1:]
assert not verify_hex(pk, d["signature"], tampered.encode()), "tampered hash unexpectedly verified"

print(f"OK  /attest -> 200  calibrated={d['calibrated_confidence']}  Ed25519 signature verified")
