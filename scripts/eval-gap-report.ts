// Pre-registered analysis of the GAP_GUARD evaluation (see eval/PREREGISTRATION-gap-guard.md).
//   npx tsx scripts/eval-gap-report.ts eval/results-v2-gapguard-1.json [eval/results-v2-gapguard-2.json]
// Groups: DEV = the 16 items of eval/frozen-subset.json (already seen in earlier runs); TEST = the other 24.
// Definitions (fixed before the run):
//   committed       = not sent to human review (review_required === false)
//   committed gap   = pred_verdict === "gap" && committed
//   true gap        = committed gap with gold verdict "gap";  FALSE GAP = committed gap with gold verdict != "gap"
//   gap recall      = true gaps / gold gaps among scored items;  gap precision = true gaps / committed gaps
//   coverage        = committed / scored (system-error items are not scored)
// PRIMARY criterion: zero false gaps committed over all 40 items, in every pass.
// SECONDARY criterion: number of true gaps committed (reported as counts, per group and per pass).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Item { id: string; gold_verdict: string; pred_verdict: string; raw_verdict?: string; review_required: boolean; review_reason?: string; error?: string; system_error?: boolean; gap_check?: { outcome?: string } }
const ids: string[] = JSON.parse(readFileSync(fileURLToPath(new URL("../eval/frozen-subset.json", import.meta.url)), "utf8")).ids;
const DEV = new Set(ids);

function stats(items: Item[]) {
  const scored = items.filter((i) => !(i.error || i.system_error));
  const committed = scored.filter((i) => !i.review_required);
  const gap = committed.filter((i) => i.pred_verdict === "gap");
  const trueGaps = gap.filter((i) => i.gold_verdict === "gap");
  const falseGaps = gap.filter((i) => i.gold_verdict !== "gap");
  const goldGaps = scored.filter((i) => i.gold_verdict === "gap");
  const raw = scored.filter((i) => i.raw_verdict === "gap");
  const blocked: Record<string, number> = {};
  for (const i of raw) if (i.review_required || i.pred_verdict !== "gap") { const k = i.gap_check?.outcome && i.gap_check.outcome !== "pass" ? i.gap_check.outcome : (i.review_reason ?? "other"); blocked[k] = (blocked[k] ?? 0) + 1; }
  return { n: items.length, scored: scored.length, systemErrors: items.filter((i) => i.error || i.system_error).map((i) => i.id),
    committed: committed.length, coverage: scored.length ? committed.length / scored.length : 0,
    goldGaps: goldGaps.length, rawGaps: raw.length, rawGapsTrue: raw.filter((i) => i.gold_verdict === "gap").length,
    committedGaps: gap.length, trueGaps: trueGaps.length, falseGaps: falseGaps.length, falseGapIds: falseGaps.map((i) => i.id),
    trueGapIds: trueGaps.map((i) => i.id), missedGoldGapIds: goldGaps.filter((i) => !trueGaps.includes(i)).map((i) => i.id),
    recall: goldGaps.length ? trueGaps.length / goldGaps.length : null, precision: gap.length ? trueGaps.length / gap.length : null, blocked };
}
const pct = (x: number | null) => (x === null ? "n/a" : (100 * x).toFixed(0) + "%");
function show(label: string, s: ReturnType<typeof stats>) {
  console.log(`\n${label}: ${s.scored} scored${s.systemErrors.length ? ` (+${s.systemErrors.length} system error: ${s.systemErrors.join(",")})` : ""}`);
  console.log(`  coverage ${s.committed}/${s.scored} = ${pct(s.coverage)}   gold gaps ${s.goldGaps}   raw gaps (assessor) ${s.rawGaps} (${s.rawGapsTrue} true)`);
  console.log(`  committed gaps ${s.committedGaps}: TRUE ${s.trueGaps} [${s.trueGapIds.join(" ")}]  FALSE ${s.falseGaps} [${s.falseGapIds.join(" ")}]`);
  console.log(`  gap recall ${s.trueGaps}/${s.goldGaps} = ${pct(s.recall)}   gap precision ${s.trueGaps}/${s.committedGaps} = ${pct(s.precision)}   missed gold gaps [${s.missedGoldGapIds.join(" ")}]`);
  console.log(`  raw gaps not committed, by reason: ${JSON.stringify(s.blocked)}`);
}

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: eval-gap-report.ts <results.json> [...]"); process.exit(2); }
let totalFalse = 0, totalTrue = 0;
files.forEach((f, k) => {
  const items: Item[] = JSON.parse(readFileSync(f, "utf8")).items;
  console.log(`\n================ pass ${k + 1}: ${f}`);
  const all = stats(items), dev = stats(items.filter((i) => DEV.has(i.id))), test = stats(items.filter((i) => !DEV.has(i.id)));
  show("ALL 40", all); show("DEV (16 items already seen)", dev); show("TEST (24 other items)", test);
  totalFalse += all.falseGaps; totalTrue += all.trueGaps;
});
console.log(`\nPRIMARY criterion (zero false gaps committed, all passes): ${totalFalse === 0 ? "MET" : "NOT MET"} — ${totalFalse} false gap(s) committed across ${files.length} pass(es)`);
console.log(`SECONDARY (true gaps committed, summed over passes, counts only): ${totalTrue}`);
