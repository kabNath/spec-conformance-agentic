// Offline test: the citation window must contain the relevant sentence even deep inside a long clause.
// Run: npx tsx scripts/test-citation-window.ts
import { selectWindow, WINDOW_CHARS } from "../lib/citation-window";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };

const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `1> perform the ${tag} handling step ${i} for the cell group;`).join("\n");
const target = "2> set the establishmentCause in the RRCSetupRequest message to the value provided by upper layers;";
const long = filler(120, "unrelated") + "\n" + target + "\n" + filler(120, "other");
const req = "The UE sets the establishmentCause in RRCSetupRequest to the cause provided by upper layers.";

check("fixture is longer than the old 500-char window and the new window", long.length > WINDOW_CHARS * 2);
check("OLD behaviour (first 500 chars) misses the sentence", !long.slice(0, 500).includes("establishmentCause"));
const w = selectWindow(long, req);
check("selected window contains the relevant sentence", w.text.includes("establishmentCause in the RRCSetupRequest"), `start=${w.start}`);
check("window respects the size limit", w.text.length <= WINDOW_CHARS);
check("window is an exact slice of the clause (verbatim guard stays valid)", long.slice(w.start, w.end) === w.text);
check("window starts on a line boundary", w.start === 0 || long[w.start - 1] === "\n");
const short = "The UE shall do X.\nThen Y.";
check("short clause is returned whole", selectWindow(short, req).text === short && selectWindow(short, req).start === 0);
check("no overlap with the requirement → start of the clause", selectWindow(long, "zzz qqq www").start === 0);
check("size can be overridden", selectWindow(long, req, 600).text.length <= 600 && selectWindow(long, req, 600).text.includes("establishmentCause"));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall citation-window tests passed");
