// v1 vs v2 comparison tables from the raw result files (no network, no cost).
//   npx tsx scripts/eval-compare.ts [--v1 a.json b.json] [--v2 c.json d.json]
// Definitions are those of scripts/eval.ts report(): items with an `error` are not scored (they are "failures"
// only in the N=40 accuracy); committed = not sent to human review; silent error = committed AND wrong.
import { readFileSync } from "node:fs";

interface Item { id: string; gold_verdict: string; pred_verdict: string; pred_clause: string | null; gold_clause: string | null; verdict_correct: boolean;
  review_required: boolean; clause_outcome: string; error?: string }
type Run = { items: Item[] };
const V = ["conformant", "gap", "insufficient"];

export function wilson(k: number, n: number, z = 1.959963984540054): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export const frac = (k: number, n: number) => {
  if (n === 0) return "n/a";
  const w = wilson(k, n)!;
  return `${k}/${n} = ${(100 * k / n).toFixed(1)} % [${(100 * w[0]).toFixed(0)}–${(100 * w[1]).toFixed(0)}]`;
};

// Mirrors report(): retrieval is "ok" when the governing clause (or an adjacent/family one) was found, or the item correctly abstained.
const retrievalOk = (r: Item) => r.clause_outcome === "exact" || r.clause_outcome === "family" || r.clause_outcome === "correct_abstain";

export function metrics(run: Run) {
  const all = run.items, sc = all.filter((i) => !i.error);
  const correct = sc.filter((i) => i.verdict_correct).length;
  const committed = sc.filter((i) => !i.review_required), silent = committed.filter((i) => !i.verdict_correct);
  const conf: Record<string, Record<string, number>> = Object.fromEntries(V.map((g) => [g, Object.fromEntries(V.map((p) => [p, 0]))]));
  for (const i of sc) conf[i.gold_verdict][i.pred_verdict]++;
  const perClass = V.map((c) => {
    const tp = conf[c][c], fp = V.reduce((s, g) => s + (g === c ? 0 : conf[g][c]), 0), fn = V.reduce((s, p) => s + (p === c ? 0 : conf[c][p]), 0);
    return { c, tp, fp, fn, support: tp + fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
  });
  const retOk = sc.filter(retrievalOk), retBad = sc.filter((i) => !retrievalOk(i));
  return { n: all.length, scored: sc.length, errored: all.filter((i) => i.error).map((i) => i.id), correct, committed: committed.length,
    committedCorrect: committed.length - silent.length, silent: silent.map((i) => `${i.id} (${i.gold_verdict}→${i.pred_verdict})`), toReview: sc.length - committed.length,
    conf, perClass, retOk: retOk.length, vGivenOk: retOk.filter((i) => i.verdict_correct).length, retBad: retBad.length, vGivenBad: retBad.filter((i) => i.verdict_correct).length };
}

export function agreement(a: Run, b: Run) {
  const A = new Map(a.items.map((i) => [i.id, i])), B = new Map(b.items.map((i) => [i.id, i]));
  const ids = [...A.keys()];
  const state = (i: Item) => (i.error ? "ERROR" : i.pred_verdict);
  const both = ids.filter((id) => !A.get(id)!.error && !B.get(id)!.error);
  const cl = both.filter((id) => A.get(id)!.pred_clause && B.get(id)!.pred_clause);
  return { all: ids.filter((id) => state(A.get(id)!) === state(B.get(id)!)).length, nAll: ids.length,
    scored: both.filter((id) => A.get(id)!.pred_verdict === B.get(id)!.pred_verdict).length, nScored: both.length,
    clause: cl.filter((id) => A.get(id)!.pred_clause === B.get(id)!.pred_clause).length, nClause: cl.length };
}

function load(files: string[]): Run[] { return files.map((f) => JSON.parse(readFileSync(f, "utf8"))); }
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pc = (x: number | null) => (x === null ? "n/a" : (100 * x).toFixed(1) + " %");

function main() {
  const arg = (name: string, n = 2) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv.slice(i + 1, i + 1 + n); };
  const v1 = load(arg("--v1") ?? ["eval/results-run1.json", "eval/results-run2.json"]);
  const v2 = load(arg("--v2") ?? ["eval/results-v2-gapguard-1.json", "eval/results-v2-gapguard-2.json"]);
  const M1 = v1.map(metrics), M2 = v2.map(metrics);
  const row = (label: string, f: (m: ReturnType<typeof metrics>) => string, avg?: (ms: ReturnType<typeof metrics>[]) => string) =>
    `| ${label} | ${[M1, M2].map((ms) => [...ms.map(f), avg ? avg(ms) : "—"]).flat().join(" | ")} |`;
  const m = (ms: ReturnType<typeof metrics>[], f: (x: ReturnType<typeof metrics>) => number) => (100 * mean(ms.map(f))).toFixed(1) + " %";

  console.log("| metric (95 % Wilson interval per run) | v1 run 1 | v1 run 2 | v1 mean | v2 run 1 | v2 run 2 | v2 mean |\n|---|---|---|---|---|---|---|");
  console.log(row("Accuracy, N=40 (system errors count as failures)", (x) => frac(x.correct, x.n), (ms) => m(ms, (x) => x.correct / x.n)));
  console.log(row("Accuracy over verdict-producing items", (x) => frac(x.correct, x.scored), (ms) => m(ms, (x) => x.correct / x.scored)));
  console.log(row("Coverage (committed / scored)", (x) => frac(x.committed, x.scored), (ms) => m(ms, (x) => x.committed / x.scored)));
  console.log(row("Committed accuracy", (x) => frac(x.committedCorrect, x.committed), (ms) => m(ms, (x) => x.committedCorrect / x.committed)));
  console.log(row("Silent errors (committed and wrong), count", (x) => String(x.silent.length), (ms) => mean(ms.map((x) => x.silent.length)).toFixed(1)));
  console.log(row("Items sent to human review", (x) => String(x.toReview), (ms) => mean(ms.map((x) => x.toReview)).toFixed(1)));
  console.log(row("System errors", (x) => String(x.errored.length), (ms) => mean(ms.map((x) => x.errored.length)).toFixed(1)));
  console.log(row("Retrieval correct (clause found or correct abstention)", (x) => frac(x.retOk, x.scored)));
  console.log(row("Verdict accuracy | retrieval correct", (x) => frac(x.vGivenOk, x.retOk)));
  console.log(row("Verdict accuracy | retrieval wrong", (x) => frac(x.vGivenBad, x.retBad)));
  console.log("\nSilent errors, by run:");
  [["v1", M1], ["v2", M2]].forEach(([l, ms]) => (ms as typeof M1).forEach((x, i) => console.log(`  ${l} run ${i + 1}: ${x.silent.join(", ") || "none"}`)));
  console.log("\nPer-class precision / recall (mean of the two runs in parentheses is the mean of the point estimates):");
  console.log("| class | support (v1 / v2) | v1 run 1 P / R | v1 run 2 P / R | v2 run 1 P / R | v2 run 2 P / R |\n|---|---|---|---|---|---|");
  V.forEach((c, k) => console.log(`| ${c} | ${M1[0].perClass[k].support} & ${M1[1].perClass[k].support} / ${M2[0].perClass[k].support} & ${M2[1].perClass[k].support} | ` +
    [...M1, ...M2].map((x) => { const p = x.perClass[k]; return `${pc(p.precision)} (${p.tp}/${p.tp + p.fp}) / ${pc(p.recall)} (${p.tp}/${p.tp + p.fn})`; }).join(" | ") + " |"));
  console.log("\nConfusion matrices (rows = human reference, cols = predicted: conformant, gap, insufficient):");
  [["v1", M1], ["v2", M2]].forEach(([l, ms]) => (ms as typeof M1).forEach((x, i) => console.log(`  ${l} run ${i + 1}: ` + V.map((g) => `${g}: [${V.map((p) => x.conf[g][p]).join(", ")}]`).join("  "))));
  console.log("\nAgreement between the two runs:");
  [["v1", v1], ["v2", v2]].forEach(([l, rs]) => { const a = agreement((rs as Run[])[0], (rs as Run[])[1]);
    console.log(`  ${l}: verdict, ERROR as its own state, all items ${frac(a.all, a.nAll)}; verdict over items scored in both ${frac(a.scored, a.nScored)}; cited clause (items citing in both) ${frac(a.clause, a.nClause)}`); });
}
if (process.argv[1]?.endsWith("eval-compare.ts")) main();
