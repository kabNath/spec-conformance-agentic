// GAP_GUARD=verifier — the verifier (another model family) answers two fixed questions about a raw `gap`:
//   (a) is the cited passage about the same specific subject as the requirement?
//   (b) does its normative content contradict the requirement?
// A gap commits only if (a) and (b) are both yes, the contradicting words are verbatim in the texts, the quote
// itself is verbatim in the clause (lib/citation-check.ts) and the assessor's confidence is above the review
// threshold (the existing gate). PRE-REGISTERED: prompt, caps and criteria are fixed in eval/PREREGISTRATION-gap-guard.md.
import { normalizeWs } from "./citation-check";

export const GAP_CHECK_VERSION = "gap-check-v1";
/** Max characters appended after a quote ending in ":" (numbered bullets 1>, 2>, … that follow it). */
export const MAX_BULLET_EXTENSION_CHARS = 3000;
/** Max characters of NOTE text given to the verifier. */
export const MAX_NOTES_CHARS = 2000;

export const GAP_CHECK_SYSTEM = `You are an independent reviewer of 3GPP conformance findings. You receive a REQUIREMENT written by an
implementer and a PASSAGE copied verbatim from the specification. You do not know any earlier verdict.
Use only the text given; do not rely on outside knowledge of the specification.

Question (a) SAME SUBJECT: Does the PASSAGE state something about the same specific behaviour, field,
message content, timer, condition or procedure that the REQUIREMENT is about? Sharing only the message
name, the entity (UE/network) or the general area is NOT enough.

Question (b) CONTRADICTION: Does what the PASSAGE says is the rule (what the UE or network shall/must do,
or the behaviour it describes as mandatory) contradict the REQUIREMENT, so that the REQUIREMENT and the
PASSAGE cannot both hold for the same implementation? Silence is NOT a contradiction: answer false if the
passage merely does not mention what the requirement says, covers a different condition or scope, or
permits ("may", "optionally") behaviour that the requirement states, since an implementation that always
does it still complies. If a NOTE in the passage makes the requirement's behaviour permitted or excepted, answer false to (b).
Answer true only if you can copy the conflicting words from both texts.

Reply ONLY JSON:
{"same_subject": true|false, "subject": "<=15 words naming the shared behaviour, or empty>",
 "contradicts": true|false, "passage_words": "<exact words copied from the PASSAGE, or empty>",
 "requirement_words": "<exact words copied from the REQUIREMENT, or empty>"}
"contradicts" may be true only if both *_words fields are non-empty.`;

/** Offsets of `quote` in `clause`, tolerant to whitespace differences only; null if not found. */
export function locateQuote(clause: string, quote: string): { start: number; end: number } | null {
  const toks = quote.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const re = new RegExp(toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const m = re.exec(clause);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

const paragraphs = (text: string) => {
  const out: { s: number; e: number }[] = [];
  let pos = 0;
  for (const m of text.matchAll(/\n[ \t]*\n/g)) { out.push({ s: pos, e: m.index! }); pos = m.index! + m[0].length; }
  out.push({ s: pos, e: text.length });
  return out.filter((p) => p.e > p.s);
};
const isBullet = (p: string) => /^\d+>/.test(p);
const isNote = (p: string) => /^NOTE\b[^:\n]{0,8}:/.test(p);

export interface Passage {
  passage: string;       // an EXACT slice of the clause text (quote, extended with its numbered bullets when it ends in ":")
  extended: boolean;
  notes: string[];       // each "NOTE: …" (the clause's NOTE paragraphs not already inside the passage)
  notesTruncated: boolean;
  located: boolean;
}

/**
 * The quote the assessor gave, as an exact slice of the clause; when it ends with ":" (e.g. "The UE shall:") the
 * numbered bullets (1>, 2>, …) and interleaved NOTE paragraphs that follow it are appended, up to the cap.
 */
export function buildPassage(clause: string, quote: string): Passage {
  const loc = locateQuote(clause, quote);
  if (!loc) return { passage: quote, extended: false, notes: [], notesTruncated: false, located: false };
  let end = loc.end;
  let extended = false;
  if (normalizeWs(quote).endsWith(":")) {
    for (const p of paragraphs(clause)) {
      if (p.s < end) continue;
      const para = clause.slice(p.s, p.e);
      if (!(isBullet(para) || isNote(para))) break;
      if (p.e - loc.end > MAX_BULLET_EXTENSION_CHARS) break;
      end = p.e; extended = true;
    }
  }
  const notes: string[] = [];
  let used = 0, truncated = false;
  for (const p of paragraphs(clause)) {
    const para = clause.slice(p.s, p.e);
    if (!isNote(para) || (p.s >= loc.start && p.e <= end)) continue;
    const line = "NOTE: " + normalizeWs(para);
    if (used + line.length > MAX_NOTES_CHARS) { truncated = true; break; }
    notes.push(line); used += line.length;
  }
  return { passage: clause.slice(loc.start, end), extended, notes, notesTruncated: truncated, located: true };
}

export function gapCheckUser(requirement: string, clause: string, p: Passage): string {
  return `REQUIREMENT:\n${requirement}\n\nPASSAGE (clause ${clause}, verbatim):\n${p.passage}` +
    (p.notes.length ? `\n\nNOTES attached to this clause:\n${p.notes.join("\n")}` : "");
}

export type GapOutcome = "pass" | "gap_off_subject" | "gap_no_contradiction" | "gap_verifier_unusable";
export interface GapCheckReply { same_subject?: unknown; subject?: unknown; contradicts?: unknown; passage_words?: unknown; requirement_words?: unknown }

/** Interpret the verifier's raw replies (the last parseable one counts). Pure and deterministic. */
export function interpretGapCheck(raws: string[], requirement: string, p: Passage): { outcome: GapOutcome; parsed?: GapCheckReply; detail: string } {
  let parsed: GapCheckReply | undefined;
  for (const raw of raws) {
    try {
      const fenced = raw.replace(/```(?:json)?/gi, "");
      const i = fenced.indexOf("{"), j = fenced.lastIndexOf("}");
      if (i !== -1 && j > i) parsed = JSON.parse(fenced.slice(i, j + 1));
    } catch { /* try the next reply */ }
  }
  if (!parsed || typeof parsed.same_subject !== "boolean" || typeof parsed.contradicts !== "boolean")
    return { outcome: "gap_verifier_unusable", detail: "no parseable JSON with boolean same_subject / contradicts" };
  if (!parsed.same_subject) return { outcome: "gap_off_subject", parsed, detail: String(parsed.subject ?? "") };
  if (!parsed.contradicts) return { outcome: "gap_no_contradiction", parsed, detail: "verifier found no contradiction" };
  const pw = normalizeWs(String(parsed.passage_words ?? "")), rw = normalizeWs(String(parsed.requirement_words ?? ""));
  const haystack = normalizeWs([p.passage, ...p.notes].join(" "));
  if (!pw || !rw) return { outcome: "gap_verifier_unusable", parsed, detail: "contradicts=true without both word fields" };
  if (!haystack.includes(pw)) return { outcome: "gap_verifier_unusable", parsed, detail: "passage_words not verbatim in the passage" };
  if (!normalizeWs(requirement).includes(rw)) return { outcome: "gap_verifier_unusable", parsed, detail: "requirement_words not verbatim in the requirement" };
  return { outcome: "pass", parsed, detail: "same subject and contradiction confirmed with verbatim words" };
}
