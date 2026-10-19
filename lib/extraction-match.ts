// Scoring of the requirement EXTRACTION against a hand-written list (demo/extraction-set/), deterministic and free:
// no LLM judge. An extracted requirement matches an expected one when their salient-term sets are similar enough
// (Dice coefficient >= MATCH_THRESHOLD); matching is greedy and one-to-one, best pairs first.
//   recall    = matched expected / expected   (did it find them all?)
//   precision = matched extracted / extracted (did it add duplicates, non-requirements or inventions?)
// A single extracted requirement that merges two expected ones can match only one of them: the other counts as missed.
import { salientTerms } from "./citation-check";

export const MATCH_THRESHOLD = 0.6;

export function dice(a: string, b: string): number {
  const A = salientTerms(a), B = salientTerms(b);
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  return (2 * inter) / (A.size + B.size);
}

export interface Matching { pairs: { expected: number; extracted: number; score: number }[]; missed: number[]; extra: number[] }

export function matchRequirements(expected: string[], extracted: string[], threshold = MATCH_THRESHOLD): Matching {
  const cand: { e: number; x: number; s: number }[] = [];
  expected.forEach((e, i) => extracted.forEach((x, j) => { const s = dice(e, x); if (s >= threshold) cand.push({ e: i, x: j, s }); }));
  cand.sort((p, q) => q.s - p.s || p.e - q.e || p.x - q.x);
  const usedE = new Set<number>(), usedX = new Set<number>(), pairs: Matching["pairs"] = [];
  for (const c of cand) if (!usedE.has(c.e) && !usedX.has(c.x)) { usedE.add(c.e); usedX.add(c.x); pairs.push({ expected: c.e, extracted: c.x, score: c.s }); }
  return { pairs, missed: expected.map((_, i) => i).filter((i) => !usedE.has(i)), extra: extracted.map((_, j) => j).filter((j) => !usedX.has(j)) };
}

export function wilson(k: number, n: number, z = 1.959963984540054): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export const fraction = (k: number, n: number) => {
  const w = wilson(k, n);
  return w ? `${k}/${n} = ${(100 * k / n).toFixed(1)} % [${(100 * w[0]).toFixed(0)}–${(100 * w[1]).toFixed(0)}]` : "n/a";
};
