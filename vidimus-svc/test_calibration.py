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
os.environ.setdefault("VIDIMUS_ALLOW_EPHEMERAL", "1")  # test keys dir starts empty

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
    """20 gold items; run 2 omits two items and has one system error.

    Top tranche (raw 0.99): items 0-11 right in both runs, 12-15 wrong in both,
    16-17 right in run 1 only -> 18 item-units, 13 correct-equivalents.
    Items 18-19: one prediction each in a low tranche (n = 2 items).
    """
    gold = {"requirements": [{"id": f"R{i:02d}", "human_verdict": "gap", "human_validated": True}
                             for i in range(20)]}

    def item(i, pred_ok, a=0.99, v=0.99):
        return {"id": f"R{i:02d}", "pred_verdict": "gap" if pred_ok else "conformant",
                "assessor_confidence": a, "verifier_confidence": v, "verifier_agrees": True}

    run1 = [item(i, i < 12 or i in (16, 17)) for i in range(18)]
    run1 += [item(18, True, 0.2, 0.5), item(19, False, 0.2, 0.5)]
    run2 = [item(i, i < 12) for i in range(18)]
    run2.append({"id": "R19", "pred_verdict": "insufficient", "error": "boom",
                 "assessor_confidence": 0, "verifier_confidence": 0, "verifier_agrees": False})
    return gold, [{"config": {"model": "m-1"}, "items": run1}, {"config": {"model": "m-1"}, "items": run2}]


def test_build_calibration_counts_items_not_predictions():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    assert c["model"] == "m-1"
    assert c["n_predictions"] == 38 and c["n_errored_excluded"] == 1
    assert c["n_reference"] == 20 and c["n_items"] == 20  # distinct scored items
    top = c["tranches"][-1]
    assert top["n"] == 18 and top["n_predictions"] == 36  # 18 items, not 36 samples
    assert approx(top["accuracy"], 13 / 18) and top["calibrated"] is True
    lo, hi = cal.wilson_interval(13, 18)  # item-level counts
    assert approx(top["ci_low"], lo) and approx(top["ci_high"], hi)
    low = c["tranches"][1]
    assert low["n"] == 2 and low["calibrated"] is False  # n < 10 items


def test_errored_items_never_counted():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    assert sum(t["n_predictions"] for t in c["tranches"]) == 38


def test_fold_assignment_keeps_both_runs_of_an_item_together():
    gold, runs = _synthetic()
    rows = cal.collect_rows(gold, runs)[0]
    cv = cal.cross_validate(rows, k=5)
    for fold in cv["folds"]:
        assert not set(fold["train_items"]) & set(fold["test_items"])
    seen = {}
    for f in cv["folds"]:
        for i in f["test_items"]:
            assert i not in seen  # each item is held out in exactly one fold
            seen[i] = f["fold"]
    assert set(seen) == {r["item"] for r in rows}
    assert all(seen[r["item"]] == cal.fold_of(r["item"], 5) for r in rows)


def test_cross_validated_prediction_uses_only_training_items():
    gold, runs = _synthetic()
    rows, *_ = cal.collect_rows(gold, runs)
    cv = cal.cross_validate(rows, k=5)
    by_fold = {f["fold"]: f for f in cv["folds"]}
    for o in cv["oof"]:
        train = set(by_fold[o["fold"]]["train_items"])
        tr = cal.tranche_table([r for r in rows if r["item"] in train])[cal._tranche_index(o["raw"])]
        expected = tr["accuracy"] if tr["calibrated"] else None
        assert (o["pred"] is None) == (expected is None)
        if expected is not None:
            assert approx(o["pred"], expected, 1e-9)


def test_cv_reports_coverage_and_routes_the_rest_to_review():
    gold, runs = _synthetic()
    c = cal.build_calibration(gold, runs)
    cv = c["cross_validation"]
    assert cv["k"] == 5 and cv["grouping"] == "item"
    assert cv["n_predictions"] == 38
    assert cv["n_covered"] + cv["n_routed_to_review"] == 38
    assert 0 <= cv["coverage"] <= 1 and approx(cv["coverage"], cv["n_covered"] / 38)
    # the two low-tranche items can never be calibrated -> always routed to review
    assert cv["n_routed_to_review"] >= 2
    assert 0 <= c["ece_raw"] <= 1
    assert cv["ece_calibrated"] is None or 0 <= cv["ece_calibrated"] <= 1


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
    assert approx(d["calibrated_confidence"], 13 / 18)  # NOT 0.99: empirical accuracy of the tranche
    lo, hi = cal.wilson_interval(13, 18)
    assert approx(d["ci_low"], lo) and approx(d["ci_high"], hi)
    assert d["calibration_version"] == c["version"] and d["n_reference"] == c["n_reference"] == 20
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
    body = dict(BODY, assessor_confidence=0.2, verifier_confidence=0.5)  # raw 0.35: tranche n=2 items
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
    assert committed["cross_validation"] == rebuilt["cross_validation"]
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
