// Pure helper: pull a parseable JSON value out of a possibly-noisy LLM reply.
// Models on OpenRouter sometimes wrap JSON in ```fences``` or add a prose
// sentence before/after it — plain JSON.parse then fails ("non-whitespace
// after JSON"). We strip fences, then slice from the first `{`/`[` to its
// matching last `}`/`]`, discarding any surrounding prose. Side-effect free so
// it can be unit-tested without constructing an LLM client.
export function extractJSON(raw: string): string {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const open = fenced.search(/[{[]/);
  if (open === -1) return fenced; // nothing bracket-like — let JSON.parse report it
  const closer = fenced[open] === "{" ? "}" : "]";
  const close = fenced.lastIndexOf(closer);
  return close > open ? fenced.slice(open, close + 1) : fenced.slice(open);
}
