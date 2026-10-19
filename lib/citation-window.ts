// Choose which part of a (possibly very long) clause the assessor gets to read.
//
// v1 passed the FIRST 500 characters. 64 of the 266 clauses are longer than 3000 characters, so the sentence
// that governs a requirement was often cut off (R06, R08 in EVAL.md). The window is now the stretch of the
// clause, on line boundaries, that covers the most of the requirement's salient terms (ties → earliest), up
// to WINDOW_CHARS. It is always an exact slice of the clause text, so the verbatim guard still holds.
import { salientTerms } from "./citation-check";

/** Max characters of clause text shown to the assessor/verifier (env CITATION_WINDOW_CHARS). */
export const WINDOW_CHARS = Number(process.env.CITATION_WINDOW_CHARS) || 4000;

export interface Window { text: string; start: number; end: number }

export function selectWindow(clause: string, requirement: string, size: number = WINDOW_CHARS): Window {
  if (clause.length <= size) return { text: clause, start: 0, end: clause.length };

  // line records: [start, end) offsets of each line, plus its salient terms
  const req = salientTerms(requirement);
  const lines: { s: number; e: number; terms: Set<string> }[] = [];
  for (let s = 0; s < clause.length;) {
    let e = clause.indexOf("\n", s);
    e = e === -1 ? clause.length : e + 1;
    lines.push({ s, e, terms: new Set([...salientTerms(clause.slice(s, e))].filter((t) => req.has(t))) });
    s = e;
  }

  let best = { score: -1, first: 0, last: 0 };
  for (let i = 0; i < lines.length; i++) {
    // greedily extend from line i while it fits; score = distinct requirement terms covered
    const covered = new Set<string>();
    let j = i;
    while (j < lines.length && lines[j].e - lines[i].s <= size) { lines[j].terms.forEach((t) => covered.add(t)); j++; }
    if (j === i) { j = i + 1; }  // a single line longer than the window: take its head
    if (covered.size > best.score) best = { score: covered.size, first: i, last: j - 1 };
  }
  const start = lines[best.first].s;
  const end = Math.min(lines[best.last].e, start + size);
  return { text: clause.slice(start, end), start, end };
}
