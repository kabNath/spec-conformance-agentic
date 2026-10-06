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

SCHEMA = "vidimus-svc.calibration.v2"
# Fixed, equal-width tranches (not tuned on the data). Last one is closed at 1.0.
TRANCHE_EDGES = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
# Below this many reference predictions a tranche's accuracy is not reported as calibrated.
MIN_N = 10  # distinct items (not predictions) per tranche
CV_FOLDS = 5
Z95 = 1.959963984540054

CAVEATS = [
    "Reference set is small (40 gold items, one model); tranche estimates are coarse.",
    "Both runs score the same items, so predictions are not independent. Counts, the n >= 10 "
    "rule and the Wilson intervals therefore use one unit per (item, tranche) -- an item that "
    "was right in one run and wrong in the other counts as 0.5 -- instead of one per prediction.",
    "Wilson intervals on fractional counts are an approximation, and tranche membership is "
    "itself estimated from the same data: treat them as indicative.",
    "Calibration quality (ECE) is measured by 5-fold cross-validation grouped by item; "
    "predictions whose tranche has < 10 training items are not calibrated and go to human review.",
    "Valid only for the model named here on this corpus (TS 38.331 v19.3.0 extract); "
    "re-run calibrate.py after any model, prompt or retrieval change.",
    "Intervals capture sampling noise only, not systematic error shared by the LLM judges.",
]


def raw_confidence(assessor: float, verifier: float, verifier_agrees: bool) -> float:
    """Single raw score from the two judge signals (mean, halved on disagreement)."""
    raw = (assessor + verifier) / 2
    return raw if verifier_agrees else raw * 0.5


def wilson_interval(k: float, n: int, z: float = Z95):
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


def fold_of(item_id: str, k: int = CV_FOLDS) -> int:
    """Deterministic fold of an item: all of its predictions share it."""
    return int(hashlib.sha256(item_id.encode()).hexdigest()[:8], 16) % k


def collect_rows(gold: dict, runs: list[dict]):
    """Flatten the runs into ``[{item, raw, correct}]``; returns ``(rows, errored, model)``."""
    ref = {}
    for r in gold["requirements"]:
        if not r.get("human_validated"):
            raise ValueError(f"gold item {r.get('id')} is not human_validated")
        ref[r["id"]] = r["human_verdict"]
    models = {run["config"]["model"] for run in runs}
    if len(models) != 1:
        raise ValueError(f"runs use different models: {sorted(models)}")
    rows, errored = [], 0
    for run in runs:
        for it in run["items"]:
            if it.get("error") or it["id"] not in ref:
                errored += 1  # system error: no real verdict or confidence to calibrate
                continue
            rows.append({
                "item": it["id"],
                "raw": raw_confidence(it["assessor_confidence"], it["verifier_confidence"],
                                      it["verifier_agrees"]),
                "correct": it["pred_verdict"] == ref[it["id"]],
            })
    return rows, errored, models.pop(), len(ref)


def tranche_table(rows: list[dict]) -> list[dict]:
    """Per-tranche reliability table with ONE unit per (item, tranche).

    ``n`` is the number of distinct items, ``k`` the number of correct items
    (an item with 1 of 2 predictions right counts 0.5), so repeated runs of
    the same item do not inflate the sample size.
    """
    k = len(TRANCHE_EDGES) - 1
    units: list[dict[str, list[bool]]] = [{} for _ in range(k)]
    conf_sum, n_pred = [0.0] * k, [0] * k
    for r in rows:
        i = _tranche_index(r["raw"])
        units[i].setdefault(r["item"], []).append(r["correct"])
        conf_sum[i] += r["raw"]
        n_pred[i] += 1
    out = []
    for i in range(k):
        n = len(units[i])
        kk = sum(sum(v) / len(v) for v in units[i].values())
        t = {"lo": TRANCHE_EDGES[i], "hi": TRANCHE_EDGES[i + 1], "n": n, "n_predictions": n_pred[i],
             "n_correct": round(kk, 4), "mean_confidence": None, "accuracy": None,
             "ci_low": None, "ci_high": None, "calibrated": n >= MIN_N}
        if n:
            lo, hi = wilson_interval(kk, n)
            t.update(mean_confidence=round(conf_sum[i] / n_pred[i], 4), accuracy=round(kk / n, 4),
                     ci_low=round(lo, 4), ci_high=round(hi, 4))
        out.append(t)
    return out


def _ece(pairs: list[tuple[int, float, bool]]) -> float | None:
    """Expected calibration error from ``(tranche, predicted, correct)``, weighted by prediction."""
    if not pairs:
        return None
    total = len(pairs)
    ece = 0.0
    for b in {p[0] for p in pairs}:
        grp = [p for p in pairs if p[0] == b]
        ece += len(grp) / total * abs(sum(p[1] for p in grp) / len(grp) - sum(p[2] for p in grp) / len(grp))
    return ece


def cross_validate(rows: list[dict], k: int = CV_FOLDS) -> dict:
    """K-fold cross-validation grouped by item.

    For each fold the tranche table is fitted on the other folds only and the
    held-out predictions receive that table's accuracy (``pred``) -- or ``None``
    if their tranche has < MIN_N training items (those go to human review).
    """
    folds, oof = [], []
    for f in range(k):
        test = [r for r in rows if fold_of(r["item"], k) == f]
        if not test:
            continue
        train = [r for r in rows if fold_of(r["item"], k) != f]
        table = tranche_table(train)
        folds.append({"fold": f, "train_items": sorted({r["item"] for r in train}),
                      "test_items": sorted({r["item"] for r in test})})
        for r in test:
            t = table[_tranche_index(r["raw"])]
            oof.append({"fold": f, "item": r["item"], "raw": r["raw"], "correct": r["correct"],
                        "pred": t["accuracy"] if t["calibrated"] else None})
    covered = [o for o in oof if o["pred"] is not None]
    ece_cal = _ece([(_tranche_index(o["raw"]), o["pred"], o["correct"]) for o in covered])
    return {
        "k": k, "grouping": "item", "folds": folds, "oof": oof,
        "n_predictions": len(oof), "n_covered": len(covered),
        "n_routed_to_review": len(oof) - len(covered),
        "coverage": round(len(covered) / len(oof), 4) if oof else 0.0,
        "ece_calibrated": None if ece_cal is None else round(ece_cal, 4),
        "accuracy_covered": round(sum(o["correct"] for o in covered) / len(covered), 4) if covered else None,
    }


def build_calibration(gold: dict, runs: list[dict], inputs: dict | None = None) -> dict:
    """Compute the reliability table, its cross-validated quality and its provenance."""
    rows, errored, model, n_gold = collect_rows(gold, runs)
    tranches = tranche_table(rows)
    cv = cross_validate(rows)
    cv_public = {key: v for key, v in cv.items() if key not in ("folds", "oof")}
    ece_raw = _ece([(_tranche_index(r["raw"]), r["raw"], r["correct"]) for r in rows])
    n_items = len({r["item"] for r in rows})

    body = {"model": model, "n_reference": n_items, "min_n": MIN_N, "tranches": tranches}
    version = "cal-" + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]
    return {
        "schema": SCHEMA,
        "version": version,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": model,
        "target": "verdict_correct: pred_verdict == human_verdict (gold-set.json)",
        "raw_confidence": "mean(assessor_confidence, verifier_confidence), x0.5 if the verifier disagrees",
        "min_n_per_tranche": MIN_N,
        "min_n_unit": "distinct items",
        "interval": "Wilson score, 95%, one unit per (item, tranche)",
        "n_reference": n_items,
        "n_items": n_items,
        "n_gold_items": n_gold,
        "n_predictions": len(rows),
        "n_runs": len(runs),
        "n_errored_excluded": errored,
        "ece_raw": round(ece_raw, 4) if ece_raw is not None else None,
        "cross_validation": cv_public,
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
