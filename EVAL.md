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

## Changelog

- **v1 (2026-07-08)** — first evaluation. Gold set of 40 human-validated requirements over a
  266-clause TS 38.331 v19.3.0 extract; harness [`scripts/eval.ts`](scripts/eval.ts); model
  `anthropic/claude-sonnet-4.6`. Two identical runs for stability. Known issue: two
  out-of-scope items (R21, R31; plus R26 in run 2) fail as system errors (multi-object nav
  JSON). **Fix committed post-run in `deb282d`** (`extractJSON` now returns the first
  balanced JSON object): removes this error class. The v1 numbers above are reported
  **as run**, with the errors counted as failures; a future v2 re-run on the patched
  extractor will fold R21/R26/R31 back into the confusion matrix.

## Threats to validity

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
