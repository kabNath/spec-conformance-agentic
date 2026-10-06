// "Norm" column: the normative force of the sentence that GOVERNS a requirement.
//
// The clause-level value stored by the parser is the strongest keyword anywhere in the clause (shall_not > shall > …).
// A clause that contains both "shall apply … in the order received" and "shall not release …" is therefore always
// shall_not, whichever requirement cites it. Here the cited text (the verified excerpt, else the clause) is cut into
// segments, one per modal keyword inside each sentence, and the segment that shares the most salient terms with the
// requirement decides (ties → earliest). If nothing overlaps, there is no governing sentence: the caller keeps the clause-level value.
import { salientTerms } from "./citation-check";
import type { NormativeKeyword } from "./conformance-contract";

/** A segment must share at least this many salient terms with the requirement (one shared word such as "terminal" proves nothing). */
export const MIN_OVERLAP = 2;

const MODAL_RE = /\b(shall not|shall|should not|should|may)\b/gi;
const FORCE: Record<string, NormativeKeyword> = { "shall not": "shall_not", shall: "shall", "should not": "should_not", should: "should", may: "may" };

export interface Governing { force: NormativeKeyword; segment: string; overlap: number }

export function governingNormative(text: string, requirement: string): Governing | null {
  const req = salientTerms(requirement);
  let best: Governing | null = null;
  const flat = text.replace(/\s+/g, " ");
  for (const sentence of flat.split(/(?<=[.;:])\s+/)) {
    const modals = [...sentence.matchAll(MODAL_RE)];
    modals.forEach((m, i) => {
      // segment i: from the sentence start (first one) or this modal, up to the next modal
      const from = i === 0 ? 0 : m.index!;
      const to = i + 1 < modals.length ? modals[i + 1].index! : sentence.length;
      const segment = sentence.slice(from, to).trim();
      const terms = salientTerms(segment);
      const overlap = [...req].filter((t) => terms.has(t)).length;
      if (overlap >= MIN_OVERLAP && (!best || overlap > best.overlap)) best = { force: FORCE[m[1].toLowerCase()], segment, overlap };
    });
  }
  return best;
}
