// Norm column, before/after, from a STORED run (no LLM call): recomputes the value with lib/normative.ts using the stored verified
// excerpt when there is one, else the text of the clause (read from the invented demo extract).
//   npx tsx scripts/demo-normative-before-after.ts <runId> [--api http://localhost:3000]
import { readFileSync } from "node:fs";
import { parseSpec } from "../lib/parser-3gpp";
import { governingNormative } from "../lib/normative";

(async () => {
  const a = process.argv.slice(2);
  const api = a.includes("--api") ? a[a.indexOf("--api") + 1] : "http://localhost:3000";
  const run = await (await fetch(`${api}/api/runs/${a[0]}`)).json();
  const tree = parseSpec(readFileSync("examples/ts38331-extrait.txt", "utf8"), { spec: "LCP Demo", version: "1.0", release: "demo" });
  console.log("| # | requirement | clause | stored (before) | governing sentence basis | after | governing segment (start) |\n|---|---|---|---|---|---|---|");
  run.requirements.forEach((r: any, i: number) => {
    const c = r.citations[0];
    if (!c) { console.log(`| ${i + 1} | ${r.requirement.slice(0, 60)} | — | ${r.normative} | no clause | ${r.normative} | — |`); return; }
    const basis = c.excerpt ? "verified excerpt" : "clause text";
    const g = governingNormative(c.excerpt ?? String(tree.nodes[c.clause].text), r.requirement);
    console.log(`| ${i + 1} | ${r.requirement.slice(0, 60)}… | ${c.clause} | ${r.normative} | ${basis} | ${g ? g.force : r.normative + " (kept: no overlap)"} | ${g ? "“" + g.segment.slice(0, 48) + "…”" : "—"} |`);
  });
})();
