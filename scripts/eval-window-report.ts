// Citation-window ablation on the 17 gold-"conformant" items: 4000-character arm (items of the two existing v2 passes) vs
// 500-character arm (two new passes). Read-only: writes nothing.
//   npx tsx scripts/eval-window-report.ts [--a4000 f1 f2] [--a500 f1 f2] [--focus R11,R12,R16,R32]
// The two arms were NOT run at the same time (the 4000 arm is the v2 evaluation of 2026-10-06, the 500 arm a later run).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { frac } from "./eval-compare";

type Item = { id: string; gold_verdict: string; raw_verdict?: string; pred_verdict: string; pred_clause: string | null; gold_clause: string | null; clause_outcome: string;
  assessor_confidence: number; verifier_agrees: boolean; review_required: boolean; review_reason?: string | null; error?: string; system_error?: boolean; verdict_correct: boolean };
type File = { items: Item[]; generations?: { item: string; cost?: number }[]; config?: { citationWindowChars?: number } };
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const ids: string[] = JSON.parse(readFileSync(here("../eval/conformant-subset.json"), "utf8")).ids;
const IDS = new Set(ids);
const arg = (name: string, n: number, d: string[]) => { const i = process.argv.indexOf(name); return i === -1 ? d : process.argv.slice(i + 1, i + 1 + n); };
const load = (fs: string[]) => fs.map((f) => JSON.parse(readFileSync(f, "utf8")) as File);
const arms = [
  { label: "500 characters", files: arg("--a500", 2, ["eval/results-v2-window500-1.json", "eval/results-v2-window500-2.json"]) },
  { label: "4000 characters (existing v2 passes)", files: arg("--a4000", 2, ["eval/results-v2-gapguard-1.json", "eval/results-v2-gapguard-2.json"]) },
];
const focus = arg("--focus", 1, ["R11,R12,R16,R32"])[0].split(",");

for (const arm of arms) {
  console.log(`\n=== Arm: ${arm.label}  [${arm.files.join(", ")}]`);
  load(arm.files).forEach((f, k) => {
    const items = f.items.filter((i) => IDS.has(i.id));
    const scored = items.filter((i) => !(i.error || i.system_error)), errs = items.filter((i) => i.error || i.system_error);
    const count = (v: string) => scored.filter((i) => i.pred_verdict === v).length;
    const conf = scored.filter((i) => i.pred_verdict === "conformant"), com = scored.filter((i) => !i.review_required), silent = com.filter((i) => !i.verdict_correct);
    const reasons: Record<string, number> = {}; scored.filter((i) => i.review_required).forEach((i) => { const r = i.review_reason ?? "?"; reasons[r] = (reasons[r] ?? 0) + 1; });
    const cost = f.generations ? f.generations.filter((g) => IDS.has(g.item)).reduce((s, g) => s + (g.cost ?? 0), 0) : null;
    console.log(`pass ${k + 1}: ${items.length} items, ${scored.length} scored, system errors: ${errs.length ? errs.map((i) => i.id).join(",") : "0"}${f.config?.citationWindowChars ? `, window=${f.config.citationWindowChars}` : ""}`);
    console.log(`   verdicts: conformant ${count("conformant")}, gap ${count("gap")}, insufficient ${count("insufficient")}`);
    console.log(`   conformant recall ${frac(conf.length, ids.length)}   committed ${com.length}/${scored.length} (${com.filter((i) => i.verdict_correct).length} correct; silent errors: ${silent.length ? silent.map((i) => `${i.id}→${i.pred_verdict}`).join(", ") : "none"})   committed conformant ${com.filter((i) => i.pred_verdict === "conformant").length}`);
    console.log(`   sent to review ${scored.length - com.length}: ${JSON.stringify(reasons)}   retrieval clause outcomes: ${JSON.stringify(scored.reduce((a: Record<string, number>, i) => { a[i.clause_outcome] = (a[i.clause_outcome] ?? 0) + 1; return a; }, {}))}`);
    console.log(`   real cost (OpenRouter generation records): ${cost === null ? "n/a (sanitised file)" : "$" + cost.toFixed(4)}`);
    console.log(`   focus: ` + focus.map((id) => { const i = items.find((x) => x.id === id)!; return `${id} ${i.error || i.system_error ? "ERROR" : `${i.pred_verdict} (assessor before guards: ${i.raw_verdict}) conf ${i.assessor_confidence}${i.review_required ? " [review: " + i.review_reason + "]" : " [committed]"} clause ${i.pred_clause ?? "none"}`}`; }).join(" | "));
  });
}
