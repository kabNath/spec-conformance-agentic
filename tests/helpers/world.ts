// A tiny INVENTED specification ("LCP", a fictional link-control protocol) plus a stand-in for the model providers.
// No 3GPP text. The stand-in only exists to produce recorded replies once (RECORD=1); tests replay them.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const STANDARD_ID = "lcp100";
export const STANDARD_META = { spec: "LCP 100", version: "1.0.0", release: "Rel-0" };

export const CLAUSES: Record<string, { clause: string; title: string; text: string; normative: string }> = {
  "5.3.3": {
    clause: "5.3.3", title: "Session set-up", normative: "shall",
    text: "The purpose of this procedure is to open a link session and the control channel CCH1 between the terminal and the network. On initiation, the terminal shall apply the default channel parameters, start timer T901 and send a SessionRequest message carrying a random session value. When the network answers with a SessionAccept message, the terminal shall stop timer T901, store the received parameters and enter the active state.",
  },
  "5.3.5": {
    clause: "5.3.5", title: "Session update", normative: "shall_not",
    text: "The purpose of this procedure is to change an open session. The terminal shall apply the parameters carried by the SessionUpdate message in the order received and shall not release the session before it has answered with a SessionUpdateComplete message.",
  },
};

export const IMPL_DOC = [
  "R1 The terminal starts timer T901 and sends a SessionRequest message when it opens a link session.",
  "R2 The terminal releases the session before answering with a SessionUpdateComplete message.",
  "R3 The terminal ignores the parameter order of a SessionUpdate message.",
  "R4 The terminal encrypts the control channel with a rotating key.",
].join("\n");

// ── stand-in model (record mode only) ────────────────────────────────────────────────────────
const between = (s: string, a: string, b?: string) => { const i = s.indexOf(a); if (i < 0) return ""; const j = b ? s.indexOf(b, i + a.length) : -1; return s.slice(i + a.length, j < 0 ? undefined : j); };

export function synth(role: string, system: string, user: string): string {
  if (system.startsWith("Extract atomic")) {
    const reqs = IMPL_DOC.split("\n").map((l) => ({ requirement: l.replace(/^R\d /, ""), section: l.slice(0, 2) }));
    return JSON.stringify({ requirements: reqs });
  }
  if (system.startsWith("You navigate")) {
    const cur = /CURRENT (\S+)/.exec(user)?.[1];
    if (cur) return JSON.stringify({ action: "done", clause: cur, done: true });
    const cand = /CANDIDATE CLAUSES: ([^\n]+)/.exec(user)?.[1]?.split(", ")[0];
    return JSON.stringify(cand ? { action: "read", clause: cand } : { action: "stuck" });
  }
  if (system.startsWith("Assess conformance")) {
    const req = between(user, "REQUIREMENT:\n", "\n\nCLAUSES:");
    if (req.includes("starts timer T901"))
      return JSON.stringify({ verdict: "conformant", confidence: 0.95, gapNote: "", quote: "the terminal shall apply the default channel parameters, start timer T901 and send a SessionRequest message carrying a random session value" });
    if (req.includes("releases the session before"))
      return JSON.stringify({ verdict: "gap", confidence: 0.93, gapNote: "Releases before the completion message.", quote: "shall not release the session before it has answered with a SessionUpdateComplete message" });
    if (req.includes("ignores the parameter order"))
      return JSON.stringify({ verdict: "gap", confidence: 0.9, gapNote: "Order is mandatory.", quote: "The terminal must keep the received order of parameters at all times" });
    return JSON.stringify({ verdict: "insufficient_evidence", confidence: 0.3, gapNote: "", quote: "" });
  }
  if (system.startsWith("You are an adversarial verifier")) return JSON.stringify({ agrees: true, confidence: 0.9, note: "The clause supports the verdict." });
  if (system.startsWith("You are an independent reviewer"))
    return JSON.stringify({ same_subject: true, subject: "release of the session", contradicts: true, passage_words: "shall not release the session", requirement_words: "releases the session" });
  throw new Error(`synth: unknown prompt (${role})`);
}

// ── record / replay ──────────────────────────────────────────────────────────────────────────
export const replayKey = (role: string, model: string, system: string, user: string) =>
  createHash("sha256").update(JSON.stringify([role, model, system, user])).digest("hex");

export class Replay {
  private table: Record<string, string>;
  constructor(private file: string, private record: boolean) {
    this.table = !record && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
  reply(role: string, model: string, system: string, user: string): string {
    const k = replayKey(role, model, system, user);
    if (this.record) return (this.table[k] ??= synth(role, system, user));
    const r = this.table[k];
    if (r === undefined) throw new Error(`unrecorded LLM call (${role}); the prompt changed. Re-record deliberately with RECORD=1`);
    return r;
  }
  flush() { if (this.record) writeFileSync(this.file, JSON.stringify(this.table, null, 2) + "\n"); }
}

/** Deterministic stand-in for the vidimus sidecar's /attest (same field names as the real response). */
export function fakeAttestResponse(body: { requirement: string; verdict: string; assessor_confidence: number; verifier_confidence: number; verifier_agrees: boolean }) {
  const raw = Math.round((0.5 * body.assessor_confidence + 0.5 * body.verifier_confidence) * (body.verifier_agrees ? 1 : 0.6) * 10000) / 10000;
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const cal = raw >= 0.8;
  return {
    calibrated: cal, calibrated_confidence: cal ? 0.94 : null, ci_low: cal ? 0.78 : null, ci_high: cal ? 0.99 : null,
    raw_confidence: raw, calibration_version: "cal-test", n_reference: 40, tranche_n: cal ? 26 : 4,
    key_id: "keyid-test", issued_at: "2026-01-01T00:00:00Z", content_hash: hash, signature: "sig-" + hash.slice(0, 16), public_key: "pub-test",
  };
}
