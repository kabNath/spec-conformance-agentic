// Offline replay of the guards on the stored assessor outputs ("ablation").
//   npx tsx scripts/eval-ablation.ts [--v2 a.public.json b.public.json]        replay from committed, sanitised files
//   npx tsx --env-file=.env.local scripts/eval-ablation.ts --collect         (once) fresh verifier calls for the counterfactual
//                                                                             states that were never observed; needs the raw
//                                                                             result files, the local corpus and the verifier env
// What is replayed: the verbatim guard and the gap guard, applied to the assessor's verdict BEFORE the guards (raw_verdict).
// What is NOT replayed: everything upstream (assessor prompt, citation window, retrieval, extractJSON fix) and the verifier model.
// The adversarial verifier's agreement depends on the verdict it is asked about; where a configuration puts a different verdict
// in front of it than the run did, its answer comes from a fresh call recorded in eval/ablation-verifier-calls.json (booleans only).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { frac } from "./eval-compare";

type Item = { id: string; gold_verdict: string; raw_verdict: string; pred_verdict: string; pred_clause: string | null; assessor_confidence: number;
  verifier_agrees: boolean; review_required: boolean; review_reason: string | null; gap_check: { outcome?: string } | null };
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CALLS = here("../eval/ablation-verifier-calls.json");
const REVIEW_THRESHOLD = 0.75;
const BLOCKS = new Set(["citation_not_verbatim", "citation_too_short", "gap_off_subject", "gap_no_contradiction", "gap_verifier_unusable", "verifier_same_family", "gap_not_grounded"]);

export interface Cfg { name: string; verbatim: boolean; gap: boolean }
export const CONFIGS: Cfg[] = [
  { name: "(a) no guard", verbatim: false, gap: false },
  { name: "(b) verbatim check only", verbatim: true, gap: false },
  { name: "(c) gap guard only", verbatim: false, gap: true },
  { name: "(d) both (= v2)", verbatim: true, gap: true },
];
export type CallKey = string;
export const key = (pass: number, id: string, verdict: string, quoteGiven: boolean): CallKey => `${pass}|${id}|${verdict}|${quoteGiven ? "quote" : "noquote"}`;

export interface Replayed { id: string; verdict: string; blocked: string | null; committed: boolean; reason: string | null; correct: boolean; needs?: CallKey }

/** One item under one configuration. `calls` maps counterfactual states to the verifier's recorded answer. */
export function replay(p: Item, cfg: Cfg, pass: number, calls: Record<CallKey, { agrees: boolean }>): Replayed {
  const hasCitation = p.pred_clause !== null;
  // the v2 runs recorded this guard as "citation_not_verbatim"; it is now "citation_too_short" when the quote is exact but short
  const verbatimFails = p.review_reason === "citation_not_verbatim" || p.review_reason === "citation_too_short";
  let verdict = p.raw_verdict, blocked: string | null = null;
  if (hasCitation && p.raw_verdict !== "insufficient") {
    if (cfg.verbatim && verbatimFails) { verdict = "insufficient"; blocked = p.review_reason; }
    else if (cfg.gap && p.raw_verdict === "gap") {
      if (verbatimFails) throw new Error(`${p.id}: gap guard needs a verbatim quote (not observed without the verbatim guard)`);
      const o = p.gap_check?.outcome;
      if (!o) throw new Error(`${p.id}: raw gap without a recorded gap check`);
      if (o !== "pass") { verdict = "insufficient"; blocked = o; }
    }
  }
  // the run's own verifier call was made on (pred_verdict, quote given unless a guard blocked)
  const observedBlocked = p.review_reason !== null && BLOCKS.has(p.review_reason);
  let agrees: boolean, needs: CallKey | undefined;
  if (verdict === p.pred_verdict && !!blocked === observedBlocked) agrees = p.verifier_agrees;
  else { needs = key(pass, p.id, verdict, !blocked); const c = calls[needs]; agrees = c ? c.agrees : true; if (!c) agrees = NaN as unknown as boolean; }
  let reason: string | null = null;
  if (!hasCitation) reason = "no_clause_found";
  else if (blocked) reason = blocked;
  else if (agrees === (NaN as unknown as boolean) || Number.isNaN(agrees as unknown as number)) reason = "MISSING_VERIFIER_CALL";
  else if (!agrees) reason = "verifier_disagreement";
  else if (p.assessor_confidence < REVIEW_THRESHOLD) reason = "low_confidence";
  return { id: p.id, verdict, blocked, committed: reason === null, reason, correct: verdict === p.gold_verdict, needs };
}

export function summarize(items: Item[], rs: Replayed[]) {
  const by = new Map(items.map((i) => [i.id, i]));
  const com = rs.filter((r) => r.committed), silent = com.filter((r) => !r.correct);
  const gp = com.filter((r) => r.verdict === "gap"), tg = gp.filter((r) => by.get(r.id)!.gold_verdict === "gap");
  const goldC = items.filter((i) => i.gold_verdict === "conformant"), goldG = items.filter((i) => i.gold_verdict === "gap");
  return { n: items.length, correct: rs.filter((r) => r.correct).length, committed: com.length, committedCorrect: com.length - silent.length,
    silent: silent.map((r) => `${r.id}(${by.get(r.id)!.gold_verdict}→${r.verdict})`),
    confRecallK: rs.filter((r) => by.get(r.id)!.gold_verdict === "conformant" && r.verdict === "conformant").length, confN: goldC.length,
    gapTrue: tg.length, gapCommitted: gp.length, gapGold: goldG.length, falseGaps: gp.filter((r) => by.get(r.id)!.gold_verdict !== "gap").map((r) => r.id) };
}

function main() {
  const a = process.argv.slice(2);
  const v2 = a.includes("--v2") ? a.slice(a.indexOf("--v2") + 1, a.indexOf("--v2") + 3) : ["eval/results-v2-gapguard-1.public.json", "eval/results-v2-gapguard-2.public.json"];
  const runs: Item[][] = v2.map((f) => JSON.parse(readFileSync(f, "utf8")).items);
  const calls: Record<CallKey, { agrees: boolean }> = existsSync(CALLS) ? JSON.parse(readFileSync(CALLS, "utf8")).calls : {};

  // sanity: configuration (d) must reproduce the run exactly
  let same = 0, total = 0;
  runs.forEach((items, k) => items.forEach((p) => { const r = replay(p, CONFIGS[3], k + 1, calls); total++; if (r.verdict === p.pred_verdict && r.committed === !p.review_required && (r.reason ?? null) === (p.review_reason ?? null)) same++; }));
  console.log(`Check — configuration (d) reproduces the recorded v2 outcome (verdict, committed or not, reason) for ${same}/${total} items in both passes.\n`);

  console.log("| configuration | pass | accuracy N=40 | coverage | committed accuracy [Wilson 95 %] | silent errors (committed and wrong) | conformant recall | gap recall (true gaps committed / gold gaps) | gap precision (true / committed gaps) | false gaps committed |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const cfg of CONFIGS) runs.forEach((items, k) => {
    const rs = items.map((p) => replay(p, cfg, k + 1, calls)); const s = summarize(items, rs);
    const miss = rs.filter((r) => r.reason === "MISSING_VERIFIER_CALL").map((r) => r.needs);
    console.log(`| ${cfg.name} | ${k + 1} | ${frac(s.correct, s.n)} | ${frac(s.committed, s.n)} | ${frac(s.committedCorrect, s.committed)} | ${s.silent.length ? s.silent.join(", ") : "none"} | ${frac(s.confRecallK, s.confN)} | ${frac(s.gapTrue, s.gapGold)} | ${s.gapCommitted ? frac(s.gapTrue, s.gapCommitted) : "n/a (0 committed gaps)"} | ${s.falseGaps.length ? s.falseGaps.join(", ") : "none"}${miss.length ? ` | MISSING CALLS: ${miss.join(" ")}` : ""} |`);
  });

  const focus = (process.argv.includes("--items") ? process.argv[process.argv.indexOf("--items") + 1] : "R11,R12,R16,R28,R32").split(",");
  console.log("\nPer item (verdict / outcome under each configuration):\n\n| item (gold) | pass | assessor before guards | " + CONFIGS.map((c) => c.name).join(" | ") + " | which guard changed it |\n|---|---|---|" + CONFIGS.map(() => "---").join("|") + "|---|");
  for (const id of focus) runs.forEach((items, k) => {
    const p = items.find((i) => i.id === id)!; const rs = CONFIGS.map((c) => replay(p, c, k + 1, calls));
    const cell = (r: Replayed) => `${r.verdict} / ${r.committed ? "committed" : "review: " + r.reason}`;
    const sig = (r: Replayed) => `${r.verdict}|${r.reason}`;
    const verb = sig(rs[0]) !== sig(rs[1]), gap = sig(rs[0]) !== sig(rs[2]);
    const which = verb && gap ? "both" : verb ? "verbatim check" : gap ? "gap guard" : "none: the assessor's own output, retrieval and confidence rule";
    console.log(`| ${id} (${p.gold_verdict}) | ${k + 1} | ${p.raw_verdict}, conf ${p.assessor_confidence}${p.pred_clause ? "" : ", no clause"} | ${rs.map(cell).join(" | ")} | ${which} |`);
  });
}
if (process.argv[1]?.endsWith("eval-ablation.ts") && !process.argv.includes("--collect")) main();
