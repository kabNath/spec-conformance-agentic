"""Empirical confidence calibration for the conformance pipeline.

LLM self-reported confidence is not a probability. This module measures, on a
human-validated gold set, how often the pipeline's verdict was actually right
for each band ("tranche") of its raw confidence, and reports that observed
accuracy with a Wilson 95% interval. The sidecar then answers with the
observed accuracy of the tranche instead of the raw number.

Used by `calibrate.py` (offline, builds eval/calibration.json) and `main.py`
(online lookup), so training and serving share one definition of "raw confidence".
"""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "vidimus-svc.calibration.v1"
# Fixed, equal-width tranches (not tuned on the data). Last one is closed at 1.0.
TRANCHE_EDGES = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
# Below this many reference predictions a tranche's accuracy is not reported as calibrated.
MIN_N = 10
Z95 = 1.959963984540054

CAVEATS = [
    "Reference set is small (40 gold items, one model); tranche estimates are coarse.",
    "Both runs score the same 40 items, so predictions are not independent: the Wilson "
    "intervals treat them as independent and are therefore optimistic (too narrow).",
    "Valid only for the model named here on this corpus (TS 38.331 v19.3.0 extract); "
    "re-run calibrate.py after any model, prompt or retrieval change.",
    "Intervals capture sampling noise only, not systematic error shared by the LLM judges.",
]


def raw_confidence(assessor: float, verifier: float, verifier_agrees: bool) -> float:
    """Single raw score from the two judge signals (mean, halved on disagreement)."""
    raw = (assessor + verifier) / 2
    return raw if verifier_agrees else raw * 0.5


def wilson_interval(k: int, n: int, z: float = Z95):
    """Wilson score interval for k successes out of n; None if n == 0."""
    if n <= 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _tranche_index(raw: float) -> int:
    raw = min(max(raw, 0.0), 1.0)
    for i in range(len(TRANCHE_EDGES) - 1):
        if raw < TRANCHE_EDGES[i + 1]:
            return i
    return len(TRANCHE_EDGES) - 2  # raw == 1.0 belongs to the last (closed) tranche


def build_calibration(gold: dict, runs: list[dict], inputs: dict | None = None) -> dict:
    """Compute the reliability table from the gold set and the eval runs."""
    ref = {}
    for r in gold["requirements"]:
        if not r.get("human_validated"):
            raise ValueError(f"gold item {r.get('id')} is not human_validated")
        ref[r["id"]] = r["human_verdict"]
    models = {run["config"]["model"] for run in runs}
    if len(models) != 1:
        raise ValueError(f"runs use different models: {sorted(models)}")

    k = len(TRANCHE_EDGES) - 1
    n = [0] * k
    correct = [0] * k
    conf_sum = [0.0] * k
    errored = 0
    for run in runs:
        for it in run["items"]:
            if it.get("error") or it["id"] not in ref:
                errored += 1  # system error: no real verdict or confidence to calibrate
                continue
            raw = raw_confidence(it["assessor_confidence"], it["verifier_confidence"], it["verifier_agrees"])
            i = _tranche_index(raw)
            n[i] += 1
            conf_sum[i] += raw
            correct[i] += int(it["pred_verdict"] == ref[it["id"]])

    total = sum(n)
    tranches = []
    ece = 0.0
    for i in range(k):
        t = {"lo": TRANCHE_EDGES[i], "hi": TRANCHE_EDGES[i + 1], "n": n[i], "n_correct": correct[i],
             "mean_confidence": None, "accuracy": None, "ci_low": None, "ci_high": None,
             "calibrated": n[i] >= MIN_N}
        if n[i]:
            acc = correct[i] / n[i]
            mean_conf = conf_sum[i] / n[i]
            lo, hi = wilson_interval(correct[i], n[i])
            t.update(mean_confidence=round(mean_conf, 4), accuracy=round(acc, 4),
                     ci_low=round(lo, 4), ci_high=round(hi, 4))
            ece += n[i] / total * abs(acc - mean_conf)
        tranches.append(t)

    body = {"model": models.pop(), "n_reference": total, "min_n": MIN_N, "tranches": tranches}
    version = "cal-" + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]
    return {
        "schema": SCHEMA,
        "version": version,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": body["model"],
        "target": "verdict_correct: pred_verdict == human_verdict (gold-set.json)",
        "raw_confidence": "mean(assessor_confidence, verifier_confidence), x0.5 if the verifier disagrees",
        "min_n_per_tranche": MIN_N,
        "interval": "Wilson score, 95%",
        "n_reference": total,
        "n_items": len(ref),
        "n_runs": len(runs),
        "n_errored_excluded": errored,
        "ece": round(ece, 4),
        "tranches": tranches,
        "inputs": inputs or {},
        "caveats": CAVEATS,
    }


def load_calibration(path) -> dict | None:
    """Load a calibration file; None if absent or unreadable (=> uncalibrated)."""
    try:
        c = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None
    return c if c.get("schema") == SCHEMA else None


def lookup(calibration: dict, raw: float) -> dict:
    """Return the tranche that contains ``raw``."""
    return calibration["tranches"][_tranche_index(raw)]
