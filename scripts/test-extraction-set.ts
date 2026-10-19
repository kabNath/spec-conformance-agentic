// Offline tests: the extraction test set is well-formed, and the scorer behaves (no LLM, free).
// Run: npx tsx scripts/test-extraction-set.ts      (does NOT run scripts/eval-extraction.ts)
import { readFileSync, readdirSync } from "node:fs";
import { matchRequirements, fraction, wilson, dice } from "../lib/extraction-match";
import { salientTerms } from "../lib/citation-check";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };
const dir = "demo/extraction-set/";
const files = readdirSync(dir).filter((f) => f.endsWith(".expected.json")).sort();
const docs = files.map((f) => JSON.parse(readFileSync(dir + f, "utf8")));

check("15 documents", docs.length === 15);
check("every document file exists, has 3 to 6 sentences, and its sentences are exactly those of the text", docs.every((d) => {
  const text = readFileSync(dir + d.document, "utf8"); const n = d.sentences.length;
  return n >= 3 && n <= 6 && d.sentences.every((s: string) => text.includes(s));
}));
check("ids are unique and sequential (doc-01 … doc-15)", docs.map((d) => d.id).join() === Array.from({ length: 15 }, (_, i) => `doc-${String(i + 1).padStart(2, "0")}`).join());
check("every expected requirement points to an existing source sentence that is not a non-requirement", docs.every((d) =>
  d.requirements.every((r: { source_sentence: number }) => r.source_sentence >= 1 && r.source_sentence <= d.sentences.length && !d.non_requirement_sentences.includes(r.source_sentence))));
check("every sentence is either a source of expected requirements or marked non-requirement (no unaccounted sentence)", docs.every((d) =>
  d.sentences.every((_: string, i: number) => d.non_requirement_sentences.includes(i + 1) || d.requirements.some((r: { source_sentence: number }) => r.source_sentence === i + 1))));
check("each expected requirement draws its words from its source sentence (≥ 50 % of its salient terms, ignoring \"terminal\": pronouns and verb forms are rewritten)", docs.every((d) =>
  d.requirements.every((r: { text: string; source_sentence: number }) => {
    const rt = [...salientTerms(r.text)].filter((t) => t !== "terminal"), st = salientTerms(d.sentences[r.source_sentence - 1]);
    return rt.filter((t) => st.has(t)).length / rt.length >= 0.5;
  })));
check("65 expected atomic requirements in total", docs.reduce((s, d) => s + d.requirements.length, 0) === 65);
check("compound sentences are split (some sentence yields ≥ 2 requirements) and non-requirements exist", docs.some((d) => d.requirements.filter((r: { source_sentence: number }) => r.source_sentence === 1).length >= 2) &&
  docs.reduce((s, d) => s + d.non_requirement_sentences.length, 0) >= 10);
check("mentions the invented protocol only (no 3GPP identifiers)", !docs.some((d) => /TS ?38|RRC|3GPP|\bUE\b/.test(JSON.stringify(d))));

// scorer
const exp = docs[2].requirements.map((r: { text: string }) => r.text);
let m = matchRequirements(exp, exp);
check("perfect extraction → recall 100 % and precision 100 % (all matched, none missed, none extra)", m.pairs.length === exp.length && !m.missed.length && !m.extra.length);
m = matchRequirements(exp, exp.slice(0, 3));
check("two requirements not extracted → 2 missed", m.missed.length === 2 && m.extra.length === 0);
m = matchRequirements(exp, [...exp, "The terminal shall have a large and bright display."]);
check("an invented / non-requirement extraction → 1 extra (precision drops)", m.extra.length === 1 && m.missed.length === 0);
m = matchRequirements(exp, [...exp, exp[0]]);
check("a duplicate is extra, never matched twice", m.extra.length === 1 && m.pairs.length === exp.length);
m = matchRequirements(exp, ["When a parameter cannot be applied, the terminal shall start the recovery steps and shall not send a SessionUpdateComplete message."].concat(exp.slice(0, 3)));
check("one merged requirement can match only one of the two expected ones", m.pairs.length === 4 && m.missed.length === 1);
check("rewording keeps the match ('shall' vs present tense, different order)", dice("The terminal stops timer T901 when SessionAccept arrives", "The terminal shall stop timer T901 when a SessionAccept message arrives") >= 0.6);
check("unrelated sentences do not match", dice("The terminal shall blink an amber light", "The terminal shall stop timer T901") < 0.6);
check("Wilson interval", (() => { const w = wilson(50, 65)!; return Math.abs(w[0] - 0.6553) < 0.01 && Math.abs(w[1] - 0.8514) < 0.01; })() && fraction(0, 0) === "n/a");

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall extraction-set tests passed");
