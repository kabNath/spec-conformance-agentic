import { confidenceDisplay } from "@/lib/confidence-display";
import type { EvaluatedRequirement } from "@/lib/conformance-contract";

/** Confidence block of the matrix detail view. Pure render: no hooks, usable on the server and in tests. */
export default function ConfidencePanel({ r }: { r: EvaluatedRequirement }) {
  const d = confidenceDisplay(r);
  if (d.kind === "review") {
    return (
      <div>
        <div className="meta-mono text-accent-dark">⚑ flagged for human review — no verdict is committed, so no confidence is shown</div>
        <div className="text-xs text-mut mt-1">{d.reasonText}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-mut mb-1">
        <span>{d.kind === "calibrated" ? "calibrated confidence" : "LLM confidence (not calibrated)"}</span>
        <span className="text-ink font-semibold">
          {d.pct}%{d.kind === "calibrated" && <span className="text-mut font-normal"> [{d.lowPct}–{d.highPct}%]</span>}
        </span>
      </div>
      <div className="h-1.5 bg-tint rounded overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${d.pct}%` }} />
      </div>
      <div className="text-[11px] text-mut mt-1">{d.text}</div>
    </div>
  );
}
