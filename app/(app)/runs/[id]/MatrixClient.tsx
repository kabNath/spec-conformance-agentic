"use client";
import { useState } from "react";
import {
  displayVerdict, type ConformanceRun, type EvaluatedRequirement, type DisplayVerdict,
} from "@/lib/conformance-contract";

const VERDICT_PILL: Record<DisplayVerdict, string> = {
  conformant: "pill-ok",
  gap: "pill-err",
  insufficient_evidence: "pill-mut",
  needs_review: "pill-warn",
};
const VERDICT_LABEL: Record<DisplayVerdict, string> = {
  conformant: "conformant", gap: "gap",
  insufficient_evidence: "insufficient", needs_review: "needs review",
};

export default function MatrixClient({ run }: { run: ConformanceRun }) {
  const [sel, setSel] = useState<EvaluatedRequirement | null>(run.requirements[0] ?? null);
  const s = run.summary;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-xl">{run.name}</h1>
          <span className="meta-mono">{run.targetRelease} · {run.status}</span>
        </div>
        <a className="btn-ghost" href={`/api/runs/${run.id}/export`}>Export .xlsx</a>
      </div>

      {/* Summary cards — compact, content-sized, centered */}
      <div className="flex flex-wrap justify-center gap-2">
        <Card label="Requirements" value={s.total} />
        <Card label="Conformant" value={s.conformant} variant="ok" />
        <Card label="Gaps" value={s.gaps} variant="err" />
        <Card label="Needs review" value={s.needsReview} variant="warn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Matrix table */}
        <div className="lg:col-span-3 card">
          <div className="card-b overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-mut text-left">
                  <th className="font-normal py-2 pr-2">Requirement</th>
                  <th className="font-normal py-2 pr-2">Clause</th>
                  <th className="font-normal py-2 pr-2">Norm</th>
                  <th className="font-normal py-2">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {run.requirements.map((r) => {
                  const dv = displayVerdict(r);
                  return (
                    <tr key={r.id} onClick={() => setSel(r)}
                        className={`border-t border-line cursor-pointer hover:bg-tint ${sel?.id === r.id ? "bg-tint" : ""}`}>
                      <td className="py-2 pr-2">{r.requirement}</td>
                      <td className="py-2 pr-2 font-mono text-[11px]">{r.citations[0]?.clause ?? "—"}</td>
                      <td className="py-2 pr-2">{r.normative}</td>
                      <td className="py-2"><span className={VERDICT_PILL[dv]}>{VERDICT_LABEL[dv]}</span></td>
                    </tr>
                  );
                })}
                {run.requirements.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-mut">No requirements evaluated.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drill-down detail */}
        <div className="lg:col-span-2">{sel && <Detail r={sel} />}</div>
      </div>
    </div>
  );
}

function Card({ label, value, variant = "neutral" }: { label: string; value: number; variant?: "neutral" | "ok" | "err" | "warn" }) {
  return (
    <div className={`sum sum-${variant}`}>
      <div className="meta-mono">{label}</div>
      <div className="sum-num">{value}</div>
    </div>
  );
}

function Detail({ r }: { r: EvaluatedRequirement }) {
  const c = r.citations[0];
  return (
    <div className="card">
      <div className="card-h"><span className="card-t">Requirement detail</span></div>
      <div className="card-b space-y-3">
        <div className="text-sm font-semibold">{r.requirement}</div>
        <div className="meta-mono">from {r.source.documentName}{r.source.section ? ` · §${r.source.section}` : ""}</div>

        {c ? (
          <div className="rounded border-l-2 border-accent bg-accent-soft p-2">
            <div className="font-mono text-[11px] text-accent-dark mb-1">{c.display}</div>
            <div className="text-[13px] leading-relaxed">{c.text}</div>
          </div>
        ) : <div className="meta-mono">no governing clause found</div>}

        <div className="text-xs text-mut">
          verdict <span className="text-ink font-semibold">{r.verdict}</span> · verifier{" "}
          {r.verifier.agrees ? "agrees" : "disagrees"} — {r.verifier.note}
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-mut mb-1">
            <span>citation confidence</span><span className="text-ink font-semibold">{Math.round(r.confidence * 100)}%</span>
          </div>
          <div className="h-1.5 bg-tint rounded overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${Math.round(r.confidence * 100)}%` }} />
          </div>
          {r.review.required && (
            <div className="meta-mono text-accent-dark mt-2">⚑ flagged for human review — {r.review.reason}</div>
          )}
        </div>

        {r.retrievalPath && r.retrievalPath.length > 0 && (
          <div className="meta-mono">audit path: {r.retrievalPath.join(" → ")}</div>
        )}
      </div>
    </div>
  );
}
