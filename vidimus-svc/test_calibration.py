"""Tests for empirical confidence calibration and its use in /attest.

Plain asserts, runnable with `python vidimus-svc/test_calibration.py` (CI) or pytest.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ.setdefault("VIDIMUS_KEYS_DIR", tempfile.mkdtemp(prefix="vidimus-keys-"))

import calibration as cal  # noqa: E402

REPO = HERE.parent
EVAL = REPO / "eval"


def approx(a, b, tol=1e-3):
    return abs(a - b) <= tol


def test_wilson_known_values():
    lo, hi = cal.wilson_interval(5, 10)
    assert approx(lo, 0.2366) and approx(hi, 0.7634), (lo, hi)
    lo, hi = cal.wilson_interval(0, 10)
    assert approx(lo, 0.0) and approx(hi, 0.2775), (lo, hi)
    lo, hi = cal.wilson_interval(10, 10)
    assert approx(lo, 0.7225) and approx(hi, 1.0), (lo, hi)
    assert cal.wilson_interval(0, 0) is None


def test_raw_confidence():
    assert approx(cal.raw_confidence(0.9, 0.8, True), 0.85)
    assert approx(cal.raw_confidence(0.9, 0.8, False), 0.425)


def _synthetic():
    # 12 items; the pipeline is 100% sure (0.99) but only 6/10 right, and
    # 2 items sit alone in a low tranche.
    gold = {"requirements": [{"id": f"R{i}", "human_verdict": "gap", "human_validated": True} for i in range(12)]}
    items = []
    for i in range(10):
        items.append({"id": f"R{i}", "pred_verdict": "gap" if i < 6 else "conformant",
                      "assessor_confidence": 0.99, "verifier_confidence": 0.99, "verifier_agrees": True})
    items.append({"id": "R10", "pred_verdict": "gap", "assessor_confidence": 0.2,
                  "verifier_confidence": 0.5, "verifier_agrees": True})
    items.append({"id": "R11", "pred_verdict": "insufficient", "error": "boom",
                  "assessor_confidence": 0, "verifier_confidence": 0, "verifier_agrees": False})
    run = {"config": {"model": "m-1"}, "items": items}
    return gold, [run]


def test_build_calibration_synthetic():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    assert c["model"] == "m-1"
    assert c["n_reference"] == 11 and c["n_items"] == 12 and c["n_errored_excluded"] == 1
    top = c["tranches"][-1]
    assert top["n"] == 10 and top["n_correct"] == 6 and approx(top["accuracy"], 0.6)
    assert top["calibrated"] is True
    lo, hi = cal.wilson_interval(6, 10)
    assert approx(top["ci_low"], lo) and approx(top["ci_high"], hi)
    low = [t for t in c["tranches"] if t["n"] == 1][0]
    assert low["calibrated"] is False  # n < 10
    assert sum(t["n"] for t in c["tranches"]) == 11
    # ECE = sum n_b/N * |acc_b - mean_conf_b|
    expected = (10 * abs(0.6 - 0.99) + 1 * abs(1.0 - 0.35)) / 11
    assert approx(c["ece"], expected, 1e-3), (c["ece"], expected)


def test_errored_items_never_counted():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    assert all(t["n"] == 0 or t["mean_confidence"] > 0 for t in c["tranches"])


def test_lookup_boundaries():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    assert cal.lookup(c, 1.0)["calibrated"] is True  # last tranche is closed at 1.0
    assert cal.lookup(c, 0.0)["lo"] == 0.0
    assert cal.lookup(c, 0.8)["lo"] == 0.8  # lower bound inclusive


def _client(cal_path):
    os.environ["VIDIMUS_CALIBRATION_FILE"] = str(cal_path)
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app), main


BODY = {
    "requirement": "The UE shall do X.", "verdict": "gap", "assessor_confidence": 0.99,
    "verifier_confidence": 0.99, "verifier_agrees": True, "citations": [{"display": "§5.3.3"}],
}


def _verify_signature(d, main):
    from vidimus.audit.keys import public_key_from_hex
    from vidimus.audit.signing import verify_hex
    assert verify_hex(public_key_from_hex(d["public_key"]), d["signature"], d["content_hash"].encode())


def test_attest_uses_empirical_tranche_and_signs_calibration_fields():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    p = Path(tempfile.mkdtemp()) / "calibration.json"
    p.write_text(json.dumps(c))
    client, main = _client(p)
    d = client.post("/attest", json=BODY).json()
    assert d["calibrated"] is True
    assert approx(d["calibrated_confidence"], 0.6)  # NOT 0.99: empirical accuracy of the tranche
    lo, hi = cal.wilson_interval(6, 10)
    assert approx(d["ci_low"], lo) and approx(d["ci_high"], hi)
    assert d["calibration_version"] == c["version"] and d["n_reference"] == c["n_reference"]
    assert approx(d["raw_confidence"], 0.99)
    _verify_signature(d, main)
    # The signed payload commits to the calibration fields: recompute the hash.
    import hashlib
    from vidimus.audit.canonical import canonicalize
    payload = main.signed_payload(BODY["requirement"], BODY["verdict"], d, BODY["citations"])
    assert hashlib.sha256(canonicalize(payload)).hexdigest() == d["content_hash"]
    for k in ("calibration_version", "n_reference", "calibrated"):
        assert k in payload


def test_small_tranche_is_not_calibrated_and_has_no_interval():
    gold, runs = _synthetic()
    p = Path(tempfile.mkdtemp()) / "calibration.json"
    p.write_text(json.dumps(cal.build_calibration(gold, runs)))
    client, main = _client(p)
    body = dict(BODY, assessor_confidence=0.2, verifier_confidence=0.5)  # raw 0.35: tranche n=1
    d = client.post("/attest", json=body).json()
    assert d["calibrated"] is False
    assert d["calibrated_confidence"] is None and d["ci_low"] is None and d["ci_high"] is None
    assert approx(d["raw_confidence"], 0.35)
    _verify_signature(d, main)


def test_missing_calibration_file_is_uncalibrated():
    client, main = _client(Path(tempfile.mkdtemp()) / "nope.json")
    d = client.post("/attest", json=BODY).json()
    assert d["calibrated"] is False and d["calibrated_confidence"] is None
    assert d["calibration_version"] == "none" and d["n_reference"] == 0
    _verify_signature(d, main)


def test_committed_calibration_matches_eval_inputs():
    """eval/calibration.json must be reproducible from the committed eval inputs."""
    committed = json.loads((EVAL / "calibration.json").read_text())
    gold = json.loads((EVAL / "gold-set.json").read_text())
    runs = [json.loads((EVAL / f"results-run{i}.json").read_text()) for i in (1, 2)]
    rebuilt = cal.build_calibration(gold, runs)
    assert committed["version"] == rebuilt["version"]
    assert committed["tranches"] == rebuilt["tranches"]
    assert committed["n_reference"] == rebuilt["n_reference"] and committed["model"] == rebuilt["model"]
    assert committed["generated_at"]


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("FAIL", name, "->", repr(e))
    sys.exit(1 if failed else 0)
