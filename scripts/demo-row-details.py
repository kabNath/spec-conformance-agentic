"""Show what is STORED for some rows of a run, and what can (and cannot) be recovered about the pre-guard assessment.

    python scripts/demo-row-details.py <runId> "<requirement substring>" ["<substring>" ...] [--api http://localhost:3000]

Stored per row: final verdict, review reason, verifier note/confidence, the citation, the verified excerpt (only when the
verbatim guard passed), the assessor's gapNote, and the attestation's raw confidence. NOT stored: the assessor's raw verdict
before the guards, its own confidence and its quote when a guard rejected it. The assessor confidence is therefore derived:
raw = mean(assessor, verifier) x (0.5 if the verifier disagrees).
"""
import json
import sys
import urllib.request


def main() -> None:
    run_id = sys.argv[1]
    api = sys.argv[sys.argv.index("--api") + 1] if "--api" in sys.argv else "http://localhost:3000"
    subs = [a for a in sys.argv[2:] if a != "--api" and not a.startswith("http")]
    rows = json.load(urllib.request.urlopen(f"{api}/api/runs/{run_id}", timeout=30))["requirements"]
    for sub in subs:
        r = next(x for x in rows if sub in x["requirement"])
        c = r["citations"][0] if r["citations"] else {}
        v, a = r["verifier"], r["attestation"]
        raw = a["rawConfidence"]
        assessor = (2 * raw - v["confidence"]) if v["agrees"] else (4 * raw - v["confidence"])
        print("=" * 100)
        print("requirement      :", r["requirement"])
        print("final verdict    :", r["verdict"], "| review:", r["review"])
        print("raw confidence   :", raw, "= mean(assessor, verifier) x", 1 if v["agrees"] else 0.5, f"=> derived assessor confidence ~ {assessor:.2f} (verifier confidence {v['confidence']})")
        print("citation         :", c.get("display"), "| clause title:", c.get("clauseTitle"))
        print("verified excerpt :", repr(c.get("excerpt")) if c.get("excerpt") else "NOT STORED (the verbatim guard rejected the quote, or no clause)")
        print("assessor gapNote :", repr(r.get("gapNote")))
        print("verifier         : agrees =", v["agrees"], "| note:", v["note"])
        print("attestation      : calibrated =", a["calibrated"], "| calibrated confidence =", a["calibratedConfidence"], "| tranche items =", a["trancheN"])
        print("NOT STORED       : the assessor's raw verdict before the guards; its quote if rejected; the guard decision details")


if __name__ == "__main__":
    main()
