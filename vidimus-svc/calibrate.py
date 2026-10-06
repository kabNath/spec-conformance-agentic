"""Build eval/calibration.json from the gold set and the eval runs.

    python vidimus-svc/calibrate.py            # from the repo root

Reads eval/gold-set.json, eval/results-run1.json, eval/results-run2.json and
prints the reliability table (accuracy per confidence tranche, Wilson 95%, ECE).
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import calibration as cal  # noqa: E402

EVAL = Path(__file__).resolve().parent.parent / "eval"
RUNS = ["results-run1.json", "results-run2.json"]


def main() -> int:
    paths = [EVAL / "gold-set.json", *(EVAL / r for r in RUNS)]
    gold = json.loads(paths[0].read_text())
    runs = [json.loads(p.read_text()) for p in paths[1:]]
    inputs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    c = cal.build_calibration(gold, runs, inputs)
    out = EVAL / "calibration.json"
    out.write_text(json.dumps(c, indent=2, ensure_ascii=False) + "\n")

    print(f"{c['version']}  model={c['model']}  n_reference={c['n_reference']} "
          f"({c['n_items']} items x {c['n_runs']} runs, {c['n_errored_excluded']} errored excluded)")
    print(f"ECE = {c['ece']:.3f}\n")
    print(f"{'tranche':>11} {'n':>4} {'mean conf':>10} {'accuracy':>9}  Wilson 95%       calibrated")
    for t in c["tranches"]:
        if t["n"]:
            print(f"[{t['lo']:.1f},{t['hi']:.1f}{']' if t['hi'] == 1.0 else ')'} {t['n']:>4} "
                  f"{t['mean_confidence']:>10.3f} {t['accuracy']:>9.3f}  "
                  f"[{t['ci_low']:.3f}, {t['ci_high']:.3f}]  {'yes' if t['calibrated'] else 'NO (n<%d)' % cal.MIN_N}")
        else:
            print(f"[{t['lo']:.1f},{t['hi']:.1f}) {0:>4}  (empty)")
    print(f"\nwritten: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
