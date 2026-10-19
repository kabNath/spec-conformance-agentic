"""Compare the requirements extracted for a demo run with the sentences of demo/implementation-lcp.txt.

    python scripts/audit-demo-extraction.py <runId> [--api http://localhost:3000]     (reads the stored run; no LLM call)

For every extracted requirement: its source sentence (the extractor records the numbered item in `source.section`),
a classification, and a check that its content words come from that sentence. Then the totals.
Classes: split (a simple requirement cut out of a compound source sentence), duplicate, invented (not supported by the
source sentence), and, per source sentence, fragments that no extracted requirement covers (omitted).
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOP = set("the a an of to in on for and or with that is are was were be been shall will would may from it its by as at this these those when after before only".split())


def words(s: str) -> set[str]:
    return {re.sub(r"(ing|ed|es|s)$", "", w) or w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2 and w not in STOP}


def source_items() -> dict[str, str]:
    text = (ROOT / "demo" / "implementation-lcp.txt").read_text()
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"^(\d+)\.\s+(.*)$", text, re.M)}


def fragments(sentence: str) -> list[str]:
    """Atomic fragments of a compound sentence: split on commas and ' and ' (keeps the leading condition with each)."""
    cond = re.match(r"^(When [^,]+),\s*", sentence)
    body = sentence[cond.end():] if cond else sentence
    parts = [p.strip() for p in re.split(r",\s*|\s+and\s+(?=(?:sends|stores|enters|starts|applies|sends))", body) if p.strip()]
    return parts


def main() -> None:
    run_id = sys.argv[1]
    api = sys.argv[sys.argv.index("--api") + 1] if "--api" in sys.argv else "http://localhost:3000"
    data = json.load(urllib.request.urlopen(f"{api}/api/runs/{run_id}", timeout=30))
    reqs = data["requirements"]
    src = source_items()
    rows, per_item = [], {k: [] for k in src}
    count = {}
    for r in reqs:
        count[str(r["source"].get("section"))] = count.get(str(r["source"].get("section")), 0) + 1
    for i, r in enumerate(reqs, 1):
        sec = str(r["source"].get("section"))
        s = src.get(sec, "")
        rw, sw = words(r["requirement"]), words(s)
        support = len(rw & sw) / max(1, len(rw))
        dup = next((j for j in range(1, i) if len(words(reqs[j - 1]["requirement"]) & rw) / max(1, len(rw | words(reqs[j - 1]["requirement"]))) > 0.8), None)
        cls = "duplicate of #%d" % dup if dup else ("invented" if support < 0.6 else "split of a compound sentence" if count[sec] > 1 else "1:1 restatement (tense normalised to 'shall')")
        per_item.setdefault(sec, []).append((i, rw))
        rows.append((i, r["requirement"], sec, s, cls, support))
    for i, req, sec, s, cls, support in rows:
        print(f"#{i:<2} source item {sec} | {cls} (content-word support {support:.0%})\n    extracted: {req}\n    source   : {s}")
    omitted = []
    for sec, s in src.items():
        covered = set().union(*[rw for _, rw in per_item.get(sec, [])]) if per_item.get(sec) else set()
        for f in fragments(s):
            fw = words(f)
            if fw and len(fw & covered) / len(fw) < 0.6:
                omitted.append((sec, f))
    inv = sum(1 for r in rows if r[4] == "invented")
    dups = sum(1 for r in rows if r[4].startswith("duplicate"))
    print(f"\nTOTAL: {len(src)} source sentences -> {len(reqs)} extracted requirements; invented: {inv}; duplicates: {dups}; omitted fragments: {len(omitted)}")
    for sec, f in omitted:
        print(f"   omitted (item {sec}): {f}")
    for sec in src:
        print(f"   item {sec}: {len(per_item.get(sec, []))} requirement(s)")


if __name__ == "__main__":
    main()
