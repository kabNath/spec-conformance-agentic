// Collects the verifier answers the ablation needs but the runs never produced (VERIFIER calls only, no assessor call).
//   npx tsx --env-file=.env.local scripts/eval-ablation-collect.ts
// Needs: the raw result files (quote), eval/gold-set.json (requirement), the local spec extract (clause text),
// OPENROUTER_VERIFIER_MODEL / OPENROUTER_VERIFIER_PROVIDER in the environment. Only booleans/numbers are stored.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSpec } from "../lib/parser-3gpp";
import { selectWindow } from "../lib/citation-window";
import { citationDisplay, type ClauseCitation, type NormativeKeyword } from "../lib/conformance-contract";
import { verify } from "../lib/graph/nodes/verify";
import { callLog, verifierModel, verifierProviderPin } from "../lib/clients/openrouter";
import { CONFIGS, replay, key } from "./eval-ablation";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const MAX_CALLS = 14;

(async () => {
  const pub = [1, 2].map((n) => JSON.parse(readFileSync(here(`../eval/results-v2-gapguard-${n}.public.json`), "utf8")).items);
  const raw = [1, 2].map((n) => JSON.parse(readFileSync(here(`../eval/results-v2-gapguard-${n}.json`), "utf8")).items);
  const gold = JSON.parse(readFileSync(here("../eval/gold-set.json"), "utf8"));
  const req = new Map<string, string>(gold.requirements.map((r: { id: string; requirement: string }) => [r.id, r.requirement]));
  const tree = parseSpec(readFileSync(here("../examples/ts38331-extract.txt"), "utf8"), { spec: "TS 38.331", version: "19.3.0", release: "Rel-19" });

  // which counterfactual states does the replay need?
  const need = new Map<string, { pass: number; id: string; verdict: string; quoteGiven: boolean }>();
  for (const cfg of CONFIGS) pub.forEach((items, k) => items.forEach((p: never) => {
    const r = replay(p, cfg, k + 1, {}); if (r.needs) { const [, id, verdict, q] = r.needs.split("|"); need.set(r.needs, { pass: k + 1, id, verdict, quoteGiven: q === "quote" }); }
  }));
  console.log(`${need.size} counterfactual verifier call(s) needed; verifier=${verifierModel()}; provider pin=${JSON.stringify(verifierProviderPin())}`);
  if (!verifierModel() || !verifierProviderPin()) throw new Error("set OPENROUTER_VERIFIER_MODEL and OPENROUTER_VERIFIER_PROVIDER");
  if (need.size > MAX_CALLS) throw new Error(`refusing: ${need.size} calls > ${MAX_CALLS}`);

  const calls: Record<string, { agrees: boolean; confidence: number; provider?: string; cost?: number }> = {};
  for (const [k, n] of need) {
    const r = raw[n.pass - 1].find((i: { id: string }) => i.id === n.id);
    const full = String(tree.nodes[r.pred_clause].text);
    const win = selectWindow(full, req.get(n.id)!);
    const base = { spec: "TS 38.331", version: "19.3.0", release: "Rel-19", clause: r.pred_clause, text: win.text, normative: (tree.nodes[r.pred_clause].normative ?? "none") as NormativeKeyword };
    const citation: ClauseCitation = { ...base, display: citationDisplay(base) };
    const before = callLog.length;
    const v = await verify(req.get(n.id)!, n.verdict as never, [citation], n.quoteGiven ? r.assessor_quote : undefined);
    const id = callLog[before]?.id;
    let provider: string | undefined, cost: number | undefined;
    for (let a = 0; a < 8 && id; a++) {
      const g = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
      if (g.ok) { const d = (await g.json()).data; provider = d.provider_name; cost = d.total_cost; break; }
      await new Promise((s) => setTimeout(s, 1500));
    }
    calls[k] = { agrees: v.agrees, confidence: v.confidence, provider, cost };
    console.log(`  ${k} → agrees=${v.agrees} conf=${v.confidence} provider=${provider} cost=$${cost}`);
  }
  const total = Object.values(calls).reduce((s, c) => s + (c.cost ?? 0), 0);
  writeFileSync(here("../eval/ablation-verifier-calls.json"), JSON.stringify({ _note: "Fresh verifier calls for counterfactual states of eval-ablation.ts. Booleans and numbers only.",
    verifier: verifierModel(), provider_pin: verifierProviderPin(), total_cost_usd: Number(total.toFixed(5)), calls }, null, 2) + "\n");
  console.log(`done: ${Object.keys(calls).length} calls, total $${total.toFixed(5)} (cap $0.50)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
