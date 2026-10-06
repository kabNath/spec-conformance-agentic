# Plan: remove 3GPP specification text from the repository (NOT executed)

Status: **proposal only.** Nothing below has been run; no tracked spec-bearing file has been modified.
Audit tool: `scripts/audit-spec-text.ts` (counts and lengths only, never prints the text). A "span" is ≥ 9 consecutive words that also occur in the local spec extract.

## What contains spec text (tracked files)

| file | field(s) | items concerned | longest copied run | on public `main`? (remote `kabNath/spec-conformance-agentic`, public, only `main` = `6be9042`) |
|---|---|---|---|---|
| `eval/gold-set.json` | `requirement` | R02 R08 R33 R40 | 12 words | yes (commit `d3e638f`) |
| | `justification` | R07 | 14 words | yes |
| `eval/results-run1.json` | `requirement` | R02 R08 R33 R40 | 12 | yes (`29973e2`) |
| | `gap_note` | R01 R02 R08 R12 R16 R25 R26 R34 R38 (9/38) | 23 | yes |
| | `verifier_note` | R01 R02 R12 R16 R25 R27 R35 (7/40) | 24 | yes |
| `eval/results-run2.json` | `requirement` | R02 R08 R33 R40 | 12 | yes |
| | `gap_note` | R01 R08 R12 R16 R25 R34 (6/37) | 23 | yes |
| | `verifier_note` | R01 R02 R12 R16 R25 R27 R35 (7/40) | 18 | yes |
| `examples/ts38331-extrait.txt` | whole file (1.5 KB excerpt; also existed at the repo root before being moved) | – | 11 | yes (`c2c8261`) |
| `scripts/test-citation-check.ts` | test fixture (clause text) | – | 12 | **no** (local branches only, `3fc7a5a`) |
| `scripts/test-gap-check.ts` | test fixture (clause text) | – | 26 | **no** (local only, `ad3175f`) |

The last two are fixtures written during this work; they were described as "paraphrased" but still reproduce real sentences. Everything else in the 108 tracked text files is clean
(including every file produced by the v2 evaluation).

## Proposed replacements

1. **`eval/results-run1.json`, `-run2.json`** → replace by sanitised files (`node` script already in the repo):
   `npx tsx scripts/sanitize-results.ts eval/results-run1.json eval/results-run1.public.json` (same for run 2). This drops `requirement`, `gap_note`, `verifier_note`; keeps ids, verdicts, clauses, flags, confidences.
   Then `git rm eval/results-run1.json eval/results-run2.json`, and point `scripts/eval-compare.ts` defaults, `eval/baseline-frozen.json` provenance and `calibration-v1-runs.json` inputs at the `.public.json` names (the calibration table is
   reproducible from them: `python vidimus-svc/calibrate.py --runs results-run1.public.json results-run2.public.json --out calibration-v1-runs.json`).
2. **`eval/gold-set.json`**:
   - `justification` of R07 (not an evaluation input): paraphrase it.
   - `requirement` of R02, R08, R33, R40 *are the model inputs* of the benchmark. Decision needed: (a) keep them (≤ 12 words of the spec per item, short normative sentences used as test inputs);
     (b) paraphrase them — this changes the inputs of 4 of 40 items, so the human-validation protocol applies (re-validate the reference verdict) and v1/v2 numbers are no longer comparable on those items.
   I recommend (a) for `requirement` and paraphrase only `justification`; nothing automatic is safe here.
3. **`examples/ts38331-extrait.txt`**: replace by an invented extract with the same layout (clause numbers, `1>` bullets, NOTE paragraphs) — it only serves as a format example for the parser.
4. **The two test fixtures**: rewrite with invented clause text (same structure: `The UE shall:`, `1>` bullets, `NOTE n:` paragraphs, a ≥ 4-word header). They are not on the remote, so a normal commit suffices, no history rewrite.
5. Add a CI step running `scripts/check-no-spec-text.ts` is not possible in public CI (the corpus is not redistributable); run it locally before pushing (`git ls-files -z | xargs -0 npx tsx scripts/audit-spec-text.ts`).

## Two ways to clean the public history (choose one)

**Option 1 — no rewrite.** Remove/replace the files in a new commit. The old text stays reachable in history (≤ 24 consecutive words of a specification per field). Cheap; no SHA changes.

**Option 2 — rewrite with `git filter-repo`.** Removes the text from every commit. **Side effect: every commit after the first modified one gets a new SHA, including the pre-registration commit `ad3175f1…`
cited in EVAL.md** — its value as a timestamped proof would be lost. Before rewriting: (1) record the old SHA and the committer date in EVAL.md; (2) `git bundle create prereg-before-rewrite.bundle --all` and keep it; (3) optionally sign/tag.

Procedure (run by you, in a COPY of the repository, after the replacement files above exist as a commit on top of `feat/phase1`):

```
cp -R spec-conformance-agentic /tmp/sca-rewrite && cd /tmp/sca-rewrite
pip install git-filter-repo
git filter-repo --force \
  --invert-paths --path eval/results-run1.json --path eval/results-run2.json \
                 --path examples/ts38331-extrait.txt --path ts38331-extrait.txt
```
`filter-repo` must run before the replacement files are re-added (they are new commits on top; re-apply them after, e.g. `git checkout <old-branch> -- <new files>` from a backup, or run the
`--invert-paths` pass on the pre-replacement history and cherry-pick the replacement commit afterwards).

For `eval/gold-set.json` (history version contains the spans) use a file-info callback that swaps the blob for the reviewed paraphrased file `/tmp/gold-set.clean.json`:

```
git filter-repo --force --file-info-callback '
if filename == b"eval/gold-set.json":
    return (filename, mode, value.insert_file_with_contents(open("/tmp/gold-set.clean.json","rb").read()))
return (filename, mode, blob_id)
'
```
Verify, then publish:

```
git log -p --all > /tmp/all.patch && npx tsx scripts/check-no-spec-text.ts /tmp/all.patch
git remote add origin https://github.com/kabNath/spec-conformance-agentic.git
git push --force-with-lease origin main
```
After the push: every clone and fork must re-clone; GitHub keeps old commits reachable by SHA, in forks, in `refs/pull/*` and in its caches — ask GitHub Support to purge cached views/objects if that matters to you.
The local branches `fix/audit-trust` and `feat/phase1` have never been pushed; after the rewrite push them as new branches.
