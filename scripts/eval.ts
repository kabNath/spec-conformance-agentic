// ============================================================
// Gold-set evaluation harness — Phase 3
// ------------------------------------------------------------
// Runs the REAL pipeline nodes (retrieve → assess → verify) over a
// human-validated gold set of 40 requirements, then scores the output:
// precision / recall / F1, a confusion matrix, clause-retrieval accuracy,
// a needs-review safety analysis, a false-positive list, and OpenRouter
// cost — broken down by difficulty AND by verdict class.
//
// The `extract` node is deliberately BYPASSED: the gold requirements are
// already atomic and testable, so feeding them straight into retrieve
// isolates the measurement to what actually matters — does the pipeline
// (a) find the governing clause and (b) reach the right verdict.
//
// Usage:
//   tsx --env-file=.env.local scripts/eval.ts               # all 40
//   tsx --env-file=.env.local scripts/eval.ts --dry-run     # first 3, no results file
//   tsx --env-file=.env.local scripts/eval.ts --limit 10    # first 10
//   tsx --env-file=.env.local scripts/eval.ts --estimate    # cost estimate only, no LLM calls
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
import { retrieveNode } from "../lib/graph/nodes/retrieve";
import { assess } from "../lib/graph/nodes/assess";
import { verify } from "../lib/graph/nodes/verify";
import { llmStats } from "../lib/clients/openrouter";
import type { ConformanceStateT } from "../lib/graph/state";
import type { Verdict, ReviewReason } from "../lib/conformance-contract";

// ── Fixed run context (must match how the corpus was ingested) ──────────
const ORG_ID = process.env.EVAL_ORG_ID ?? "org_3FxP05j3A3NcRH1yPRQP0l2NnFj";
const STANDARD_ID = process.env.EVAL_STANDARD_ID ?? "ts38331";
const REVIEW_THRESHOLD = Number(process.env.EVAL_REVIEW_THRESHOLD ?? 0.75);

// ── OpenRouter pricing for the configured model (USD per 1M tokens) ─────
// anthropic/claude-sonnet-4.6 list price. Override via env if the model changes.
const PRICE_IN_PER_M = Number(process.env.EVAL_PRICE_IN ?? 3);
const PRICE_OUT_PER_M = Number(process.env.EVAL_PRICE_OUT ?? 15);

type GoldVerdict = "conformant" | "gap" | "insufficient";
const CLASSES: GoldVerdict[] = ["conformant", "gap", "insufficient"];

interface GoldItem {
  id: string;
  requirement: string;
  governing_clause: string | null;
  proposed_verdict: GoldVerdict;
  difficulty: "easy" | "medium" | "hard";
  human_validated: boolean;
  human_verdict: GoldVerdict | null;
}
interface GoldSet {
  meta: { spec: string; version: string; release: string; [k: string]: unknown };
  requirements: GoldItem[];
}

// The pipeline's internal verdict enum → the gold set's shorter label.
function normalizeVerdict(v: Verdict): GoldVerdict {
  return v === "insufficient_evidence" ? "insufficient" : v;
}

interface ItemResult {
  id: string;
  difficulty: GoldItem["difficulty"];
  requirement: string;
  gold_verdict: GoldVerdict;
  gold_clause: string | null;
  pred_verdict: GoldVerdict;
  pred_clause: string | null;
  verdict_correct: boolean;
  clause_outcome: "exact" | "family" | "wrong_clause" | "no_citation" | "correct_abstain" | "spurious_citation";
  review_required: boolean;
  review_reason?: ReviewReason;
  assessor_confidence: number;
  verifier_agrees: boolean;
  verifier_confidence: number;
  verifier_note: string;
  gap_note?: string;
  retrieval_path: string[];
  llm_calls: number;
  error?: string; // set only when the item could not be evaluated (LLM/JSON failure)
}

// Clause-retrieval outcome for one item.
function clauseOutcome(gold: string | null, pred: string | null): ItemResult["clause_outcome"] {
  if (gold === null) return pred === null ? "correct_abstain" : "spurious_citation";
  if (pred === null) return "no_citation";
  if (pred === gold) return "exact";
  // ancestor/descendant of the governing clause = same procedure family
  if (pred.startsWith(gold + ".") || gold.startsWith(pred + ".")) return "family";
  return "wrong_clause";
}

async function evalOne(item: GoldItem): Promise<ItemResult> {
  const before = llmStats.calls;

  // Minimal state: retrieveNode reads requirements[cursor], standardId,
  // standardMeta, orgId. No DB, no extract, no persistence.
  const state = {
    orgId: ORG_ID,
    standardId: STANDARD_ID,
    standardMeta: { spec: gold.meta.spec, version: gold.meta.version, release: gold.meta.release },
    requirements: [{ requirement: item.requirement }],
    cursor: 0,
    citations: [],
    path: [],
  } as unknown as ConformanceStateT;

  const { citations = [], path = [] } = await retrieveNode(state);
  const a = await assess(item.requirement, citations);
  const v = await verify(item.requirement, a.verdict, citations);

  // Review flag — same logic as compileNode in lib/graph/pipeline.ts.
  let review: { required: boolean; reason?: ReviewReason };
  if (citations.length === 0) review = { required: true, reason: "no_clause_found" };
  else if (!v.agrees) review = { required: true, reason: "verifier_disagreement" };
  else if (a.confidence < REVIEW_THRESHOLD) review = { required: true, reason: "low_confidence" };
  else review = { required: false };

  const predVerdict = normalizeVerdict(a.verdict);
  const goldVerdict = item.human_verdict as GoldVerdict;
  const predClause = citations[0]?.clause ?? null;

  return {
    id: item.id,
    difficulty: item.difficulty,
    requirement: item.requirement,
    gold_verdict: goldVerdict,
    gold_clause: item.governing_clause,
    pred_verdict: predVerdict,
    pred_clause: predClause,
    verdict_correct: predVerdict === goldVerdict,
    clause_outcome: clauseOutcome(item.governing_clause, predClause),
    review_required: review.required,
    review_reason: review.reason,
    assessor_confidence: a.confidence,
    verifier_agrees: v.agrees,
    verifier_confidence: v.confidence,
    verifier_note: v.note,
    gap_note: a.gapNote,
    retrieval_path: path,
    llm_calls: llmStats.calls - before,
  };
}

// Per-item resilience: an LLM occasionally returns unparseable JSON, and the
// pipeline's llmJSON throws after its own single retry. One bad response must
// not abort the whole run, so retry the item a few times; if it still fails,
// return a tagged error result that is reported but excluded from scoring.
async function runItem(item: GoldItem, attempts = 3): Promise<ItemResult> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await evalOne(item); }
    catch (e) { last = e; }
  }
  return {
    id: item.id, difficulty: item.difficulty, requirement: item.requirement,
    gold_verdict: item.human_verdict as GoldVerdict, gold_clause: item.governing_clause,
    pred_verdict: "insufficient", pred_clause: null, verdict_correct: false,
    clause_outcome: "no_citation", review_required: true, assessor_confidence: 0,
    verifier_agrees: false, verifier_confidence: 0, verifier_note: "",
    retrieval_path: [], llm_calls: 0,
    error: last instanceof Error ? last.message : String(last),
  };
}

// ── Metrics ─────────────────────────────────────────────────────────────
function confusion(results: ItemResult[]) {
  // matrix[gold][pred]
  const m: Record<GoldVerdict, Record<GoldVerdict, number>> = {
    conformant: { conformant: 0, gap: 0, insufficient: 0 },
    gap: { conformant: 0, gap: 0, insufficient: 0 },
    insufficient: { conformant: 0, gap: 0, insufficient: 0 },
  };
  for (const r of results) m[r.gold_verdict][r.pred_verdict]++;
  return m;
}

function perClassPRF(m: ReturnType<typeof confusion>) {
  const out: Record<GoldVerdict, { precision: number; recall: number; f1: number; support: number }> = {} as never;
  for (const c of CLASSES) {
    const tp = m[c][c];
    const fp = CLASSES.reduce((s, g) => s + (g !== c ? m[g][c] : 0), 0);
    const fn = CLASSES.reduce((s, p) => s + (p !== c ? m[c][p] : 0), 0);
    const support = CLASSES.reduce((s, p) => s + m[c][p], 0);
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    out[c] = { precision, recall, f1, support };
  }
  return out;
}

function bucketAccuracy<T extends string>(results: ItemResult[], key: (r: ItemResult) => T) {
  const acc: Record<string, { correct: number; total: number }> = {};
  for (const r of results) {
    const k = key(r);
    (acc[k] ??= { correct: 0, total: 0 }).total++;
    if (r.verdict_correct) acc[k].correct++;
  }
  return acc;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const safeRatio = (num: number, den: number) => (den === 0 ? "n/a" : pct(num / den));

// ── Reporting ───────────────────────────────────────────────────────────
function report(results: ItemResult[]) {
  const n = results.length;
  const correct = results.filter((r) => r.verdict_correct).length;
  const m = confusion(results);
  const prf = perClassPRF(m);
  const macroF1 = CLASSES.reduce((s, c) => s + prf[c].f1, 0) / CLASSES.length;
  const weightedF1 = CLASSES.reduce((s, c) => s + prf[c].f1 * prf[c].support, 0) / n;

  const line = (s = "") => console.log(s);
  line("\n════════════════════════════════════════════════════════════");
  line(`  GOLD-SET EVALUATION — ${n} requirements`);
  line("════════════════════════════════════════════════════════════");

  line(`\nOverall verdict accuracy: ${correct}/${n} = ${pct(correct / n)}`);
  line(`Macro-F1: ${round3(macroF1)}   Weighted-F1: ${round3(weightedF1)}`);

  line("\n── Confusion matrix (rows = gold, cols = predicted) ──");
  line(`${"".padEnd(14)}${CLASSES.map((c) => c.slice(0, 6).padStart(8)).join("")}   | support`);
  for (const g of CLASSES) {
    const row = CLASSES.map((p) => String(m[g][p]).padStart(8)).join("");
    const support = CLASSES.reduce((s, p) => s + m[g][p], 0);
    line(`${g.padEnd(14)}${row}   | ${support}`);
  }

  line("\n── Per-class precision / recall / F1 ──");
  for (const c of CLASSES) {
    const p = prf[c];
    line(`${c.padEnd(14)} P=${pct(p.precision).padStart(6)}  R=${pct(p.recall).padStart(6)}  F1=${round3(p.f1).toFixed(3)}  (n=${p.support})`);
  }

  line("\n── Accuracy by difficulty ──");
  const byDiff = bucketAccuracy(results, (r) => r.difficulty);
  for (const d of ["easy", "medium", "hard"]) {
    if (byDiff[d]) line(`${d.padEnd(8)} ${byDiff[d].correct}/${byDiff[d].total} = ${pct(byDiff[d].correct / byDiff[d].total)}`);
  }

  line("\n── Accuracy by gold verdict class ──");
  const byClass = bucketAccuracy(results, (r) => r.gold_verdict);
  for (const c of CLASSES) {
    if (byClass[c]) line(`${c.padEnd(14)} ${byClass[c].correct}/${byClass[c].total} = ${pct(byClass[c].correct / byClass[c].total)}`);
  }

  // Clause retrieval
  line("\n── Clause retrieval ──");
  const co = results.reduce((acc, r) => { acc[r.clause_outcome] = (acc[r.clause_outcome] || 0) + 1; return acc; }, {} as Record<string, number>);
  const withClause = results.filter((r) => r.gold_clause !== null);
  const exact = withClause.filter((r) => r.clause_outcome === "exact").length;
  const exactOrFamily = withClause.filter((r) => r.clause_outcome === "exact" || r.clause_outcome === "family").length;
  line(`Exact clause match (of ${withClause.length} with a governing clause): ${exact} = ${safeRatio(exact, withClause.length)}`);
  line(`Exact + same-family:                                     ${exactOrFamily} = ${safeRatio(exactOrFamily, withClause.length)}`);
  const abstainItems = results.filter((r) => r.gold_clause === null);
  const correctAbstain = abstainItems.filter((r) => r.clause_outcome === "correct_abstain").length;
  line(`Correct abstention (of ${abstainItems.length} out-of-scope items, no citation): ${correctAbstain} = ${safeRatio(correctAbstain, abstainItems.length)}`);
  line(`Outcome breakdown: ${JSON.stringify(co)}`);

  // Two-stage decomposition: separate retrieval quality from judgement quality.
  // "Retrieval correct" = cited the governing clause (exact/family) OR correctly
  // cited nothing for an out-of-scope item. Verdict accuracy is then conditioned
  // on retrieval, isolating how much of the error is bad retrieval vs bad judgement.
  const retrievalOk = (r: ItemResult) => r.clause_outcome === "exact" || r.clause_outcome === "family" || r.clause_outcome === "correct_abstain";
  const retOk = results.filter(retrievalOk);
  const retBad = results.filter((r) => !retrievalOk(r));
  const vGivenOk = retOk.filter((r) => r.verdict_correct).length;
  const vGivenBad = retBad.filter((r) => r.verdict_correct).length;
  line("\n── Two-stage decomposition ──");
  line(`Stage 1  retrieval correct (governing clause found, or correct abstention): ${retOk.length}/${n} = ${safeRatio(retOk.length, n)}`);
  line(`Stage 2  verdict accuracy | retrieval correct: ${vGivenOk}/${retOk.length} = ${safeRatio(vGivenOk, retOk.length)}`);
  line(`         verdict accuracy | retrieval wrong:   ${vGivenBad}/${retBad.length} = ${safeRatio(vGivenBad, retBad.length)}`);

  // Review-gated verdicts: a flagged item (needs_review) is an ABSTENTION, not an
  // asserted verdict. This trades coverage for precision — the product's safety knob.
  const wrong = results.filter((r) => !r.verdict_correct);
  const committed = results.filter((r) => !r.review_required);
  const abstained = results.filter((r) => r.review_required);
  const committedCorrect = committed.filter((r) => r.verdict_correct).length;
  const suppressedErrors = abstained.filter((r) => !r.verdict_correct).length; // would have been wrong → good abstention
  const withheldCorrect = abstained.filter((r) => r.verdict_correct).length;   // would have been right → cost of gating
  const silentErrors = wrong.filter((r) => !r.review_required);                // wrong AND committed → dangerous
  line("\n── Review-gated verdicts (needs_review = abstention) ──");
  line(`Raw accuracy (ungated):        ${correct}/${n} = ${pct(correct / n)}`);
  line(`Coverage (committed answers):  ${committed.length}/${n} = ${pct(committed.length / n)}`);
  line(`Committed accuracy (trust when it answers): ${committedCorrect}/${committed.length} = ${safeRatio(committedCorrect, committed.length)}`);
  line(`Abstentions: ${abstained.length} — ${suppressedErrors} suppressed a wrong verdict (good), ${withheldCorrect} withheld a correct one (cost)`);
  line(`Silent errors (wrong AND committed — the dangerous class): ${silentErrors.length}`);
  for (const r of silentErrors) line(`   ${r.id}: gold=${r.gold_verdict} pred=${r.pred_verdict} conf=${round3(r.assessor_confidence)}`);

  // false positives / full error list
  line("\n── Error list (verdict mismatches) ──");
  if (!wrong.length) line("  none — every verdict matched the human reference.");
  for (const r of wrong) {
    const danger = r.gold_verdict === "gap" && r.pred_verdict === "conformant" ? "  ⚠ MISSED NON-CONFORMANCE" : "";
    const gated = r.review_required ? "flagged→abstained" : "COMMITTED";
    line(`  ${r.id} [${r.difficulty}] gold=${r.gold_verdict} → pred=${r.pred_verdict} | clause gold=${r.gold_clause ?? "—"} pred=${r.pred_clause ?? "—"} | ${gated}${danger}`);
  }

  return {
    n, correct, accuracy: correct / n, confusion: m, perClass: prf, macroF1, weightedF1,
    byDifficulty: byDiff, byClass, clauseOutcomes: co,
    retrieval: { correct: retOk.length, verdictGivenCorrect: vGivenOk, verdictGivenWrong: vGivenBad, retBad: retBad.length },
    gated: {
      coverage: committed.length, committedCorrect, committedAccuracy: committed.length ? committedCorrect / committed.length : 0,
      abstained: abstained.length, suppressedErrors, withheldCorrect, silentErrors: silentErrors.length,
    },
  };
}

function costReport(label: string) {
  const inCost = (llmStats.inputTokens / 1e6) * PRICE_IN_PER_M;
  const outCost = (llmStats.outputTokens / 1e6) * PRICE_OUT_PER_M;
  const total = inCost + outCost;
  console.log(`\n── OpenRouter cost (${label}) ──`);
  console.log(`LLM calls: ${llmStats.calls}  |  input tokens: ${llmStats.inputTokens.toLocaleString()}  |  output tokens: ${llmStats.outputTokens.toLocaleString()}`);
  console.log(`Cost: $${inCost.toFixed(4)} in + $${outCost.toFixed(4)} out = $${total.toFixed(4)} (@ $${PRICE_IN_PER_M}/$${PRICE_OUT_PER_M} per 1M in/out)`);
  console.log("(Embeddings for the Qdrant fallback are billed separately and negligible; they fire only when the graph-walk stalls.)");
  return { calls: llmStats.calls, inputTokens: llmStats.inputTokens, outputTokens: llmStats.outputTokens, costUsd: round3(total) };
}

// ── Main ────────────────────────────────────────────────────────────────
const gold: GoldSet = JSON.parse(readFileSync(new URL("../eval/gold-set.json", import.meta.url), "utf8"));

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const estimateOnly = argv.includes("--estimate");
  const limitArg = argv.indexOf("--limit");
  const limit = dryRun ? 3 : limitArg !== -1 ? Number(argv[limitArg + 1]) : Infinity;

  // Guard: never run unless every entry is human-validated (the protocol).
  const unvalidated = gold.requirements.filter((r) => !r.human_validated || !r.human_verdict);
  if (unvalidated.length) {
    console.error(`REFUSING TO RUN: ${unvalidated.length} entries are not human-validated: ${unvalidated.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }

  if (estimateOnly) {
    // Static estimate — no LLM calls. Based on the pipeline's call structure:
    // per requirement = 1 assess + 1 verify + N navigation calls (≤ MAX_HOPS×(MAX_RESEEDS+1)).
    // Typical nav depth from the graph-walk is 1–3 hops before "done".
    const N = gold.requirements.length;
    const callsPerReq = { low: 3, typical: 5, high: 10 }; // assess+verify + {1,3,8} nav
    const tokPerCall = { in: 1400, out: 160 };             // clause text + req in; short JSON out
    const cost = (calls: number) => ((calls * N * tokPerCall.in) / 1e6) * PRICE_IN_PER_M + ((calls * N * tokPerCall.out) / 1e6) * PRICE_OUT_PER_M;
    console.log(`\nCOST ESTIMATE for ${N} requirements (model priced @ $${PRICE_IN_PER_M}/$${PRICE_OUT_PER_M} per 1M in/out):`);
    console.log(`  best case  (${callsPerReq.low} calls/req):  ~$${cost(callsPerReq.low).toFixed(2)}`);
    console.log(`  typical    (${callsPerReq.typical} calls/req):  ~$${cost(callsPerReq.typical).toFixed(2)}`);
    console.log(`  worst case (${callsPerReq.high} calls/req): ~$${cost(callsPerReq.high).toFixed(2)}`);
    console.log(`  (assumes ~${tokPerCall.in} input + ${tokPerCall.out} output tokens per call)`);
    return;
  }

  const items = gold.requirements.slice(0, limit === Infinity ? undefined : limit);
  console.log(`Running ${items.length} requirement(s) through retrieve → assess → verify …`);
  llmStats.reset();
  const t0 = Date.now();

  const all: ItemResult[] = [];
  for (const item of items) {
    const r = await runItem(item);
    all.push(r);
    const mark = r.error ? "‼" : r.verdict_correct ? "✓" : "✗";
    const tail = r.error ? `ERROR: ${r.error}` : `gold=${r.gold_verdict} pred=${r.pred_verdict} clause=${r.pred_clause ?? "—"} (${r.llm_calls} calls)`;
    console.log(`  ${mark} ${r.id} [${r.difficulty}] ${tail}`);
  }

  const elapsedMs = Date.now() - t0;
  const errored = all.filter((r) => r.error);
  const results = all.filter((r) => !r.error); // scored set excludes harness failures
  if (errored.length) {
    console.log(`\n⚠ ${errored.length} item(s) could not be evaluated after retries (excluded from metrics): ${errored.map((r) => r.id).join(", ")}`);
  }
  const summary = report(results);
  const cost = costReport(dryRun ? "dry-run" : `${items.length} items`);
  console.log(`\nWall-clock: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (dryRun) {
    const perItem = cost.costUsd / items.length;
    console.log(`\nDRY-RUN complete. Per-item cost: $${perItem.toFixed(4)} → full 40-item run projected at ~$${(perItem * gold.requirements.length).toFixed(2)}.`);
    console.log("Results NOT written to disk (dry-run). Re-run without --dry-run for the full evaluation.");
    return;
  }

  // Persist machine-readable results (only for a full/limited real run).
  const out = {
    generatedAt: new Date().toISOString(),
    config: {
      spec: gold.meta.spec, version: gold.meta.version, release: gold.meta.release,
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
      embeddingsModel: process.env.EMBEDDINGS_MODEL ?? "openai/text-embedding-3-small",
      reviewThreshold: REVIEW_THRESHOLD, orgId: ORG_ID, standardId: STANDARD_ID,
      corpusClauses: 266, goldSetSize: gold.requirements.length,
    },
    summary: { ...summary, scored: results.length, errored: errored.length, elapsedMs },
    cost,
    items: all,
  };
  const outPath = new URL("../eval/results.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults written to eval/results.json`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
