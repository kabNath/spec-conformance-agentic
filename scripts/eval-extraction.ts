// Measures the requirement-extraction step (lib/graph/nodes/extract.ts) on demo/extraction-set/: recall and precision with
// 95 % Wilson intervals. THIS CALLS THE LLM (paid). It has NOT been run.
//
//   npx tsx --env-file=.env.local scripts/eval-extraction.ts [--passes 1] [--out eval/extraction-results.json]
//   npx tsx scripts/eval-extraction.ts --estimate            cost estimate only, no LLM call
//
// COST ESTIMATE (Claude Sonnet 4.6 via OpenRouter, $3 / $15 per million input / output tokens), per pass of 15 documents:
//   ~350 input tokens + ~300 output tokens per document  =>  ~$0.0056 per document  =>  ~$0.08 per pass
//   (range $0.06 - $0.16 including the one automatic retry when the reply is not parseable JSON).
// Before any run, a human must validate the expected lists (demo/extraction-set/README.md).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractNode } from "../lib/graph/nodes/extract";
import { fraction, matchRequirements } from "../lib/extraction-match";

const dir = fileURLToPath(new URL("../demo/extraction-set/", import.meta.url));
const a = process.argv.slice(2);
const arg = (n: string, d: string) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const docs = readdirSync(dir).filter((f) => f.endsWith(".expected.json")).sort().map((f) => JSON.parse(readFileSync(dir + f, "utf8")) as
  { id: string; document: string; requirements: { text: string }[] });

if (a.includes("--estimate")) {
  const perDoc = (350 / 1e6) * 3 + (300 / 1e6) * 15;
  console.log(`${docs.length} documents, ${docs.reduce((s, d) => s + d.requirements.length, 0)} expected requirements; ~$${perDoc.toFixed(4)} per document, ~$${(perDoc * docs.length).toFixed(2)} per pass (range $0.06–$0.16)`);
  process.exit(0);
}

(async () => {
  const passes = Number(arg("--passes", "1"));
  const results: unknown[] = [];
  let tp = 0, expected = 0, extractedN = 0;
  for (let p = 1; p <= passes; p++) {
    for (const d of docs) {
      const text = readFileSync(dir + d.document, "utf8");
      const r = await extractNode({ implDocText: text, implDocName: d.document } as never);
      const got = ((r.requirements ?? []) as { requirement: string }[]).map((x) => x.requirement);
      const m = matchRequirements(d.requirements.map((x) => x.text), got);
      tp += m.pairs.length; expected += d.requirements.length; extractedN += got.length;
      results.push({ pass: p, doc: d.id, expected: d.requirements.length, extracted: got.length, matched: m.pairs.length, missed: m.missed.map((i) => d.requirements[i].text), extra: m.extra.map((j) => got[j]) });
      console.log(`pass ${p} ${d.id}: expected ${d.requirements.length}, extracted ${got.length}, matched ${m.pairs.length}`);
    }
  }
  console.log(`\nRecall    ${fraction(tp, expected)}\nPrecision ${fraction(tp, extractedN)}\n(counts pooled over ${passes} pass(es) and ${docs.length} documents; documents and passes are not independent samples)`);
  writeFileSync(arg("--out", "eval/extraction-results.json"), JSON.stringify({ passes, tp, expected, extracted: extractedN, results }, null, 2) + "\n");
})();
