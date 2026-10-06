"""The demo attestation trio must keep behaving as documented: valid → accepted, tampered → refused, wrong key → refused when pinned.

Plain asserts; run with `python vidimus-svc/test_verdict_files.py` (needs the `vidimus` package, no network).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import verify_verdict as vv  # noqa: E402

DEMO = HERE.parent / "demo"


def load(n):
    return json.loads((DEMO / f"attestation-{n}.json").read_text())


def fp():
    return load("valid")["attestation"]["key_id"]


def test_valid_is_accepted_pinned_and_unpinned():
    assert vv.check(load("valid"), [fp()])[0]
    ok, _, warnings = vv.check(load("valid"), None)
    assert ok and any("not pinned" in w for w in warnings)


def test_tampered_is_refused_even_when_pinned():
    for pins in (None, [fp()]):
        ok, issues, _ = vv.check(load("tampered"), pins)
        assert not ok and any("content hash" in i for i in issues)
    a, b = load("valid"), load("tampered")
    assert a["attestation"] == b["attestation"] and a["requirement"] != b["requirement"]
    assert sum(x != y for x, y in zip(a["requirement"], b["requirement"], strict=True)) == 1  # exactly one character differs


def test_wrong_key_is_refused_when_pinned_and_flagged_when_not():
    ok, issues, _ = vv.check(load("wrong-key"), [fp()])
    assert not ok and any("not in trusted" in i for i in issues)
    ok, _, warnings = vv.check(load("wrong-key"), None)
    assert ok and any("not pinned" in w for w in warnings)  # integrity only: this is exactly why pinning matters


def test_other_edits_are_detected():
    for field, value in (("verdict", "conformant"), ("citations", ["3GPP Other v1 §9"])):
        doc = load("valid"); doc[field] = value
        assert not vv.check(doc, [fp()])[0], field
    doc = load("valid"); doc["attestation"]["calibrated_confidence"] = 0.99
    assert not vv.check(doc, [fp()])[0]


def test_demo_files_contain_no_spec_text_markers():
    # invented text only: the demo requirement is about the fictional LCP
    assert "LCP Demo" in " ".join(load("valid")["citations"])


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                failed += 1; print("FAIL", name, "->", repr(e)[:300])
    sys.exit(1 if failed else 0)
