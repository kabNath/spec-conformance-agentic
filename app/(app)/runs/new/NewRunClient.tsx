"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewRunClient() {
  const router = useRouter();
  const [name, setName] = useState("NTN RRC conformance");
  const [spec, setSpec] = useState("TS 38.331");
  const [version, setVersion] = useState("18.3.0");
  const [release, setRelease] = useState("Rel-18");
  const [standard, setStandard] = useState<File | null>(null);
  const [impl, setImpl] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!standard || !impl) { setErr("Upload one standard file and one implementation file."); return; }
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("name", name); fd.set("spec", spec); fd.set("version", version);
    fd.set("release", release); fd.set("targetRelease", release);
    fd.set("standard", standard); fd.set("impl", impl);
    const res = await fetch("/api/runs", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(json.error ?? "Run failed"); return; }
    router.push(`/runs/${json.runId}`);
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="card">
        <div className="card-h"><span className="card-t">New conformance check</span></div>
        <div className="card-b space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex items-center gap-2 text-xs text-mut">Target release
              <input className="input w-24" value={release} onChange={(e) => setRelease(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-lg border border-dashed border-line-2 p-3 block cursor-pointer">
              <div className="text-sm font-semibold mb-1">Standards knowledge base</div>
              <div className="meta-mono mb-2">3GPP spec — .pdf / .docx / .txt</div>
              <input type="file" accept=".pdf,.docx,.txt,.md"
                     onChange={(e) => setStandard(e.target.files?.[0] ?? null)} />
              <div className="mt-2 grid grid-cols-2 gap-1 meta-mono">
                <input className="input" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="TS 38.331" />
                <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="18.3.0" />
              </div>
            </label>

            <label className="rounded-lg border border-dashed border-line-2 p-3 block cursor-pointer">
              <div className="text-sm font-semibold mb-1">Implementation documents</div>
              <div className="meta-mono mb-2">your feature spec — .pdf / .docx / .txt</div>
              <input type="file" accept=".pdf,.docx,.txt,.md"
                     onChange={(e) => setImpl(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          {err && <div className="text-redink text-sm">{err}</div>}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="meta-mono">on-prem · cites only uploaded sources</span>
            <button className="btn-accent" disabled={busy} onClick={run}>
              {busy ? "Running…" : "Run conformance check"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
