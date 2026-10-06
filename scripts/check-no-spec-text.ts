// Fails if any file contains a run of MORE THAN 8 consecutive words (i.e. 9) that also appears in the spec text.
//   npx tsx scripts/check-no-spec-text.ts <file>...  [--corpus examples/ts38331-extract.txt] [--n 9]
// Words are lower-cased [a-z0-9]+ tokens, so punctuation, case and whitespace differences cannot hide a copy.
// JSON files are checked string by string (a span cannot be assembled across two fields); other files as one text.
// The matched text itself is never printed (only where it is), so running this tool does not leak the spec.
import { existsSync, readFileSync } from "node:fs";

export const WINDOW = 9; // "more than 8 consecutive words"
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function ngramSet(corpus: string, n = WINDOW): Set<string> {
  const t = tokens(corpus), out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(" "));
  return out;
}
/** Positions (word offsets) in `text` whose n-word window is in the spec. */
export function findSpans(spec: Set<string>, text: string, n = WINDOW): number[] {
  const t = tokens(text), hits: number[] = [];
  for (let i = 0; i + n <= t.length; i++) if (spec.has(t.slice(i, i + n).join(" "))) hits.push(i);
  return hits;
}
export function scanJson(spec: Set<string>, value: unknown, path = "$", n = WINDOW): { path: string; spans: number }[] {
  if (typeof value === "string") { const h = findSpans(spec, value, n); return h.length ? [{ path, spans: h.length }] : []; }
  if (Array.isArray(value)) return value.flatMap((v, i) => scanJson(spec, v, `${path}[${i}]`, n));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => scanJson(spec, v, `${path}.${k}`, n));
  return [];
}

function main() {
  const a = process.argv.slice(2);
  const opt = (name: string, d: string) => { const i = a.indexOf(name); return i === -1 ? d : a[i + 1]; };
  const corpusPath = opt("--corpus", "examples/ts38331-extract.txt"), n = Number(opt("--n", String(WINDOW)));
  const files = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--corpus" && a[i - 1] !== "--n");
  if (!existsSync(corpusPath)) { console.error(`corpus ${corpusPath} not found (the spec text is not redistributable): cannot check`); process.exit(2); }
  if (!files.length) { console.error("usage: check-no-spec-text.ts <file>... [--corpus path] [--n 9]"); process.exit(2); }
  const spec = ngramSet(readFileSync(corpusPath, "utf8"), n);
  let bad = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const hits = f.endsWith(".json") ? scanJson(spec, JSON.parse(text), "$", n)
      : (() => { const h = findSpans(spec, text, n); return h.length ? [{ path: `${h.length} window(s), first at word ${h[0]}`, spans: h.length }] : []; })();
    console.log(`${hits.length ? "✗" : "✓"} ${f}${hits.length ? "  " + hits.slice(0, 5).map((h) => `${h.path} (${h.spans})`).join("; ") : ""}`);
    bad += hits.length ? 1 : 0;
  }
  console.log(`\n${bad ? `${bad} file(s) contain ≥ ${n} consecutive words of the spec` : `no file contains ${n} or more consecutive words of the spec`} (corpus: ${spec.size.toLocaleString()} distinct ${n}-word windows)`);
  process.exit(bad ? 1 : 0);
}
if (process.argv[1]?.endsWith("check-no-spec-text.ts")) main();
