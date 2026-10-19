# History rewrite — dry-run simulation (NOT executed)

Nothing was rewritten and nothing was pushed. This was computed in a **mirror clone of the repository** (`git clone --no-local --mirror`, kept outside the project), using only read-only git queries;
`git filter-repo` was **not** run, neither on the clone nor on the original. The original repository's HEAD and working tree were checked unchanged afterwards.

**Scenario simulated:** remove `eval/results-run1.json`, `eval/results-run2.json`, `examples/ts38331-extrait.txt` and its former root-level path `ts38331-extrait.txt` from every commit, and replace `eval/gold-set.json`
by a reviewed clean version in every commit that contains it (see `docs/spec-text-cleanup-plan.md`, option 2).

## Result
```
commits in all refs: 45; SHA would change: 45; unchanged: 0

paths and the commits that touch them (introduce/modify/delete):
  eval/results-run1.json: 29973e2 (2026-07-08), 6c6c6b6 (2026-10-06)
  eval/results-run2.json: 29973e2 (2026-07-08), 6c6c6b6 (2026-10-06)
  examples/ts38331-extrait.txt: c2c8261 (2026-07-03), 6c6c6b6 (2026-10-06)
  ts38331-extrait.txt: 28f79b2 (2026-07-03), c2c8261 (2026-07-03)
  eval/gold-set.json: d3e638f (2026-07-08), 6c6c6b6 (2026-10-06)

refs:
  feat/phase1: tip bd74c52 -> REWRITTEN
  fix/audit-trust: tip 9f10e76 -> REWRITTEN
  main: tip 6be9042 -> REWRITTEN
  origin: tip 6be9042 -> REWRITTEN
  origin/main: tip 6be9042 -> REWRITTEN

first rewritten commit: 28f79b2 2026-07-03 Initial commit — 3GPP/O-RAN conformance agent
```

**Every one of the 45 commits would get a new SHA**, because the very first commit (`28f79b2`, 2026-07-03) already contains `ts38331-extrait.txt` at the repository root, and every later commit descends from it.
Consequences:
- All references to commit hashes break: the pre-registration commit `ad3175f1…` (see `docs/preregistration.md`, which is why its SHA-256 and signature were recorded), the `89f7b52`/`6be9042` mentions in commit messages and docs, the remote `main` (`6be9042`).
- The remote has only `main`; `fix/audit-trust` and `feat/phase1` have never been pushed and would be pushed as new branches after the rewrite.
- Anyone who cloned or forked the public repository keeps the old history until they re-clone; GitHub may keep old objects reachable by SHA.

## Safety copy
A bundle of the whole current repository (all branches, history up to `bd74c52`) was created **outside the repository**:
`../backups/spec-conformance-agentic-before-rewrite-20261006.bundle` (3,057,636 bytes, `git bundle verify`: complete history),
SHA-256 `2835e695090552b5ee099ea9e9a8d2d0398e17edbc0161b0fa7e2f0472a38db4`.
It contains the spec text that the rewrite is meant to remove: keep it private (it is not under version control and must not be pushed).

## Commit table (old SHA, date, outcome, subject)
```
old sha | date | rewritten? why | subject
  28f79b2 | 2026-07-03 | YES: tree contains ts38331-extrait.txt | Initial commit — 3GPP/O-RAN conformance agent
  5ba12d5 | 2026-07-03 | YES: tree contains ts38331-extrait.txt | ci: make deploy workflow manual-only (workflow_dispatch)
  a09112a | 2026-07-03 | YES: tree contains ts38331-extrait.txt | docs: tidy README title + note vectorless-first retrieval
  6a079fc | 2026-07-03 | YES: tree contains ts38331-extrait.txt | docs: add demo GIF to README
  dab52e6 | 2026-07-03 | YES: tree contains ts38331-extrait.txt | docs: name the retrieval approach explicitly in README
  d3d3bd8 | 2026-07-03 | YES: tree contains ts38331-extrait.txt | vidimus-svc: use the real vidimus library, not an inline reimplementation
  5a2f156 | 2026-07-03 | YES: tree contains ts38331-extrait.txt | chore: gitignore Python caches and local .mov recordings
  5ec0999 | 2026-07-03 | YES: tree contains ts38331-extrait.txt | ci: add parallel Python job testing the vidimus-svc /attest endpoint
  4c379bf | 2026-07-03 | YES: tree contains ts38331-extrait.txt | fix: make next build work without runtime env (green CI)
  c2c8261 | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | docs: rework README (problem statement, neutral voice, CI badge, examples/)
  75adf61 | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | docs: add Apache-2.0 license badge next to the CI badge
  9de068f | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | Fix formatting and punctuation in README.md
  526a518 | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | Update Vidimus description for clarity
  657d638 | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | Update Next.js description format in README
  ace1985 | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | Update README.md
  d1d22da | 2026-07-03 | YES: tree contains examples/ts38331-extrait.txt | parser: harden 3GPP clause parsing for real .docx→text specs
  d3e638f | 2026-07-08 | YES: tree contains examples/ts38331-extrait.txt, eval/gold-set.json | Add 40-item expert-validated 3GPP conformance benchmark
  deb282d | 2026-07-08 | YES: tree contains examples/ts38331-extrait.txt, eval/gold-set.json | Fix extractJSON: return first balanced JSON object, not first-to-last-brace
  29973e2 | 2026-07-08 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | Add gold-set evaluation harness, two authoritative runs, and EVAL.md
  6be9042 | 2026-07-08 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | Report coverage with committed accuracy; name silent-error rate; README eval sec
  9f10e76 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | vidimus-svc: empirical tranche calibration (Wilson 95%, ECE) replaces 2-sample b
  f389a29 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | calibration: item-level units, item-grouped 5-fold CV, ECE raw vs cross-validate
  c228fbf | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | ci(vidimus-svc): install vidimus from the branch matching the current one (fallb
  3fc7a5a | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | citation guards: verbatim excerpt check, grounded gap rule, other-family verifie
  a351971 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | eval v2 harness: --ids-file/--out, frozen subset, committed-accuracy regression 
  b5e48cf | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | sidecar image: install git, pin vidimus to public commit fc4e4ab, build-time imp
  80b3989 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | sidecar: persistent signing key (named volume, env PEM, refuse-to-start), /pubke
  00868aa | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | citations: relevance-selected 4000-char window instead of first 500 chars (R06/R
  7d9d588 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | regression gate: count committed errors (baseline worst run + 1) instead of accu
  89f7b52 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | env.example: OPENROUTER_VERIFIER_MODEL, CITATION_WINDOW_CHARS
  e1087f6 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | eval: per-call generation ids, real provider/cost via OpenRouter /generation, ve
  ad3175f | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | GAP_GUARD=verifier|lexical: two fixed verifier questions (same subject / contrad
  272c1e2 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | eval: v1/v2 comparison script (accuracy, committed accuracy, coverage, silent er
  9c1220c | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | eval: sanitised v2 results (no spec text, SHA-256 of quotes), spec-text checker 
  e92aa29 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | eval scripts accept sanitised results (system_error flag)
  827a9b2 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | regression baseline: v2 (gap guard) runs on the frozen subset — worst run 1 comm
  72b7aec | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | calibration: recalibrate on the two v2 runs (item-grouped 5-fold CV), cal-102be0
  8348930 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | EVAL v2: results v1 vs v2 with Wilson intervals, pre-registered criteria (ad3175
  e1f3d5d | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | EVAL: guard ablation by offline replay (none / verbatim / gap / both), 10 fresh 
  f5f7186 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | ablation calls file: cost is unknown, not zero
  e560d72 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | scripts: per-file/per-field audit of spec-text spans in tracked files (counts an
  f5c70d3 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | docs: plan (not executed) to remove spec text from files and history, with exact
  0de2649 | 2026-10-06 | YES: tree contains eval/results-run1.json, eval/results-run2.json, examples/ts38331-extrait.txt, eval/gold-set.json | citation guard: citation_too_short (exact quote under the 4-word minimum) vs cit
  6c6c6b6 | 2026-10-06 | YES: tree contains examples/ts38331-extrait.txt, eval/gold-set.json | spec text cleanup, step 1 (history untouched): sanitised v1 results replace raw 
  bd74c52 | 2026-10-06 | YES: tree contains examples/ts38331-extrait.txt, eval/gold-set.json | docs: signed integrity record of the gap-guard pre-registration (SHA-256 + Ed255
```
