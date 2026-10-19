# Pre-registration — GAP_GUARD=verifier

Written and committed **before any paid call of this evaluation**. Nothing below may be changed after the TEST
group has been looked at. Any later change is a new, separately labelled experiment.

## What is evaluated
The rule deciding whether a raw `gap` of the assessor (Claude Sonnet 4.6, unchanged prompt) may be committed.
`GAP_GUARD=lexical` is the previous shall/must + term-coverage rule (kept for comparison).
`GAP_GUARD=verifier` (default) replaces it by two fixed questions put to a verifier of another model family.

## Fixed prompt, caps and logic (source of truth: `lib/gap-check.ts`, version `gap-check-v1`, at the commit of this file)
- System prompt: the constant `GAP_CHECK_SYSTEM`, including the sentence added on review:
  *"If a NOTE in the passage makes the requirement's behaviour permitted or excepted, answer false to (b)."*
- User message: `REQUIREMENT:` … `PASSAGE (clause <id>, verbatim):` … and, if the clause has NOTE paragraphs not already
  inside the passage, `NOTES attached to this clause:` followed by one `NOTE: <paragraph>` per line.
- Passage = the assessor's exact quote as an exact slice of the clause text. If the quote ends with ":" the numbered bullets
  (`1>`, `2>`, …) and NOTE paragraphs that follow it are appended, **cap 3000 characters**. NOTEs of the clause: **cap 2000 characters**.
- A gap commits only if ALL hold: quote verbatim in the clause (≥ 4 words, existing guard); assessor confidence ≥ 0.75
  (existing review threshold); the verifier is from another family than the assessor; (a) `same_subject` = true;
  (b) `contradicts` = true; `passage_words` is verbatim in the passage/NOTEs and `requirement_words` verbatim in the requirement.
- Otherwise the verdict is forced to `insufficient_evidence` with reason `gap_off_subject`, `gap_no_contradiction`,
  `gap_verifier_unusable`, `citation_not_verbatim` or `verifier_same_family`. One retry only if the reply is not JSON at all.
- The adversarial `verify` call (agree / disagree on the final verdict) is unchanged and still gates through `verifier_disagreement`.
- No other threshold exists. In particular nothing is tuned on results.

## Setup
- Assessor: `anthropic/claude-sonnet-4.6`, temperature 0, prompt unchanged. Citation window: 4000 characters, relevance-selected.
- Verifier: `google/gemini-3.8-flash`, temperature 0, provider pinned:
  `{"only":["google-vertex"],"allow_fallbacks":false,"data_collection":"deny"}`.
  One cheap probe call with exactly these settings precedes the runs; if it fails, nothing else is run and the settings are not changed.
- Two complete passes over the 40 gold items (`eval/results-v2-gapguard-1.json`, `-2.json`), no retries beyond the harness's.
- Budget: 3 USD cumulative (0.86 USD already spent on earlier runs).
- Groups, fixed now: **DEV** = the 16 ids of `eval/frozen-subset.json` (already seen in earlier runs and used for the diagnosis
  that motivated this guard); **TEST** = the other 24 ids. TEST contains **10 true gaps** (16 gold gaps − 6 in DEV).

## Success criteria
- **Primary: zero false gaps committed over the 40 items, in both passes.** A false gap = verdict `gap`, committed (not sent to
  review), gold verdict ≠ `gap`.
- **Secondary: number of true gaps committed**, reported as counts (per group, per pass). No target value.
- Also reported (no criterion): gap recall and precision, coverage, reasons for non-committed raw gaps, system errors, cost.
- Reporting tool: `scripts/eval-gap-report.ts` (committed with this file).

## Not done in this experiment
No regression baseline update, no change to `EVAL.md` beyond the "Limites de cette évaluation" section, no prompt/threshold
change after the first result, no model selection.
