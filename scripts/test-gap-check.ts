// Offline tests for GAP_GUARD=verifier (lib/gap-check.ts + lib/graph/judge.ts). No network, no LLM:
// the verifier's replies are stubbed. Run: npx tsx scripts/test-gap-check.ts
import { existsSync, readFileSync } from "node:fs";
import { buildPassage, locateQuote, interpretGapCheck, gapCheckUser, MAX_BULLET_EXTENSION_CHARS, GAP_CHECK_SYSTEM } from "../lib/gap-check";
import { isVerbatim } from "../lib/citation-check";
import { judge, gapGuard, type JudgeDeps } from "../lib/graph/judge";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

// Paraphrased fixture with the REAL layout of TS 38.331 5.3.8.3 (tabs, "1>" bullets, NOTE paragraphs between them).
const RELEASE =
  "7.2.4\tReception of the LinkClose by the terminal\n\nThe terminal shall:\n\n" +
  "1>\tdelay the teardown actions of this clause by 40 ms from the moment the LinkClose message was received, or earlier when the lower layer reports successful delivery, whichever comes first;\n\n" +
  "NOTE 0:\tWhen the lower layer has no delivery reports, a report can be considered to have arrived.\n\n" +
  "1>\tstop timer T777, if running;\n\n1>\tif the message includes a resumeInfo field:\n\n2>\tstore the resume information;\n\n" +
  "The terminal may then perform actions that are not bullets.\n\nNOTE 1:\tA later note about something else.";
// (invented text with the layout of a 3GPP procedure clause: header, `1>` bullets, NOTE paragraphs)
const R15 = "Upon receiving an RRCRelease, the UE executes the release actions immediately, with no delay.";
const R14 = "Upon receiving an RRCRelease, the UE delays the release actions by 60 ms from reception, or earlier if lower layers indicate the message was successfully acknowledged.";
const R10 = "The UE persists every received RRCReconfiguration to local storage for 30 days for audit purposes.";

// --- passage construction (R15 and R14) -------------------------------------------------------------
const p15 = buildPassage(RELEASE, "The terminal shall:");
check("R15: quote ending in ':' is extended with the numbered bullets that follow", p15.located && p15.extended &&
  p15.passage.includes("delay the teardown actions") && p15.passage.includes("stop timer T777") && p15.passage.includes("store the resume information"));
check("R15: extension stops at the first non-bullet paragraph", !p15.passage.includes("The terminal may then"));
check("R15: the passage is an EXACT slice of the clause text", RELEASE.includes(p15.passage) && RELEASE.indexOf(p15.passage) === RELEASE.indexOf("The terminal shall:"));
check("R15: the verbatim guard still holds on the extended passage", isVerbatim(p15.passage, RELEASE));
check("R15: a NOTE already inside the passage is not repeated; the later NOTE is attached with the 'NOTE:' prefix",
  p15.notes.length === 1 && p15.notes[0].startsWith("NOTE: NOTE 1:") && p15.passage.includes("NOTE 0:"));

const q14 = "1>\tdelay the teardown actions of this clause by 40 ms from the moment the LinkClose message was received, or earlier when the lower layer reports successful delivery, whichever comes first;";
const p14 = buildPassage(RELEASE, q14);
check("R14: a quote that does not end in ':' is not extended and is still an exact slice", p14.located && !p14.extended && p14.passage === q14);
check("R14: the NOTEs of the clause (incl. NOTE 0, which excepts the behaviour) are given to the verifier, 'NOTE:'-prefixed",
  p14.notes.length === 2 && p14.notes.every((n) => n.startsWith("NOTE: NOTE ")) && p14.notes[0].includes("has no delivery reports"));
check("whitespace differences in the quote are tolerated, the passage keeps the clause's own whitespace",
  buildPassage(RELEASE, "The terminal shall: 1> delay the teardown actions").passage.includes("\n\n1>\tdelay"));
check("quote not found → located=false (nothing is invented)", !buildPassage(RELEASE, "this sentence is not there").located);
const manyBullets = "The terminal shall:\n\n" + Array.from({ length: 80 }, (_, i) => `1>\tdo step number ${i} with some padding text to make it longer;`).join("\n\n");
const big = buildPassage(manyBullets, "The terminal shall:");
check("bullet extension is capped", big.extended && big.passage.length <= "The terminal shall:".length + MAX_BULLET_EXTENSION_CHARS + 5);
check("locateQuote returns offsets of the original text", (() => { const l = locateQuote(RELEASE, "stop timer  T777,\nif running;"); return !!l && RELEASE.slice(l.start, l.end).startsWith("stop timer T777"); })());
check("the user message carries the NOTEs under a header", gapCheckUser(R14, "5.3.8.3", p14).includes("NOTES attached to this clause:\nNOTE: NOTE 0:"));
check("the system prompt carries the NOTE-exception sentence verbatim",
  GAP_CHECK_SYSTEM.includes("If a NOTE in the passage makes the requirement's behaviour permitted or excepted, answer false to (b)."));

// --- interpretation of the verifier's reply ---------------------------------------------------------
const good = JSON.stringify({ same_subject: true, subject: "RRCRelease release timing", contradicts: true,
  passage_words: "delay the teardown actions of this clause by 40 ms", requirement_words: "immediately, with no delay" });
check("valid reply with verbatim words → pass", interpretGapCheck([good], R15, p15).outcome === "pass");
check("(a)=false → gap_off_subject", interpretGapCheck([JSON.stringify({ same_subject: false, contradicts: false })], R10, p15).outcome === "gap_off_subject");
check("(a)=true, (b)=false → gap_no_contradiction", interpretGapCheck([JSON.stringify({ same_subject: true, contradicts: false })], R14, p14).outcome === "gap_no_contradiction");
check("contradicts=true but words not in the passage → unusable",
  interpretGapCheck([JSON.stringify({ same_subject: true, contradicts: true, passage_words: "invented words", requirement_words: "with no delay" })], R15, p15).outcome === "gap_verifier_unusable");
check("contradicts=true but requirement words not in the requirement → unusable",
  interpretGapCheck([JSON.stringify({ same_subject: true, contradicts: true, passage_words: "stop timer T777", requirement_words: "never said" })], R15, p15).outcome === "gap_verifier_unusable");
check("contradicts=true with empty word fields → unusable", interpretGapCheck([JSON.stringify({ same_subject: true, contradicts: true, passage_words: "", requirement_words: "" })], R15, p15).outcome === "gap_verifier_unusable");
check("prose / non-JSON → unusable", interpretGapCheck(["I think it is fine."], R15, p15).outcome === "gap_verifier_unusable");
check("fenced JSON is accepted", interpretGapCheck(["```json\n" + good + "\n```"], R15, p15).outcome === "pass");
check("words may come from an attached NOTE", interpretGapCheck([JSON.stringify({ same_subject: true, contradicts: true,
  passage_words: "A later note about something else", requirement_words: "with no delay" })], R15, p15).outcome === "pass");

// --- judge(): GAP_GUARD modes ---------------------------------------------------------------------------
check("GAP_GUARD defaults to verifier", (delete process.env.GAP_GUARD, gapGuard() === "verifier"));
check("GAP_GUARD=both is no longer accepted", (() => { process.env.GAP_GUARD = "both"; try { gapGuard(); return false; } catch { return true; } finally { delete process.env.GAP_GUARD; } })());

const cite = (clause: string, text: string) => [{ spec: "TS 38.331", version: "19.3.0", release: "Rel-19", clause, text, normative: "shall" as const, display: `TS 38.331 §${clause}` }];
const seen: string[] = [];
const deps = (quote: string, replies: string[], conf = 0.97, clause = RELEASE): JudgeDeps => {
  let n = 0;
  return {
    assess: async () => ({ verdict: "gap", confidence: conf, normative: "shall", quote }),
    verify: async () => ({ agrees: true, confidence: 0.9, note: "stub" }),
    clauseText: async () => clause,
    gapCheckCall: async (_s, user) => { seen.push(user); return replies[Math.min(n++, replies.length - 1)]; },
  };
};

async function judgeTests() {
  process.env.GAP_GUARD = "verifier";
  process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_VERIFIER_MODEL = "google/gemini-3.8-flash";

  let j = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), deps(q14, [good]));
  check("true gap R15 (quote = the 1> bullet): confirmed by the verifier → commits as gap", j.a.verdict === "gap" && !j.blockedReason && j.rawVerdict === "gap");
  check("…and the audit trail records quote, extended passage and raw JSON reply",
    j.quote === q14 && j.gapCheck?.outcome === "pass" && j.gapCheck.passage === q14 && j.gapCheck.rawReplies![0] === good);

  // header quote (>= 4 words, as the verbatim guard requires) → the verifier gets the header AND its bullets
  const HDR = RELEASE.replace("The terminal shall:", "The terminal shall perform these actions:");
  seen.length = 0;
  j = await judge(R15, "ts38331", cite("5.3.8.3", HDR), deps("The terminal shall perform these actions:", [good], 0.97, HDR));
  check("header quote ending in ':' → passage extended with the bullets before reaching the verifier, still verbatim",
    j.gapCheck?.passageExtended === true && j.gapCheck.passage!.includes("delay the teardown actions") && isVerbatim(j.gapCheck.passage!, HDR) &&
    seen[0].includes("stop timer T777") && j.a.verdict === "gap");
  const short = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), deps("The terminal shall:", [good]));
  check("a 3-word header quote ('The UE shall:') is refused by the verbatim guard (min 4 words) before any verifier call",
    short.blockedReason === "citation_not_verbatim" && !short.gapCheck);

  j = await judge(R10, "ts38331", cite("5.3.8.3", RELEASE), deps(q14, [JSON.stringify({ same_subject: false, subject: "", contradicts: false, passage_words: "", requirement_words: "" })]));
  check("R10-like (persist messages for 30 days vs RRC release): (a)=no → NOT committed as gap",
    j.rawVerdict === "gap" && j.a.verdict === "insufficient_evidence" && j.blockedReason === "gap_off_subject");

  j = await judge(R14, "ts38331", cite("5.3.8.3", RELEASE), deps(q14, [JSON.stringify({ same_subject: true, contradicts: false })]));
  check("R14: NOTE 0 / 'optionally' → (b)=no → NOT committed as gap", j.a.verdict === "insufficient_evidence" && j.blockedReason === "gap_no_contradiction");
  check("R14: the verifier was shown both NOTEs", seen[seen.length - 1].includes("NOTE: NOTE 0:") && seen[seen.length - 1].includes("NOTE: NOTE 1:"));

  j = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), deps(q14, [JSON.stringify({ same_subject: true, contradicts: true, passage_words: "made up", requirement_words: "with no delay" })]));
  check("fabricated contradiction words → gap_verifier_unusable", j.blockedReason === "gap_verifier_unusable" && j.a.verdict === "insufficient_evidence");

  let calls = 0;
  const flaky: JudgeDeps = { ...deps(q14, [good]), gapCheckCall: async () => (calls++ === 0 ? "not json at all" : good) };
  j = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), flaky);
  check("a non-JSON reply gets exactly one retry", calls === 2 && j.a.verdict === "gap" && j.gapCheck?.rawReplies?.length === 2);

  j = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), deps(q14 + " and an invented tail", [good]));
  check("a quote that is not verbatim is stopped BEFORE the verifier is called", j.blockedReason === "citation_not_verbatim" && !j.gapCheck);

  seen.length = 0;
  process.env.OPENROUTER_VERIFIER_MODEL = "anthropic/claude-haiku";
  j = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), deps(q14, [good]));
  check("same-family verifier: gap blocked, no verifier call made", j.blockedReason === "verifier_same_family" && seen.length === 0);

  process.env.OPENROUTER_VERIFIER_MODEL = "google/gemini-3.8-flash";
  process.env.GAP_GUARD = "lexical";
  j = await judge(R15, "ts38331", cite("5.3.8.3", RELEASE), deps(q14, [good]));
  check("GAP_GUARD=lexical keeps the previous rule (R15-style 'The terminal shall:' is not grounded) and never calls the verifier check",
    j.blockedReason === "gap_not_grounded" && seen.length === 0);

  // --- the REAL clause, when the local (non-redistributable) corpus is present ---
  const f = "examples/ts38331-extract.txt";
  if (existsSync(f)) {
    const { parseSpec } = await import("../lib/parser-3gpp");
    const t = parseSpec(readFileSync(f, "utf8"), { spec: "x", version: "x", release: "x" });
    const real = String(t.nodes["5.3.8.3"].text);
    const rp = buildPassage(real, "The UE shall:");
    check("[real corpus] 5.3.8.3 'The UE shall:' → extended with the first bullets, exact slice, verbatim", rp.extended && real.includes(rp.passage) && isVerbatim(rp.passage, real) &&
      /delay the following actions/.test(rp.passage) && /optionally/.test(rp.passage));
    const rq = buildPassage(real, "delay the following actions defined in this clause");
    check("[real corpus] R14: the clause's NOTEs are attached", rq.notes.length > 0 && rq.notes.every((n) => n.startsWith("NOTE: ")), String(rq.notes.length));
  } else console.log("⏭  real-corpus checks skipped (examples/ts38331-extract.txt not present; the spec text is not redistributable)");
}

judgeTests().then(() => {
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall gap-check tests passed");
});
