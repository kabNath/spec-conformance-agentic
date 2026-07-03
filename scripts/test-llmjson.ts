// Offline unit test for the JSON extraction in llmJSON — no OpenRouter calls.
// Feeds "dirty" LLM replies (prose/fences around the JSON) and asserts the
// extracted+parsed value matches. Run: npx tsx scripts/test-llmjson.ts
import { extractJSON } from "../lib/json";

const cases: { name: string; raw: string; expect: unknown }[] = [
  { name: "clean object", raw: `{"a":1}`, expect: { a: 1 } },
  {
    // The exact failure: valid JSON, newline, then a trailing sentence (line 3).
    name: "trailing prose after JSON",
    raw: `{"agrees":true,"confidence":0.9,"note":"ok"}\nThis clause supports the verdict.`,
    expect: { agrees: true, confidence: 0.9, note: "ok" },
  },
  { name: "```json fences```", raw: "```json\n{\"verdict\":\"gap\"}\n```", expect: { verdict: "gap" } },
  { name: "leading prose", raw: `Here is the result: {"verdict":"conformant"}`, expect: { verdict: "conformant" } },
  {
    name: "extract shape + trailing note",
    raw: `{"requirements":[{"requirement":"UE shall X","section":"3.1"}]}\nDone.`,
    expect: { requirements: [{ requirement: "UE shall X", section: "3.1" }] },
  },
  { name: "bare fences (no json tag)", raw: "```\n{\"action\":\"read\",\"clause\":\"5.3.3\"}\n```", expect: { action: "read", clause: "5.3.3" } },
];

let failed = 0;
for (const c of cases) {
  try {
    const got = JSON.parse(extractJSON(c.raw));
    const ok = JSON.stringify(got) === JSON.stringify(c.expect);
    console.log(`${ok ? "✅" : "❌"} ${c.name}`);
    if (!ok) { failed++; console.log(`   attendu ${JSON.stringify(c.expect)}\n   obtenu ${JSON.stringify(got)}`); }
  } catch (e) {
    failed++;
    console.log(`❌ ${c.name} — THROW: ${(e as Error).message}`);
  }
}
console.log(failed === 0 ? `\nTous les cas passent (${cases.length}/${cases.length}) ✅` : `\n${failed} échec(s) ❌`);
process.exit(failed === 0 ? 0 : 1);
