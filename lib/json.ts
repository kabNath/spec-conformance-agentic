// Pure helper: pull a parseable JSON value out of a possibly-noisy LLM reply.
// Models on OpenRouter sometimes wrap JSON in ```fences```, add a prose sentence
// before/after it, or (on hard/abstention cases) emit TWO JSON objects on
// separate lines. We strip fences, find the first `{`/`[`, then scan forward
// tracking bracket depth (respecting strings/escapes) and return the FIRST
// balanced value — discarding both surrounding prose and any trailing objects.
//
// The earlier version sliced first-`{` to LAST-`}`, which on multi-object output
// yielded `{…}\n{…}` — invalid JSON that threw "non-whitespace after JSON at
// position N". Returning the first complete object fixes that failure mode (it
// was the R21/R26/R31 system errors in EVAL.md). Side-effect free / unit-testable.
export function extractJSON(raw: string): string {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const open = fenced.search(/[{[]/);
  if (open === -1) return fenced; // nothing bracket-like — let JSON.parse report it
  const openCh = fenced[open];
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < fenced.length; i++) {
    const ch = fenced[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh && --depth === 0) return fenced.slice(open, i + 1);
  }
  return fenced.slice(open); // unbalanced — best-effort, let JSON.parse report it
}
