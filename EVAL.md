# Evaluation — Spec Conformance Agent

**Version:** v1 · **Date:** 2026-07-08 · **Harness:** [`scripts/eval.ts`](scripts/eval.ts) · **Gold set:** [`eval/gold-set.json`](eval/gold-set.json)

This document describes how the conformance pipeline is evaluated, the gold set it
is measured against, and the results. It is versioned: each re-run bumps the version
and records the model, corpus, and date so numbers are comparable over time.

## What is being measured

The product takes a 3GPP requirement and returns a **verdict** — `conformant`,
`gap`, or `insufficient` (insufficient evidence) — together with the **governing
clause** it cites. The evaluation answers two questions directly:

1. **Verdict quality** — how often does the pipeline reach the same verdict a human
   expert assigned? (precision / recall / F1 per class, confusion matrix)
2. **Clause grounding** — when a clause governs the requirement, does the pipeline
   cite it? When nothing in the spec governs it, does the pipeline correctly abstain
   (cite nothing)?

A third, safety-oriented question is reported alongside: when the pipeline is wrong,
does it **flag the item for human review** rather than assert a wrong verdict
silently?

## Corpus

- **Spec:** 3GPP **TS 38.331 v19.3.0 (Rel-19)** — NR RRC protocol specification
  (source file `38331-j30.docx`; the letter `j` denotes Rel-19).
- **Extract used:** clause groups **5.2** (system information), **5.3** (connection
  control), **5.5** (measurements), and **5.6** (UE capabilities) — **266 clauses**.
- The extract is parsed by [`lib/parser-3gpp.ts`](lib/parser-3gpp.ts) into a clause
  tree (CHILD + XREF edges), loaded into Neo4j (graph-walk substrate) and Qdrant
  (vector fallback) by [`scripts/ingest.ts`](scripts/ingest.ts).

> **The spec text is not redistributed** (© 3GPP / ETSI). `examples/ts38331-extract.txt`
> and `examples/ts38331-source.txt` are git-ignored. See *Reproducing* below to rebuild
> the corpus from your own copy of the specification.

## Gold set

[`eval/gold-set.json`](eval/gold-set.json) contains **40 implementation requirements**,
each an atomic, individually testable statement written against the corpus above.

Each entry carries:

| field | meaning |
|---|---|
| `requirement` | the atomic requirement text (the pipeline's input) |
| `governing_clause` | the clause a human expert judges to govern it (`null` = out of scope) |
| `proposed_verdict` | the verdict the model proposed when the gold set was drafted |
| `human_verdict` | **the reference verdict used for scoring** — set by a human |
| `human_validated` | `true` once a human has reviewed and locked the entry |
| `difficulty` | `easy` / `medium` / `hard` — labelled by hand |

### Human-in-the-loop protocol

The reference verdicts are **human-validated, not model-generated.** The gold set was
drafted in four batches; each batch was presented to a human reviewer who confirmed or
corrected every verdict before it was locked (`human_validated: true`,
`human_verdict` set). The harness **refuses to run** if any entry is still unvalidated.
This is the crux of the evaluation's credibility: the pipeline is scored against human
judgement, and the same model is never both examinee and examiner.

### Composition

- **Verdict mix (reference):** 17 conformant · 16 gap · 7 insufficient
- **Difficulty:** 10 easy · 18 medium · 12 hard
- **Clause coverage:** 5.2.2.x, 5.3.2/3/4/5/6/7/8/10/11/13, 5.5.4/5.5.5, 5.6.1.x
- **Adversarial items by design:** role-reversal traps (UE vs. network initiation —
  R07, R26, R37), NOTE-based escape hatches locked out of the requirement text
  (R39 vs. 5.6.1.4 NOTE 3; R40 vs. NOTE 3a), and out-of-scope distractors (screen
  dimming, Wi-Fi preference, audit logging) that must resolve to `insufficient`.

## Pipeline configuration

| parameter | value |
|---|---|
| Model | `anthropic/claude-sonnet-4.6` (temperature 0) via OpenRouter |
| Embeddings | `openai/text-embedding-3-small` (Qdrant fallback only) |
| Retrieval | vectorless Neo4j graph-walk, `MAX_HOPS=4`, `MAX_RESEEDS=2`; Qdrant re-seed on stall |
| Review threshold | 0.75 (below ⇒ routed to human review) |

The `extract` node (which mines requirements from an implementation document) is
**bypassed**: gold requirements are already atomic, so each is fed straight into
`retrieve → assess → verify`. This isolates the measurement to retrieval + judgement
and removes requirement-extraction as a confound.

## Metrics

- **Verdict accuracy** — fraction where the pipeline's verdict equals `human_verdict`.
- **Per-class precision / recall / F1** and a 3×3 **confusion matrix** (gold × predicted).
- **Macro-F1** (unweighted mean over classes) and **weighted-F1** (by support).
- **Clause retrieval** — scored on two explicit criteria over items with a governing clause:
  - **Exact match (strict, primary):** the cited clause id equals the gold clause id.
    This is *the* clause-accuracy number.
  - **Adjacent match (secondary, counted separately — neither full success nor full
    failure):** the cited clause is not exact but lies in the gold clause's **neighbourhood**
    — a hierarchical ancestor/descendant, **or a clause on the gold clause's
    cross-reference chain** (an XREF target of the gold clause, or a descendant of one).
    Example: gold §5.3.3.2 explicitly refers to §5.3.14 (unified access control), so a
    citation of §5.3.14.1 / §5.3.14.5 is *adjacent* — a defensible neighbouring clause, not
    the exact governing one. Everything else with a citation is `wrong_clause`.

  Over out-of-scope items (no governing clause): `correct_abstain` (cited nothing) vs.
  `spurious_citation` (attached a clause where none governs).
- **Needs-review safety** — of the wrong verdicts, how many were flagged for review
  (**caught**) vs. asserted silently (**silent errors**), plus the over-flag rate.
- **Cost** — real OpenRouter call count and token usage (metered in
  `lib/clients/openrouter.ts::llmStats`), priced at the model's list rate.

### Caveat: clause accuracy is stricter than verdict accuracy

The gold set records **one** governing clause per requirement, but a 3GPP requirement
is often reachable through more than one defensible clause (e.g. §5.3.3.2 *invokes*
§5.3.14 for unified access control). The pipeline can therefore reach the **correct
verdict** while citing a **different but valid** clause. The **adjacent-match** criterion
above exists precisely to surface these cases separately rather than scoring them as flat
failures. Even so, exact-match accuracy is a **lower bound** on grounding quality; the
confusion matrix is the primary measure of product correctness.

## Reproducing

```bash
docker compose up -d                       # neo4j + qdrant + postgres + vidimus
cp .env.example .env.local                 # fill OPENROUTER_API_KEY, NEO4J_*, QDRANT_*

# 1) Rebuild the corpus from YOUR copy of TS 38.331 v19.3.0 (38331-j30.docx),
#    then ingest clause groups 5.2 / 5.3 / 5.5 / 5.6 (266 clauses):
npm run ingest -- <orgId> ts38331 "TS 38.331" 19.3.0 Rel-19 examples/ts38331-extract.txt

# 2) Sanity-check the harness and see the cost estimate (no LLM calls):
tsx --env-file=.env.local scripts/eval.ts --estimate
tsx --env-file=.env.local scripts/eval.ts --dry-run    # first 3 items, real calls

# 3) Full evaluation → writes eval/results.json:
tsx --env-file=.env.local scripts/eval.ts

# 4) Rebuild the confidence calibration from the gold set + the two runs
#    (copy results.json to eval/results-run1.json / results-run2.json first):
python vidimus-svc/calibrate.py        # writes eval/calibration.json
```

Measured cost of the full 40-item run: **$0.52** at the Sonnet 4.6 list rate (see Results).

## Results

<!-- RESULTS:BEGIN -->
**Run:** run 1 of 2 · **Model:** `anthropic/claude-sonnet-4.6` (temp 0) · **Cost:** $0.52
(269 LLM calls, 112.6k input + 12.3k output tokens) · **Wall-clock:** ~11 min ·
Raw data: [`eval/results-run1.json`](eval/results-run1.json).

### Headline

| framing | accuracy | note |
|---|--:|---|
| **Primary (N=40)** | **27/40 = 67.5%** | 2 items (R21, R31) failed as **system errors** — counted as failures, held **out** of the confusion matrix (they produced no verdict) |
| Secondary (N=38) | 27/38 = 71.1% | over the 38 verdict-producing items; macro-F1 **0.666**, weighted-F1 **0.744** |

Both system-error items are out-of-scope `insufficient` cases (see *Failure analysis*).
All per-class, confusion, and stage metrics below are computed over the **38
verdict-producing items**, since a system error yields no verdict to place in a cell.

### Two-stage decomposition (retrieval, then verdict | retrieval)

The pipeline first **retrieves** a governing clause, then **judges** against it.
Separating the two shows where the error actually lives.

| stage | metric | value |
|---|---|--:|
| **1 — retrieval** | **exact clause match** (strict; of 34 in-scope items) | 23/34 = **67.6%** |
| | + **adjacent** (XREF chain / hierarchical kin — counted separately) | 2 more → 25/34 = 73.5% |
| | wrong clause / no citation | 2 / 7 |
| | correct abstention (of 4 out-of-scope items that produced a verdict) | 2/4 = 50.0% |
| | **retrieval correct overall** (exact-or-adjacent clause, or correct abstention) | 27/38 = **71.1%** |
| **2 — verdict \| retrieval** | verdict accuracy **given correct retrieval** | 25/27 = **92.6%** |
| | verdict accuracy **given wrong retrieval** | 2/11 = **18.2%** |

**Reading:** judgement is strong (**92.6%**) *when the right or an adjacent clause is in
hand*; almost all end-to-end error is **retrieval** failing to surface a usable clause
(verdict accuracy collapses to 18.2% when retrieval is wrong). This is the single most
important result — it says the reasoning layer is not the bottleneck, retrieval is.

### Two verdict sets: raw vs. review-gated

A `needs_review` flag is an **abstention**, not an asserted verdict. Gating trades
coverage for precision — the product's safety knob.

| | value |
|---|--:|
| Raw accuracy (ungated) | 27/38 = 71.1% |
| Coverage (committed, not flagged) | 24/38 = **63.2%** |
| **Committed accuracy** (trust when it answers) | 21/24 = **87.5%** |
| Abstentions | 14 — **8 suppressed a wrong verdict** (good), 6 withheld a correct one (cost) |
| **Silent errors** (wrong AND committed — the dangerous class) | **3/40 = 7.5%** (R06, R10, R17) |

The committed profile is **87.5% accuracy at 63% coverage** — the two numbers are
inseparable: gating lifts precision from 71.1% → 87.5% *only because* it declines to answer
on 37% of items (the other 14 go to review). Reading either figure without the other is
meaningless. Of the wrong verdicts, gating catches 8 of 11; the remaining **silent error
rate is 3/40 = 7.5%** (R06, R10, R17). Two are safe under-calls into `insufficient`; the
one genuinely dangerous case is **R10** — a false `gap`.

**R10 as the safety case study.** It is a *complete failure of the net*: the assessor
committed the wrong `gap` at confidence **0.95**, and the independent adversarial verifier
**agreed** (0.92), so neither the confidence gate nor the verifier gate fired. Both judges
read a spurious citation (§5.3.5.3, attached to an out-of-scope audit-logging requirement)
and rationalised the same verdict. Redundant LLM judges do not help when they share the
same wrong premise. The mitigation is not another judge but a **grounding check** — verify
the cited clause is topically on-subject before a `gap` is allowed to commit; this is
identified future work (see *Threats to validity*).

### Confusion matrix (N=38, rows = human reference, cols = predicted)

| gold ↓ / pred → | conformant | gap | insufficient | support |
|---|--:|--:|--:|--:|
| **conformant** | 15 | 0 | 2 | 17 |
| **gap** | 0 | 8 | 8 | 16 |
| **insufficient** | 0 | 1 | 4 | 5 |

| class | precision | recall | F1 | n |
|---|--:|--:|--:|--:|
| conformant | 100.0% | 88.2% | 0.938 | 17 |
| gap | 88.9% | 50.0% | 0.640 | 16 |
| insufficient | 28.6% | 80.0% | 0.421 | 5 |

### Breakdown by difficulty and by verdict class

| difficulty | N=40 (errors as fail) | N=38 (verdict-producing) |
|---|--:|--:|
| easy | 7/10 = 70.0% | 7/8 = 87.5% |
| medium | 14/18 = 77.8% | 14/18 = 77.8% |
| hard | 6/12 = 50.0% | 6/12 = 50.0% |

| gold class | accuracy (N=38) |
|---|--:|
| conformant | 15/17 = 88.2% |
| gap | 8/16 = 50.0% |
| insufficient | 4/5 = 80.0% |

Difficulty tracks correctness monotonically (easy → hard: 87.5% → 77.8% → 50%), which is
what a well-labelled gold set should show. `gap` is the weakest class — see below.

### The conservative bias (a system property, not a bug to hide)

The dominant error mode is **`gap` → `insufficient`: 8 of 16 gaps** (recall 50%) were
called *insufficient evidence* rather than *non-conformant*. The mechanism is direct:
when retrieval fails to surface the governing clause, `assess` receives no citation and
returns `insufficient` by construction, and the item is flagged `no_clause_found`.

This is a **deliberate, safe failure direction.** Faced with weak or missing evidence the
system says *"I don't have the clause to judge this"* and routes to a human, rather than
asserting a confident `gap` it cannot ground. The cost is `gap` **recall**; the benefit
is that `gap` **precision stays high (88.9%)** and almost no wrong `gap` is asserted — the
one exception, R10, is dissected below. For a conformance tool whose verdicts carry
liability, under-claiming into review is the right direction to be wrong in.

### Failure analysis

Every mismatch, grouped by mechanism (clause text is **paraphrased** below; see the cited
clauses in TS 38.331 for the normative wording):

**A. Retrieval miss → `insufficient`, flagged for review** (7 items: R09, R13, R19, R33,
R37, R39, R40). The graph-walk never reached the governing clause, so no citation was
produced. E.g. **R09** (gold `gap`, §5.3.5.1): the navigator looped on §5.3.5.3 for its
whole hop budget and never crossed to §5.3.5.1; assessor confidence 0.2, flagged
`no_clause_found`. All seven were **caught by gating** — costly for recall, safe in effect.

**B. Wrong / spurious clause → committed silent error** (R17, R10). **R17** (gold `gap`,
§5.5.4.1): retrieval landed on §5.5.2.2 (measurement-identity *removal*) instead of the
report-triggering clause; the assessor then *correctly* judged that the cited clause does
not address the requirement and returned `insufficient` — a right call about the wrong
clause. Committed (conf 0.85, verifier agreed).

**C. Citation-window truncation → `insufficient`** (R06, R08). The correct clause was
retrieved, but the citation carries only a 500-character text window, which clipped the
relevant sentence. **R06** (gold `conformant`, §5.3.3.3): the `establishmentCause` logic
fell outside the window, so the assessor could not confirm it and returned `insufficient`
(committed, conf 0.85). **R08** (same mechanism) was **caught** — its truncation drove
confidence to 0.55, below the 0.75 threshold, so gating flagged it. This points at a
concrete, non-LLM fix: widen or re-center the citation window.

**D. Focus — R10, the one dangerous false positive.**

| field | value |
|---|---|
| Requirement | *"The UE persists every received RRCReconfiguration to local storage for 30 days for audit purposes."* |
| Human reference | `insufficient` — audit logging/retention is out of scope of TS 38.331 |
| Prediction | **`gap`**, citing **§5.3.5.3** |
| Assessor confidence | **0.95** |
| Verifier | **agreed** (confidence 0.92) |
| Review gating | **not flagged — committed** |

R10 is the worst-case path: a confident, verifier-endorsed, **committed** wrong verdict.
The mechanism is a **spurious citation** — retrieval attached §5.3.5.3 (RRCReconfiguration
reception) to an out-of-scope requirement. Notably, the assessor's own reasoning was
*sound*: its note states the clause "contains no requirement to persist messages for 30
days." It correctly saw the spec does not mandate this — but coded that as `gap`
(implementation does something unmandated) instead of `insufficient` (out of RRC scope).
The verifier, reading the same clause, made the same taxonomy slip and agreed, so gating
never triggered. **Takeaway:** the `gap` vs. `insufficient` boundary for *out-of-scope*
requirements is the sharpest weakness — a spurious but plausible citation (here §5.3.5.3)
is enough to turn an abstention into an asserted non-conformance. This was the **only
committed false `gap`** in the run; every other error was a safe under-call into
`insufficient` or a caught abstention.

**E. System errors (R21, R31).** Both failed identically: the retrieval navigator returned
**multiple JSON objects / prose** instead of one JSON value, which `extractJSON`
(slice from first `{` to last `}`) reduces to `{…}\n{…}` — invalid, so `JSON.parse` throws
("non-whitespace after JSON at position 44") and the item errors out after all retries
(temperature 0 makes the failure deterministic). The finding worth stating plainly: **both
failing items are out-of-scope `insufficient` requirements** (screen dimming; gzip debug
logs). The failure mode correlates with the **abstention case** — when no clause is
relevant, the navigator is likeliest to ramble out of the JSON contract. This is the
hardest case for the system, and it fails there hardest. **Run 2 nuances this finding:** a
third item, R26 (an *in-scope* `gap`, network-initiated paging), also hit this error in the
second run, so the failure mode is **stochastic and not exclusive to out-of-scope items** —
see *Run-to-run stability*.

**Fix (committed after run 2 in `deb282d`, to keep the two authoritative runs identical):**
`extractJSON` now returns the **first complete, balanced JSON object** rather than a
first-brace-to-last-brace slice. This resolves the R21/R26/R31 failure mode; a future eval
version (v2) will re-run on the patched extractor and fold these items back into the
confusion matrix. See the *Changelog*.

### Cost

$0.52 for the full 40-item run (269 LLM calls, 112.6k input + 12.3k output tokens) at the
Sonnet 4.6 list rate ($3 / $15 per 1M). ~$0.013 per requirement. Qdrant-fallback
embeddings are billed separately and negligible.
<!-- RESULTS:END -->

## Run-to-run stability

Temperature is 0, but LLM output is **not bit-stable**: the same requirement can retrieve a
different clause or reach a different verdict across identical runs. To measure this, the
full 40-item evaluation was executed **twice, with no code changes between runs** (run 1 →
[`eval/results-run1.json`](eval/results-run1.json), run 2 →
[`eval/results-run2.json`](eval/results-run2.json)).

<!-- STABILITY:BEGIN -->
| framing | run 1 | run 2 |
|---|--:|--:|
| Primary accuracy (N=40) | 27/40 = 67.5% | 25/40 = 62.5% |
| Secondary accuracy (verdict-producing) | 27/38 = 71.1% | 25/37 = 67.6% |
| System errors | 2 (R21, R31) | 3 (R21, R31, **R26**) |
| Exact clause match | 23/34 = 67.6% | 22/33 = 66.7% |

**Agreement between the two runs**

| measure | value |
|---|--:|
| Verdict agreement (ERROR treated as its own state, over all 40) | **38/40 = 95.0%** |
| Verdict agreement over items scored in *both* runs | 36/37 = **97.3%** |
| Cited-clause agreement (items that cited a clause in both runs) | 27/28 = **96.4%** |

Only **two items flipped** across the identical runs — and in **both, review-gating absorbed
the wrong side of the flip**, so neither became a committed wrong verdict:

| item | gold | run 1 | run 2 | did gating catch the wrong side? |
|---|---|---|---|---|
| **R02** | conformant | `conformant` (committed, cited §5.3.14.1) | `insufficient` (**flagged → abstained**, cited §5.3.14.5) | **yes** — run 2's wrong verdict was routed to review, not asserted |
| **R26** | gap | `gap` (committed, cited §5.3.2.2) | **system error** | **yes** — a system error produces no verdict; it is flagged, not asserted |

**R02 shows the flip lives in the retrieval stage, not just the verdict.** Across the two
runs the navigator landed on two *different* sub-clauses of §5.3.14 — §5.3.14.1 then
§5.3.14.5 (both **adjacent** to the gold §5.3.3.2, which cross-references §5.3.14; neither
is the exact governing clause). The differing clause *text* is what then drove the verdict
from `conformant` to `insufficient`. Retrieval non-determinism propagates into verdict
non-determinism — which is why the two-stage decomposition above matters.

**R26 shows the system-error mode is itself non-deterministic:** the same in-scope `gap`
requirement (network-initiated paging, §5.3.2.2) succeeded in run 1 and threw the
multi-object-JSON error in run 2. So the failure mode is not exclusive to out-of-scope
items — it is a general fragility of the navigator's JSON contract that surfaces
stochastically.

**Conclusion.** At temperature 0 the pipeline is **~95–97% verdict-stable** run-to-run, and
the residual non-determinism is concentrated in exactly the places the two-stage analysis
flagged as weak (adjacent-clause retrieval; the navigator's JSON contract on hard cases).
Non-determinism at temperature 0 is a **known limitation**; **review-gating is the
mitigation** — in this experiment it caught the wrong side of *both* flips, so run-to-run
variance did not produce a single committed wrong verdict that the other run got right.
The forthcoming `extractJSON` fix removes the R26/R21/R31 error class outright.
<!-- STABILITY:END -->

## Confidence calibration

> *Superseded for the sidecar by the recalculation on the v2 runs (see "Confidence calibration — recomputed on the v2 runs" below). The text and table in this section describe the calibration built from the v1 runs, kept as `eval/calibration-v1-runs.json`.*

**Raw LLM confidence is not calibrated.** The assessor and verifier report numbers like 0.95
that are not probabilities of being right — R10 above was a wrong `gap` asserted at 0.95 and
endorsed by the verifier at 0.92. The sidecar therefore no longer reports a "confidence" derived
from the model's own numbers (the previous version bootstrapped over just two values, which has
no statistical meaning). It reports the **observed accuracy** of the confidence band the
prediction falls in, measured on this gold set.

- **Script:** [`vidimus-svc/calibrate.py`](vidimus-svc/calibrate.py) (logic in
  [`vidimus-svc/calibration.py`](vidimus-svc/calibration.py)) reads
  [`eval/gold-set.json`](eval/gold-set.json), [`eval/results-run1.json`](eval/results-run1.json)
  and [`eval/results-run2.json`](eval/results-run2.json) and writes
  [`eval/calibration.json`](eval/calibration.json) (date, model, n per tranche, input hashes).
  Re-run it after any model, prompt or retrieval change: `python vidimus-svc/calibrate.py`.
- **Raw confidence** = mean(assessor, verifier), halved if the verifier disagrees.
  **Target** = verdict equals the human reference.
- **Tranches:** five fixed equal-width bands of raw confidence (not tuned on the data).
- **Reference size:** **38 distinct items** with a scored prediction (40 gold items; R21 and R31 failed
  as system errors in both runs), i.e. **75 predictions** over two runs (R26 also errored in run 2).
  The two runs score the *same* items, so predictions are **not independent**. Counting every
  prediction would double the apparent sample size; the table therefore uses **one unit per
  (item, tranche)**: an item right in one run and wrong in the other counts 0.5. `n`, the `n ≥ 10` rule
  and the Wilson intervals are all in items.
- **Interval:** Wilson 95 % per tranche on those item units. **Minimum n = 10 items**: below it the
  sidecar answers `calibrated: false` with `calibrated_confidence`, `ci_low`, `ci_high` all `null`.
- **Cross-validation:** 5-fold, **grouped by item** (both runs of an item always fall in the same fold;
  fold = SHA-256(id) mod 5). For each fold the table is fitted on the other four and applied to the
  held-out predictions, so the quality figure is never measured on the data that fitted it.

| raw confidence | items (n) | predictions | mean raw | observed accuracy | Wilson 95 % | calibrated |
|---|--:|--:|--:|--:|---|---|
| [0.0, 0.2) | 0 | 0 | — | — | — | no |
| [0.2, 0.4) | 9 | 18 | 0.350 | 22.2 % | 6.3 – 54.7 % | no (n < 10) |
| [0.4, 0.6) | 3 | 6 | 0.480 | 100 % | 43.9 – 100 % | no (n < 10) |
| [0.6, 0.8) | 3 | 5 | 0.721 | 33.3 % | 6.1 – 79.2 % | no (n < 10) |
| [0.8, 1.0] | 24 | 46 | 0.954 | 87.5 % | 69.0 – 95.7 % | **yes** |

**Result (v1.2, replaces the v1.1 figures, which counted the same items twice):**

- **Raw confidence ECE = 0.145** (no fitting involved, so no leakage): the model says ~0.95 on average
  in the top tranche and is right 87.5 % of the time (plausibly 69–96 % at the item level). The old
  v1.1 interval for that tranche, [74.3, 93.9] %, was too narrow.
- **Cross-validated ECE of the calibrated confidence = 0.023, at 61.3 % coverage.** Read both together:
  only the top tranche has enough items, so this number says that the top-tranche accuracy is stable
  across folds. It says nothing about the other tranches.
- **Only one tranche of five is calibrated.** The other 29 of 75 predictions (38.7 %) fall in tranches
  with fewer than 10 items. For them the sidecar returns `calibrated: false` with no number and no
  interval, and the pipeline **routes the item to human review** (`low_confidence`), keeping the raw
  value for display only. This is deliberate: with n < 10 an interval would be fiction. The cost is
  that low-confidence items always need a human; it grows the review queue, it does not hide errors.

The sidecar loads `calibration.json` and returns, per request: `calibrated`, `calibrated_confidence`
(= accuracy of the tranche), `ci_low` / `ci_high` (= its Wilson interval), `raw_confidence`, and the
provenance `calibration_version` and `n_reference`. These, plus `tranche_n`, are part of the
**signed payload**, so a signature commits to the calibration it was computed with. If the
tranche is not calibrated, the pipeline keeps the raw number for display only and sends the item
to human review (`low_confidence`).

**Limits — read before relying on these numbers:**

- **38 items, one model** (`anthropic/claude-sonnet-4.6`). The table is valid for that model on
  this corpus; any other model or prompt needs its own calibration run.
- Item units remove the double counting but not all dependence (an item can sit in two tranches), and
  Wilson on fractional counts is an approximation: treat the interval as indicative.
- Four of the five tranches are unusable (n < 10; one is empty); the 100 % in [0.4, 0.6) is 3 items,
  not evidence of high accuracy there.
- Calibration corrects the *scale* of confidence. It cannot detect errors shared by both LLM
  judges (R10), and it says nothing about items unlike the gold set.
- **Review gating changed meaning:** the 0.75 threshold now applies to the empirical tranche accuracy
  (0.87 in the top tranche), not to the raw number. The v1 results above were produced with the
  old confidence and are reported as run; re-running the evaluation will give different gating figures.

## v2 — citation guards, verifier-confirmed gaps (**measured**, 2026-10-06)

Two complete passes over the 40 gold items with `GAP_GUARD=verifier`. Everything below is computed from the committed, sanitised result
files [`eval/results-v2-gapguard-1.public.json`](eval/results-v2-gapguard-1.public.json) and
[`-2`](eval/results-v2-gapguard-2.public.json) by [`scripts/eval-compare.ts`](scripts/eval-compare.ts) and
[`scripts/eval-gap-report.ts`](scripts/eval-gap-report.ts). **The v1 sections above are unchanged**; v1 figures quoted here are
recomputed from `eval/results-run1.json` / `-run2.json` with the same code (they reproduce the v1 numbers: 27/40, 24/38 committed, 3 silent errors).

**Setup.** Assessor `anthropic/claude-sonnet-4.6`, temperature 0 (unchanged); verifier `google/gemini-3.8-flash`, temperature 0, pinned with
`{"only":["google-vertex"],"allow_fallbacks":false,"data_collection":"deny"}` (every resolved verifier call reports provider "Google");
pre-registration [`eval/PREREGISTRATION-gap-guard.md`](eval/PREREGISTRATION-gap-guard.md) committed at **`ad3175f1ffef683855172fdde73093373483004e`**
before the first paid call of this evaluation. Cost: 0.5518 USD + 0.5684 USD (OpenRouter generation records; one record unresolved).
The raw result files contain specification text and model prose, so they are **not** committed (git-ignored); the committed `.public.json`
files keep ids, verdicts, clause ids, flags, reason codes, confidences and SHA-256 of the quotes (checked for ≥ 9 consecutive spec words by
[`scripts/check-no-spec-text.ts`](scripts/check-no-spec-text.ts)).

**v2 is a bundle of changes, not a single one** (no ablation was run, so no difference below can be attributed to one of them):
(1) the assessor prompt asks for a verbatim `quote`; (2) the citation window is the 4000 characters of the clause most relevant to the requirement
(v1: first 500 characters); (3) deterministic verbatim check of the quote; (4) `gap` verdicts are confirmed by two fixed questions put to the verifier
(same subject? contradiction?), with NOTEs and bullet-extended passage; (5) the adversarial verifier is now Gemini instead of the assessor's own model;
(6) the `extractJSON` fix that was committed after the v1 runs is included.

### Headline, v1 vs v2

95 % Wilson intervals are per run (n = 40 or fewer), so wide; the two runs score the same items, so they are not independent samples. "Mean" is the
mean of the two point estimates. Retrieval here uses the harness definition (exact, family or correct abstention); the v1 text above reports 27/38 because
it also counted clauses on the gold clause's cross-reference chain, which the harness does not.

| metric (95 % Wilson interval per run) | v1 run 1 | v1 run 2 | v1 mean | v2 run 1 | v2 run 2 | v2 mean |
|---|---|---|---|---|---|---|
| Accuracy, N=40 (system errors count as failures) | 27/40 = 67.5 % [52–80] | 25/40 = 62.5 % [47–76] | 65.0 % | 26/40 = 65.0 % [50–78] | 27/40 = 67.5 % [52–80] | 66.3 % |
| Accuracy over verdict-producing items | 27/38 = 71.1 % [55–83] | 25/37 = 67.6 % [51–80] | 69.3 % | 26/40 = 65.0 % [50–78] | 27/40 = 67.5 % [52–80] | 66.3 % |
| Coverage (committed / scored) | 24/38 = 63.2 % [47–77] | 22/37 = 59.5 % [43–74] | 61.3 % | 22/40 = 55.0 % [40–69] | 23/40 = 57.5 % [42–71] | 56.3 % |
| Committed accuracy | 21/24 = 87.5 % [69–96] | 19/22 = 86.4 % [67–95] | 86.9 % | 21/22 = 95.5 % [78–99] | 22/23 = 95.7 % [79–99] | 95.6 % |
| Silent errors (committed and wrong), count | 3 | 3 | 3.0 | 1 | 1 | 1.0 |
| Items sent to human review | 14 | 15 | 14.5 | 18 | 17 | 17.5 |
| System errors | 2 | 3 | 2.5 | 0 | 0 | 0.0 |
| Retrieval correct (clause found or correct abstention) | 26/38 = 68.4 % [53–81] | 25/37 = 67.6 % [51–80] | — | 24/40 = 60.0 % [45–74] | 25/40 = 62.5 % [47–76] | — |
| Verdict accuracy given retrieval correct | 24/26 = 92.3 % [76–98] | 23/25 = 92.0 % [75–98] | — | 19/24 = 79.2 % [60–91] | 20/25 = 80.0 % [61–91] | — |
| Verdict accuracy given retrieval wrong | 3/12 = 25.0 % [9–53] | 2/12 = 16.7 % [5–45] | — | 7/16 = 43.8 % [23–67] | 7/15 = 46.7 % [25–70] | — |


Silent errors (committed and wrong), by run:
  v1 run 1: R06 (conformant→insufficient), R10 (insufficient→gap), R17 (gap→insufficient)
  v1 run 2: R06 (conformant→insufficient), R10 (insufficient→gap), R17 (gap→insufficient)
  v2 run 1: R25 (gap→insufficient)
  v2 run 2: R11 (conformant→insufficient)

What the table says, without spin:
- **Verdict accuracy did not improve** (N=40 mean 66.3 % vs 65.0 % — the intervals overlap almost entirely).
- **Committed accuracy is higher** (95.6 % vs 86.9 % mean; per run 21/22 [78–99] and 22/23 [79–99] vs 21/24 [69–96] and 19/22 [67–95]; the intervals overlap), with
  **1 silent error per run instead of 3**; **coverage is lower** (56.3 % vs 61.3 %: more items go to human review, 17.5 vs 14.5 on average).
- **System errors: 0 in both passes** (v1: 2 and 3). R21, R26 and R31, the three v1 system errors, all produced a verdict in both v2 passes.
- **Conformant recall fell** (see below); retrieval-correct is 60.0 % / 62.5 % vs 68.4 % / 67.6 %.

### Per-class precision (P) and recall (R), counts and Wilson 95 % intervals

| class | support (v1 run 1, run 2 / v2 run 1, run 2) | v1 run 1 | v1 run 2 | v2 run 1 | v2 run 2 |
|---|---|---|---|---|---|
| conformant | 17, 17 / 17, 17 | P 15/15 = 100.0 % [80–100]<br>R 15/17 = 88.2 % [66–97] | P 14/14 = 100.0 % [78–100]<br>R 14/17 = 82.4 % [59–94] | P 11/11 = 100.0 % [74–100]<br>R 11/17 = 64.7 % [41–83] | P 11/11 = 100.0 % [74–100]<br>R 11/17 = 64.7 % [41–83] |
| gap | 16, 15 / 16, 16 | P 8/9 = 88.9 % [57–98]<br>R 8/16 = 50.0 % [28–72] | P 7/8 = 87.5 % [53–98]<br>R 7/15 = 46.7 % [25–70] | P 8/8 = 100.0 % [68–100]<br>R 8/16 = 50.0 % [28–72] | P 9/9 = 100.0 % [70–100]<br>R 9/16 = 56.3 % [33–77] |
| insufficient | 5, 5 / 7, 7 | P 4/14 = 28.6 % [12–55]<br>R 4/5 = 80.0 % [38–96] | P 4/15 = 26.7 % [11–52]<br>R 4/5 = 80.0 % [38–96] | P 7/21 = 33.3 % [17–55]<br>R 7/7 = 100.0 % [65–100] | P 7/20 = 35.0 % [18–57]<br>R 7/7 = 100.0 % [65–100] |


### Confusion matrices

  v1 run 1: conformant: [15, 0, 2]  gap: [0, 8, 8]  insufficient: [0, 1, 4]
  v1 run 2: conformant: [14, 0, 3]  gap: [0, 7, 8]  insufficient: [0, 1, 4]
  v2 run 1: conformant: [11, 0, 6]  gap: [0, 8, 8]  insufficient: [0, 0, 7]
  v2 run 2: conformant: [11, 0, 6]  gap: [0, 9, 7]  insufficient: [0, 0, 7]


### Agreement between the two runs


  v1: verdict, ERROR as its own state, all items 38/40 = 95.0 % [83–99]; verdict over items scored in both 36/37 = 97.3 % [86–100]; cited clause (items citing in both) 27/28 = 96.4 % [82–99]
  v2: verdict, ERROR as its own state, all items 39/40 = 97.5 % [87–100]; verdict over items scored in both 39/40 = 97.5 % [87–100]; cited clause (items citing in both) 31/32 = 96.9 % [84–99]


### Pre-registered criteria (commit `ad3175f1`)

| criterion | outcome |
|---|---|
| **Primary — zero false gaps committed over the 40 items, in both passes** | **MET.** 0 false gaps among the 17 committed gaps (8 + 9); the 95 % Wilson upper bound on the false-gap share of committed gaps is 18 % (0/17 = 0.0 % [0–18]). |
| **Secondary — number of true gaps committed (counts)** | pass 1: **8** of 16 gold gaps; pass 2: **9** of 16. DEV 3 and 3 (of 6); TEST 5 and 6 (of 10). |

Derived rates, each with its interval (pooling the two passes treats them as independent, which they are not: read pooled intervals as optimistic):

| quantity | pass 1 | pass 2 | pooled |
|---|---|---|---|
| Gap precision (true gaps / committed gaps) | 8/8 = 100.0 % [68–100] | 9/9 = 100.0 % [70–100] | 17/17 = 100.0 % [82–100] |
| Gap recall (true gaps / gold gaps) | 8/16 = 50.0 % [28–72] | 9/16 = 56.2 % [33–77] | 17/32 = 53.1 % [36–69] |
| Raw gaps of the assessor that were true gaps and were committed | 8/8 = 100.0 % [68–100] | 9/9 = 100.0 % [70–100] | 17/17 = 100.0 % [82–100] |
| Raw gaps of the assessor that were false and were blocked by the guard | 4/4 = 100.0 % [51–100] | 4/4 = 100.0 % [51–100] | 8/8 = 100.0 % [68–100] |
| Coverage (committed / scored) | 22/40 = 55.0 % [40–69] | 23/40 = 57.5 % [42–71] | 45/80 = 56.2 % [45–67] |

By group (DEV = the 16 items of `eval/frozen-subset.json`, already seen and used to diagnose the previous rule; TEST = the other 24):

| group | pass | coverage | true gaps committed | gap recall | committed gaps | false gaps committed |
|---|---|---|---|---|---|---|
| DEV (16 items already seen) | 1 | 5/16 = 31.2 % [14–56] | 3 of 6 gold gaps | 3/6 = 50.0 % [19–81] | 3 | 0 |
| DEV (16 items already seen) | 2 | 6/16 = 37.5 % [18–61] | 3 of 6 gold gaps | 3/6 = 50.0 % [19–81] | 3 | 0 |
| TEST (24 other items) | 1 | 17/24 = 70.8 % [51–85] | 5 of 10 gold gaps | 5/10 = 50.0 % [24–76] | 5 | 0 |
| TEST (24 other items) | 2 | 17/24 = 70.8 % [51–85] | 6 of 10 gold gaps | 6/10 = 60.0 % [31–83] | 6 | 0 |

**How much evidence the primary criterion really gives.** The guard only has something to block when the assessor says `gap` on an item whose
reference is not `gap`. That happened on **4 items per pass: R10, R14, R30 (DEV) and R20 (TEST)**; all four were blocked in both passes (R10, R30, R20 by
question (a) "same subject", R14 by question (b), with the clause's 9 NOTEs given to the verifier; whether the NOTEs or the "optionally" wording decided it cannot be told from the reply). In TEST there is a single such item (R20). "Zero false gaps"
therefore rests on 4 distinct false raw gaps, 3 of which belong to the group that motivated the rule.

### Missed gold gaps come from retrieval and the assessor, not from the guard

Every gold gap that was not committed as a gap had an assessor verdict of `insufficient` **before** any guard ran (`raw_verdict` ≠ `gap`); the guard blocked no
true gap in either pass. Reasons (pass 1; pass 2 is the same except R25):

| item | clause retrieved vs gold clause | why it was not a committed gap |
|---|---|---|
| R09, R13, R33, R37, R39, R40 | none vs 5.3.5.1, 5.3.7.2, 5.2.2.3.1, 5.3.8.2, 5.6.1.4, 5.6.1.4 | retrieval found no clause (`no_clause_found`) |
| R25 (pass 1 only) | 5.5.5.2 vs 5.5.5.1 | wrong clause retrieved; committed as `insufficient` (silent error). In pass 2 the right clause was found and the gap committed |
| R17 | 5.5.4.1 = gold | right clause, but the assessor answered `insufficient` with confidence 0.55 → review (same item as v1) |

So 7 of 8 misses in pass 1 (6 of 7 in pass 2) are retrieval failures; the remaining one (R17) is the assessor's judgement. Gap recall is therefore bounded by retrieval
(and by the assessor), which this change does not touch.

### What got worse: conformant items

Conformant recall dropped from 88.2 % / 82.4 % (v1) to 64.7 % / 64.7 % (11 of 17 in both v2 passes). The six conformant items not answered `conformant` are the same in both passes:

| item | assessor | outcome in v2 |
|---|---|---|
| R28 | `conformant`, confidence 0.99 | quote not verbatim → forced to `insufficient`, review (`citation_not_verbatim`) |
| R14 | `gap` (0.92) | gap blocked by question (b) → `insufficient`, review |
| R11 | `insufficient` | pass 1: low confidence → review; pass 2: **committed** as `insufficient` (silent error) |
| R16, R32 | `insufficient`, low confidence | review (`low_confidence`); R32 also retrieved the wrong clause |
| R12 | no clause retrieved | review (`no_clause_found`) |

Only R28 and R14 are direct effects of the new guards; the other four are assessor or retrieval behaviour that differs from v1 (in v1 these items were answered
`conformant`; v1 missed R06, R08 and in run 2 R02). Because v2 changed several things at once, **this data cannot say which change caused them**.

### Regression baseline

[`eval/baseline-frozen.json`](eval/baseline-frozen.json) now holds the v2 numbers on the frozen 16-item subset: committed errors 0 (pass 1) and 1 (pass 2; R11), so the
worst run is **1** and the gate fails above **2** (worst run + 1), as before. It does not gate coverage, which on this subset fell from 10 committed items per run (v1)
to 5 and 6 (v2). The live check is `npm run eval:regression` (it sets `GAP_GUARD=verifier`, the Gemini verifier and the provider pin).

### Spec text in committed files (audit finding)

`scripts/check-no-spec-text.ts` found runs of ≥ 9 consecutive spec words in two files **committed before this change**: `eval/results-run1.json` and `-run2.json`
(model notes `gap_note` / `verifier_note` quote clauses) and `eval/gold-set.json` (requirement and justification texts). They are untouched here. The new `.public.json` files and
this document are clean. Rewriting history or replacing those files is a separate decision.


### Confidence calibration — recomputed on the v2 runs

[`vidimus-svc/calibrate.py`](vidimus-svc/calibrate.py) was re-run on the two v2 passes (same method as above: one unit per (item, tranche), item-grouped 5-fold
cross-validation, Wilson 95 %, minimum 10 items per tranche). The table built from the v1 runs is kept as
[`eval/calibration-v1-runs.json`](eval/calibration-v1-runs.json) (and reproduces exactly: `cal-ad31e4132318`); the sidecar now loads
[`eval/calibration.json`](eval/calibration.json), version **`cal-102be0bdb9d1`**.

| | v1 runs (`cal-ad31e4132318`) | v2 runs (`cal-102be0bdb9d1`) |
|---|---|---|
| items with a scored prediction / predictions / system errors excluded | 38 / 75 / 5 | 40 / 80 / 0 |
| ECE of the raw confidence | 0.145 | 0.132 |
| ECE of the calibrated confidence (5-fold CV by item) | 0.023 | 0.003 |
| coverage of the calibration (predictions with a calibrated tranche) | 61.3 % (46/75; the other 29 go to human review) | 65.0 % (52/80; the other 28 go to human review) |
| **top tranche [0.8, 1.0]**: items / mean raw confidence | 24 / 0.954 | 26 / 0.983 |
| **top tranche**: observed accuracy [Wilson 95 %] | 87.5 % [69.0–95.7] | 94.2 % [78.4–98.7] |
| other non-empty tranches (items; none reaches 10) | 9, 3, 3 | 8, 4, 2 |

**Did the top tranche change? Yes, moderately.** Its observed accuracy rose from 87.5 % to 94.2 % and the gap between mean raw
confidence and accuracy shrank (from 7.9 to 4.1 points), but the two intervals overlap
widely, so this is not evidence of a real difference. For the same input the sidecar used to answer 0.875 [0.690, 0.957] and now answers 0.942 [0.784, 0.987].

How to read it:
- What is calibrated is the **guarded pipeline's final verdict**: cases where the assessor was confidently wrong and a guard forced `insufficient` (R10, R30…) now count as correct, which
  mechanically raises the top tranche. It is not an improvement of the LLM's own confidence.
- The cross-validated ECE (0.003) covers only the top tranche (it is the only calibrated one): it says that tranche's accuracy is stable across folds, nothing about the others.
  All three other non-empty tranches still have fewer than 10 items, so 28 of 80 predictions are answered `calibrated: false` and routed to human review.
- The same 40 items were used to design the guards and to calibrate; the intervals are item-level but ignore that dependence.

## Limites de cette évaluation (limits of this evaluation)

This section is about the evaluation of the `GAP_GUARD=verifier` rule (pre-registered in
[`eval/PREREGISTRATION-gap-guard.md`](eval/PREREGISTRATION-gap-guard.md)). The gold set is **no longer pristine for this rule**:

- The author of the rule (this project) had read the v1 failure analysis above — which items fail, why, and the R10 case study —
  before designing it. The 16 DEV items were additionally used to diagnose why the previous lexical rule blocked true gaps.
- The "permitted / optionally" clause of question (b) was written after seeing R14 (a requirement more specific than an
  "optionally" clause in the specification).
- The handling of NOTEs (attached to the verifier's input, with the "NOTE … permitted or excepted" sentence) was designed with
  R39/R40 (NOTE-based loopholes, see *Gold set → Composition*) in mind; they are in the TEST group.
- The TEST group (24 items) contains **only 10 true gaps** (16 gold gaps − 6 in DEV): recall there moves in steps of 10 points
  and one item decides a criterion.
- Two passes of the same 40 items at temperature 0 measure stability, not independent samples; one assessor model, one verifier
  model, one spec extract.

- **v2 is a bundle of changes** (assessor prompt, citation window, deterministic guard, verifier-confirmed gaps, verifier model, JSON fix); no ablation was run, so the drop in conformant recall
  and the gain in committed accuracy cannot be attributed to a single change.
- The primary criterion ("zero false gaps") is exercised by **4 distinct false raw gaps** (R10, R14, R30 in DEV; R20 in TEST); it is a weak test of precision, as its interval shows (upper bound 18 %).
- Two passes at temperature 0 of the same 40 items; every interval treats runs as independent and is therefore optimistic.

Nothing was tuned on the TEST group: prompts, caps and criteria were committed before the first paid call.

## Changelog

- **v2 (2026-10-06)** — citation guards, verifier-confirmed gaps (`GAP_GUARD=verifier`), other-family verifier, sanitised results, v2 regression baseline and recalibrated confidence (`cal-102be0bdb9d1`). Measured on two full passes; pre-registration `ad3175f1`. See *v2*. v1 sections unchanged.
- **v1.2 (2026-10-06)** — calibration re-done at item level with item-grouped 5-fold cross-validation;
  tranches need ≥ 10 distinct items (only the top one qualifies), others go to human review.
  Supersedes the v1.1 table.
- **v1.1 (2026-10-06)** — confidence calibration added (see *Confidence calibration*): empirical
  tranche accuracy with Wilson 95 % intervals replaces the 2-sample bootstrap in the sidecar. The v1
  results are unchanged and were measured with the previous confidence.
- **v1 (2026-07-08)** — first evaluation. Gold set of 40 human-validated requirements over a
  266-clause TS 38.331 v19.3.0 extract; harness [`scripts/eval.ts`](scripts/eval.ts); model
  `anthropic/claude-sonnet-4.6`. Two identical runs for stability. Known issue: two
  out-of-scope items (R21, R31; plus R26 in run 2) fail as system errors (multi-object nav
  JSON). **Fix committed post-run in `deb282d`** (`extractJSON` now returns the first
  balanced JSON object): removes this error class. The v1 numbers above are reported
  **as run**, with the errors counted as failures; a future v2 re-run on the patched
  extractor will fold R21/R26/R31 back into the confusion matrix.

## Threats to validity

- **Calibration is thin** (38 items, one model, one calibrated tranche): see *Confidence calibration*.
- **Small n (40).** Per-class figures (especially `insufficient`, n=7) have wide
  confidence intervals; treat them as directional, not definitive.
- **Author-adjacent gold set.** Requirements were drafted and human-validated by the
  same project; they are not an independent third-party benchmark. They are designed
  to be adversarial (role reversals, NOTE loopholes, out-of-scope distractors) rather
  than to flatter the system.
- **Single spec, four clause groups.** Results characterise TS 38.331 §5.2/5.3/5.5/5.6,
  not 3GPP conformance in general.
- **Single model; near- but not fully deterministic.** Temperature 0 does not make LLM
  output bit-stable. The evaluation was run twice; verdicts agreed ~95–97% run-to-run and
  two items flipped (both absorbed by review-gating) — see *Run-to-run stability*. Headline
  numbers can still drift a few points between runs, so treat them as a band, not a point.

**Identified fixes (future work), ranked by the analysis above:**

1. **Grounding check before a committed `gap`** — verify the cited clause is topically
   on-subject for the requirement. Directly targets R10, the only committed false `gap`,
   where redundant judges shared a spurious citation. This is the highest-value fix.
2. **Widen / re-center the citation window** (currently 500 chars) — recovers R06/R08,
   where the correct clause was retrieved but the relevant sentence was clipped.
3. **Strengthen the retrieval navigator** — retrieval, not judgement, is the bottleneck
   (verdict accuracy 92.6% given a good clause vs. 18.2% without). Reducing the 7 retrieval
   misses would lift `gap` recall the most.
4. **`extractJSON` multi-object hardening** — already fixed in `deb282d`.
