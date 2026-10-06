// Offline tests for the guard-ablation replay (committed sanitised results + recorded verifier answers; no network).
// Run: npx tsx scripts/test-ablation.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIGS, replay, key } from "./eval-ablation";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };
const base = { id: "X", gold_verdict: "insufficient", raw_verdict: "gap", pred_verdict: "insufficient", pred_clause: "5.3", assessor_confidence: 0.97,
  verifier_agrees: true, review_required: true, review_reason: "gap_off_subject", gap_check: { outcome: "gap_off_subject" } };
const [A, B, C, D] = CONFIGS;

// a raw gap on an out-of-scope item that the gap guard blocked
const calls = { [key(1, "X", "gap", true)]: { agrees: true } };
check("no guard: the false gap commits when the verifier agrees", replay(base, A, 1, calls).committed && replay(base, A, 1, calls).verdict === "gap");
check("gap guard blocks it (with or without the verbatim check)", [C, D].every((c) => !replay(base, c, 1, calls).committed && replay(base, c, 1, calls).reason === "gap_off_subject"));
check("verbatim check alone does not stop it", replay(base, B, 1, calls).committed);
check("a verifier that disagrees sends the ungarded gap to review", replay(base, A, 1, { [key(1, "X", "gap", true)]: { agrees: false } }).reason === "verifier_disagreement");
check("a counterfactual state without a recorded call is flagged, never guessed", replay(base, A, 1, {}).reason === "MISSING_VERIFIER_CALL");
const nov = { ...base, raw_verdict: "conformant", gold_verdict: "conformant", review_reason: "citation_not_verbatim", gap_check: null };
check("verbatim failure: blocked by (b)/(d), passes through in (a)/(c)", replay(nov, B, 1, {}).reason === "citation_not_verbatim" && replay(nov, D, 1, {}).reason === "citation_not_verbatim" &&
  replay(nov, A, 1, { [key(1, "X", "conformant", true)]: { agrees: true } }).committed);
check("no clause retrieved → review in every configuration", CONFIGS.every((c) => replay({ ...base, pred_clause: null, raw_verdict: "insufficient", review_reason: "no_clause_found", gap_check: null }, c, 1, {}).reason === "no_clause_found"));
check("low assessor confidence → review in every configuration", CONFIGS.every((c) => replay({ ...base, raw_verdict: "insufficient", review_reason: "low_confidence", assessor_confidence: 0.4, gap_check: null }, c, 1, {}).reason === "low_confidence"));

// the committed data: configuration (d) must reproduce both v2 passes, and no configuration may lack a verifier answer
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const runs = [1, 2].map((n) => JSON.parse(readFileSync(here(`../eval/results-v2-gapguard-${n}.public.json`), "utf8")).items);
const rec = JSON.parse(readFileSync(here("../eval/ablation-verifier-calls.json"), "utf8")).calls;
let same = 0, total = 0, missing = 0;
runs.forEach((items: any[], k) => items.forEach((p) => { total++;
  const d = replay(p, D, k + 1, rec); if (d.verdict === p.pred_verdict && d.committed === !p.review_required && (d.reason ?? null) === (p.review_reason ?? null)) same++;
  CONFIGS.forEach((c) => { if (replay(p, c, k + 1, rec).reason === "MISSING_VERIFIER_CALL") missing++; }); }));
check(`committed v2 runs: configuration (d) reproduces ${total}/${total} item outcomes`, same === total, `${same}/${total}`);
check("committed v2 runs: every counterfactual state has a recorded verifier answer", missing === 0, `${missing} missing`);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall ablation tests passed");
