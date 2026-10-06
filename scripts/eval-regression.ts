// Regression gate on a FROZEN subset of the gold set.
//
// Fails (exit 1) if the accuracy of COMMITTED verdicts (not flagged for review) on the frozen subset
// drops by more than TOLERANCE (default 5 points) below the baseline.
//
//   npx tsx scripts/eval-regression.ts --selftest                      offline unit tests (run in CI)
//   npx tsx scripts/eval-regression.ts <results.json> [--tolerance 0.05] [--baseline eval/baseline-frozen.json]
//   npx tsx scripts/eval-regression.ts --make-baseline <results.json> [<results2.json> ...]   (re)create the baseline
//
// Producing <results.json> needs the live stack (Neo4j + Qdrant + the 3GPP corpus + OpenRouter keys), which
// cannot run in public CI (the spec text is not redistributable):
//   npx tsx --env-file=.env.local scripts/eval.ts --ids-file eval/frozen-subset.json --out eval/results-frozen.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Item { id: string; verdict_correct: boolean; review_required: boolean; error?: string }
export interface Committed { committed: number; correct: number; accuracy: number | null; scored: number }

export function committedStats(items: Item[], frozenIds: string[]): Committed {
  const frozen = new Set(frozenIds);
  const scored = items.filter((i) => frozen.has(i.id) && !i.error);
  const committed = scored.filter((i) => !i.review_required);
  const correct = committed.filter((i) => i.verdict_correct).length;
  return { committed: committed.length, correct, accuracy: committed.length ? correct / committed.length : null, scored: scored.length };
}

export function compare(baseline: Committed, current: Committed, tolerance = 0.05): { pass: boolean; message: string } {
  if (baseline.accuracy === null) return { pass: false, message: "baseline has no committed verdicts: recreate it with --make-baseline" };
  if (current.accuracy === null) return { pass: false, message: `no committed verdicts on the frozen subset (${current.scored} scored): cannot establish accuracy` };
  const drop = baseline.accuracy - current.accuracy;
  const fmt = (c: Committed) => `${(100 * c.accuracy!).toFixed(1)}% (${c.correct}/${c.committed})`;
  const msg = `committed accuracy ${fmt(current)} vs baseline ${fmt(baseline)}: ${drop > 0 ? "−" : "+"}${(100 * Math.abs(drop)).toFixed(1)} pts (tolerance ${(100 * tolerance).toFixed(0)})`;
  // small epsilon: 0.05 must not fail on floating-point noise
  return drop > tolerance + 1e-9 ? { pass: false, message: "REGRESSION: " + msg } : { pass: true, message: "ok: " + msg };
}

function selftest(): number {
  let failed = 0;
  const t = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) failed++; };
  const mk = (id: string, correct: boolean, review = false, error?: string): Item => ({ id, verdict_correct: correct, review_required: review, error });
  const ids = ["A", "B", "C", "D"];
  const s = committedStats([mk("A", true), mk("B", false), mk("C", true, true), mk("Z", false), mk("D", false, false, "boom")], ids);
  t("only frozen, scored, committed items count", s.committed === 2 && s.correct === 1 && s.scored === 3 && s.accuracy === 0.5);
  const base: Committed = { committed: 20, correct: 16, accuracy: 0.8, scored: 20 };
  t("equal accuracy passes", compare(base, base).pass);
  t("improvement passes", compare(base, { committed: 10, correct: 10, accuracy: 1, scored: 10 }).pass);
  t("drop of exactly 5 points passes", compare(base, { committed: 20, correct: 15, accuracy: 0.75, scored: 20 }).pass);
  const bad = compare(base, { committed: 20, correct: 14, accuracy: 0.7, scored: 20 });
  t("drop of 10 points FAILS", !bad.pass && bad.message.startsWith("REGRESSION"));
  t("5.1-point drop FAILS", !compare(base, { committed: 1000, correct: 749, accuracy: 0.749, scored: 1000 }).pass);
  t("no committed verdicts FAILS", !compare(base, { committed: 0, correct: 0, accuracy: null, scored: 16 }).pass);
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
    const items: Item[] = files.flatMap((f) => read(f).items);
    const stats = committedStats(items, frozen);
    writeFileSync(baselinePath, JSON.stringify({ source: files, frozenSubset: "frozen-v1", ...stats }, null, 2) + "\n");
    console.log(`baseline written to ${baselinePath}:`, stats);
    return;
  }
  const resultsPath = process.argv[2];
  if (!resultsPath || resultsPath.startsWith("--")) { console.error("usage: eval-regression.ts <results.json> | --selftest | --make-baseline <results...>"); process.exit(2); }
  const tolerance = Number(arg("--tolerance") ?? 0.05);
  const r = compare(read(baselinePath), committedStats(read(resultsPath).items, frozen), tolerance);
  console.log(r.message);
  process.exit(r.pass ? 0 : 1);
}
if (process.argv[1]?.endsWith("eval-regression.ts")) main();
