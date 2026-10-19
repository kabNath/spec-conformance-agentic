"""Build eval/calibration.json from the gold set and the eval runs.

    python vidimus-svc/calibrate.py                                  # v2 runs (default)
    python vidimus-svc/calibrate.py --runs results-run1.public.json results-run2.public.json --out calibration-v1-runs.json

Reads eval/gold-set.json and the given runs (default: the sanitised v2 results, which are the committed ones)
and prints the reliability table (accuracy per confidence tranche, Wilson 95%, ECE).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import calibration as cal  # noqa: E402

EVAL = Path(__file__).resolve().parent.parent / "eval"
RUNS = ["results-v2-gapguard-1.public.json", "results-v2-gapguard-2.public.json"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", default=RUNS, help="result files inside eval/")
    ap.add_argument("--out", default="calibration.json", help="output file inside eval/")
    args = ap.parse_args()
    paths = [EVAL / "gold-set.json", *(EVAL / r for r in args.runs)]
    gold = json.loads(paths[0].read_text())
    runs = [json.loads(p.read_text()) for p in paths[1:]]
    inputs = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    c = cal.build_calibration(gold, runs, inputs)
    out = EVAL / args.out
    out.write_text(json.dumps(c, indent=2, ensure_ascii=False) + "\n")

    cv = c["cross_validation"]
    print(f"{c['version']}  model={c['model']}  n_reference={c['n_reference']} items "
          f"({c['n_predictions']} predictions over {c['n_runs']} runs, "
          f"{c['n_errored_excluded']} errored excluded)")
    print(f"ECE raw confidence      = {c['ece_raw']:.3f}")
    ece_cv = cv["ece_calibrated"]
    print(f"ECE calibrated ({cv['k']}-fold CV by item) = {'n/a' if ece_cv is None else f'{ece_cv:.3f}'}"
          f"  coverage {cv['coverage']:.1%}  ({cv['n_routed_to_review']}/{cv['n_predictions']} "
          f"predictions routed to human review)\n")
    print(f"{'tranche':>11} {'items':>5} {'mean conf':>10} {'accuracy':>9}  Wilson 95%       calibrated")
    for t in c["tranches"]:
        if t["n"]:
            print(f"[{t['lo']:.1f},{t['hi']:.1f}{']' if t['hi'] == 1.0 else ')'} {t['n']:>5} "
                  f"{t['mean_confidence']:>10.3f} {t['accuracy']:>9.3f}  "
                  f"[{t['ci_low']:.3f}, {t['ci_high']:.3f}]  {'yes' if t['calibrated'] else 'NO (n<%d)' % cal.MIN_N}")
        else:
            print(f"[{t['lo']:.1f},{t['hi']:.1f}) {0:>5}  (empty)")
    print(f"\nwritten: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
