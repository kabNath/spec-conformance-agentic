import Link from "next/link";

export default function Landing() {
  return (
    <main className="min-h-screen bg-white" style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.035) 1px,transparent 1px)", backgroundSize: "56px 56px" }}>
      {/* Nav */}
      <nav className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <div className="font-serif text-lg font-semibold tracking-tight">Spec Conformance</div>
        <div className="flex items-center gap-2.5">
          <Link href="/sign-in" className="btn-ghost">Log in</Link>
          <Link href="/sign-up" className="btn-accent">Get started</Link>
        </div>
      </nav>

      {/* Hero — centered, controlled scale */}
      <section className="max-w-3xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-12 text-center">
        <div className="label-mono mb-5">Built for wireless equipment makers</div>
        <h1 className="font-serif font-semibold tracking-tight text-balance text-[2.5rem] leading-[1.08] sm:text-5xl lg:text-[3.5rem] lg:leading-[1.04] mb-6">
          3GPP conformance, made <em className="text-accent-dark italic">signable</em>.
        </h1>
        <p className="text-mut text-lg leading-relaxed max-w-xl mx-auto">
          Upload your implementation docs and the target 3GPP release. Get an auditable conformance matrix where every verdict cites the exact clause — before anything runs.
        </p>
      </section>

      {/* Product demo — animated: upload → analyze → result, looping */}
      <section className="max-w-3xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <div className="card p-5 sm:p-6 shadow-[0_30px_80px_-24px_rgba(28,35,43,.4)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="meta-mono">NTN RRC conformance · Rel-18</div>
            <div className="demo-steps">
              <span className="demo-step demo-step-1">Upload</span>
              <span className="demo-step demo-step-2">Analyze</span>
              <span className="demo-step demo-step-3">Result</span>
              <span className="demo-step demo-step-4">Export</span>
            </div>
          </div>

          <div className="demo-stage">
            {/* 1 — Upload */}
            <div className="demo-scene demo-scene-1">
              <div className="demo-lbl">Uploading documents…</div>
              <div className="demo-drop">
                <div className="demo-file">ts38331-extrait.txt</div>
                <div className="demo-file">impl-test.txt</div>
              </div>
            </div>
            {/* 2 — Analyze */}
            <div className="demo-scene demo-scene-2">
              <div className="demo-lbl">Navigating the clause graph…</div>
              <div className="demo-scan">
                <div className="demo-sweep" />
                <div className="demo-cl">5.3  RRC connection control</div>
                <div className="demo-cl">5.3.3  RRC connection establishment</div>
                <div className="demo-cl">5.3.5  RRC connection reconfiguration</div>
              </div>
            </div>
            {/* 3 — Result */}
            <div className="demo-scene demo-scene-3">
              <div className="demo-pills">
                <span className="pill-ok">39 conformant</span>
                <span className="pill-err">5 gaps</span>
                <span className="pill-warn">4 review</span>
              </div>
              <div className="rounded-md border-l-2 border-accent bg-accent-soft p-3 mt-1">
                <div className="font-mono text-[11px] text-accent-dark mb-1">3GPP TS 38.331 v18.3.0 §5.5.3</div>
                <div className="text-[13px] leading-relaxed">The UE shall consider the ephemeris valid for the duration of the validity timer.</div>
              </div>
            </div>
            {/* 4 — Export */}
            <div className="demo-scene demo-scene-4">
              <div className="demo-lbl">Exporting the matrix…</div>
              <div className="demo-file"><span>NTN_RRC_conformance.xlsx</span><span className="demo-dl">↓ .xlsx</span></div>
            </div>
          </div>

          <div className="demo-bar"><i /></div>
        </div>
      </section>

      {/* Feature row — neutral band */}
      <section className="border-t border-black/[.06] bg-neutral-50">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 grid gap-5 sm:grid-cols-3">
          <Prop ic="§" title="Cites only your sources" body="Every verdict is grounded in the uploaded spec, with the exact clause quoted verbatim." />
          <Prop ic="⇄" title="Shift-left" body="Catch conformance gaps at your desk, before certification or interop testing." />
          <Prop ic="✓" title="Signable" body="An independent verifier plus calibrated confidence flags anything needing human review." />
        </div>
      </section>

      <footer className="border-t border-black/[.06] py-7 text-center text-mut text-sm">Spec Conformance Agent · 3GPP / O-RAN document conformance</footer>
    </main>
  );
}

function Prop({ ic, title, body }: { ic: string; title: string; body: string }) {
  return (
    <div className="card p-6">
      <div className="font-mono text-2xl text-accent-dark mb-3">{ic}</div>
      <h3 className="font-serif text-lg font-semibold mb-2">{title}</h3>
      <p className="text-mut text-sm leading-relaxed">{body}</p>
    </div>
  );
}
