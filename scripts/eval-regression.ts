// Regression gate on a FROZEN subset of the gold set, in NUMBER OF ERRORS.
//
// An "error" is a COMMITTED verdict (not sent to human review) that is wrong. The gate fails (exit 1) if a run
// has more committed errors on the frozen subset than the baseline's worst run plus MAX_EXTRA (default 1).
// Counting errors, not a percentage: with ~10 committed items a "5-point" threshold meant "zero tolerance", and
// temperature-0 LLM output flips ~1 item between identical runs. Coverage is reported (and a run that commits
// nothing fails, since "no errors" would then be vacuous).
//
//   npx tsx scripts/eval-regression.ts --selftest                      offline unit tests (run in CI)
//   npx tsx scripts/eval-regression.ts <results.json> [--max-extra-errors 1] [--baseline eval/baseline-frozen.json]
//   npx tsx scripts/eval-regression.ts --make-baseline <results.json> [<results2.json> ...]   one file per run
//
// Producing <results.json> needs the live stack (Neo4j + Qdrant + the 3GPP corpus + OpenRouter keys), which
// cannot run in public CI (the spec text is not redistributable):
//   npx tsx --env-file=.env.local scripts/eval.ts --ids-file eval/frozen-subset.json --out eval/results-frozen.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Item { id: string; verdict_correct: boolean; review_required: boolean; error?: string }
export interface RunStats { scored: number; committed: number; committedErrors: number; sentToReview: number }
export interface Baseline { runs: RunStats[]; worstCommittedErrors: number }

export function runStats(items: Item[], frozenIds: string[]): RunStats {
  const frozen = new Set(frozenIds);
  const scored = items.filter((i) => frozen.has(i.id) && !i.error);
  const committed = scored.filter((i) => !i.review_required);
  return { scored: scored.length, committed: committed.length, committedErrors: committed.filter((i) => !i.verdict_correct).length,
    sentToReview: scored.length - committed.length };
}

export function makeBaseline(runs: RunStats[]): Baseline {
  return { runs, worstCommittedErrors: Math.max(...runs.map((r) => r.committedErrors)) };
}

export function compare(baseline: Baseline, current: RunStats, maxExtra = 1): { pass: boolean; message: string } {
  const f = (r: RunStats) => `${r.committedErrors} committed error(s) / ${r.committed} committed / ${r.sentToReview} to review`;
  const msg = `${f(current)} vs baseline worst run ${baseline.worstCommittedErrors} (+${maxExtra} allowed)`;
  if (current.committed === 0) return { pass: false, message: `REGRESSION: nothing committed on the frozen subset (${current.scored} scored): "no errors" would be vacuous — ${msg}` };
  return current.committedErrors > baseline.worstCommittedErrors + maxExtra
    ? { pass: false, message: "REGRESSION: " + msg } : { pass: true, message: "ok: " + msg };
}

function selftest(): number {
  let failed = 0;
  const t = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) failed++; };
  const mk = (id: string, correct: boolean, review = false, error?: string): Item => ({ id, verdict_correct: correct, review_required: review, error });
  const ids = ["A", "B", "C", "D"];
  const s = runStats([mk("A", true), mk("B", false), mk("C", true, true), mk("Z", false), mk("D", false, false, "boom")], ids);
  t("only frozen, scored items count; errors = committed and wrong", s.committed === 2 && s.committedErrors === 1 && s.scored === 3 && s.sentToReview === 1);
  const base = makeBaseline([{ scored: 16, committed: 10, committedErrors: 1, sentToReview: 6 }, { scored: 16, committed: 11, committedErrors: 2, sentToReview: 5 }]);
  t("baseline = worst run", base.worstCommittedErrors === 2);
  const run = (e: number, c = 10): RunStats => ({ scored: 16, committed: c, committedErrors: e, sentToReview: 16 - c });
  t("same errors pass", compare(base, run(2)).pass);
  t("fewer errors pass", compare(base, run(0)).pass);
  t("one more error than the worst baseline run passes (noise allowance)", compare(base, run(3)).pass);
  const bad = compare(base, run(4));
  t("two more errors FAIL", !bad.pass && bad.message.startsWith("REGRESSION"));
  t("allowance is configurable", !compare(base, run(3), 0).pass && compare(base, run(4), 2).pass);
  t("committing nothing FAILS (vacuous zero errors)", !compare(base, run(0, 0)).pass);
  return failed;
}

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1]; }
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function main() {
  if (process.argv.includes("--selftest")) { process.exit(selftest() ? 1 : 0); }
  const frozen: string[] = read(fileURLToPath(new URL("../eval/frozen-subset.json", import.meta.url))).ids;
  const baselinePath = arg("--baseline") ?? fileURLToPath(new URL("../eval/baseline-frozen.json", import.meta.url));

  if (process.argv.includes("--make-baseline")) {
    const files = process.argv.slice(process.argv.indexOf("--make-baseline") + 1).filter((a) => !a.startsWith("--"));
    const b = makeBaseline(files.map((f) => runStats(read(f).items, frozen)));
    writeFileSync(baselinePath, JSON.stringify({ source: files, frozenSubset: "frozen-v1", ...b }, null, 2) + "\n");
    console.log(`baseline written to ${baselinePath}:`, JSON.stringify(b));
    return;
  }
  const resultsPath = process.argv[2];
  if (!resultsPath || resultsPath.startsWith("--")) { console.error("usage: eval-regression.ts <results.json> | --selftest | --make-baseline <results...>"); process.exit(2); }
  const r = compare(read(baselinePath), runStats(read(resultsPath).items, frozen), Number(arg("--max-extra-errors") ?? 1));
  console.log(r.message);
  process.exit(r.pass ? 0 : 1);
}
if (process.argv[1]?.endsWith("eval-regression.ts")) main();
