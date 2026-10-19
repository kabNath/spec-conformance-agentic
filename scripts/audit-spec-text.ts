// Per-file, per-field audit of spec-text spans (≥ 9 consecutive words) in tracked files. Prints counts and lengths only,
// never the text. Run: npx tsx scripts/audit-spec-text.ts <file>... [--corpus examples/ts38331-extract.txt]
import { readFileSync } from "node:fs";
import { ngramSet, findSpans, WINDOW } from "./check-no-spec-text";

const wordsOf = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).length;
/** Longest run (in words) made of overlapping flagged windows. */
function longestRun(hits: number[], n = WINDOW): number {
  let best = 0, run = 0, prev = -2;
  for (const h of hits) { run = h === prev + 1 ? run + 1 : 1; prev = h; best = Math.max(best, run + n - 1); }
  return best;
}
type Agg = Record<string, { strings: number; flagged: number; longest: number; wordsInFlagged: number }>;
function walk(spec: Set<string>, v: unknown, field: string, agg: Agg) {
  if (typeof v === "string") {
    const a = (agg[field] ??= { strings: 0, flagged: 0, longest: 0, wordsInFlagged: 0 }); a.strings++;
    const h = findSpans(spec, v); if (h.length) { a.flagged++; a.longest = Math.max(a.longest, longestRun(h)); a.wordsInFlagged += wordsOf(v); }
  } else if (Array.isArray(v)) v.forEach((x) => walk(spec, x, field, agg));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(spec, x, k, agg);
}
const a = process.argv.slice(2);
const ci = a.indexOf("--corpus"); const corpus = ci === -1 ? "examples/ts38331-extract.txt" : a[ci + 1];
const files = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--corpus");
const spec = ngramSet(readFileSync(corpus, "utf8"));
for (const f of files) {
  const text = readFileSync(f, "utf8"); const agg: Agg = {};
  if (f.endsWith(".json")) walk(spec, JSON.parse(text), "$", agg);
  else { const h = findSpans(spec, text); if (h.length) agg["(whole text)"] = { strings: 1, flagged: 1, longest: longestRun(h), wordsInFlagged: wordsOf(text) }; }
  const hit = Object.entries(agg).filter(([, v]) => v.flagged);
  if (!hit.length) { console.log(`✓ ${f}`); continue; }
  console.log(`✗ ${f}`);
  for (const [k, v] of hit) console.log(`    field "${k}": ${v.flagged}/${v.strings} strings contain spec spans; longest copied run ${v.longest} words`);
}
