import Link from "next/link";
import { requireOrg } from "@/lib/tenant";
import { prisma } from "@/lib/clients/prisma";

export default async function Dashboard() {
  const { orgId } = await requireOrg();
  const runs = await prisma.conformanceRun.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl">Conformance runs</h1>
        <Link href="/runs/new" className="btn-accent">New conformance check</Link>
      </div>
      {runs.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="font-serif text-lg mb-1">No runs yet</div>
          <p className="text-mut text-sm mb-4">Upload a 3GPP spec + your implementation doc to produce a conformance matrix.</p>
          <Link href="/runs/new" className="btn-accent">Start your first check</Link>
        </div>
      ) : (
        <div className="card"><div className="card-b divide-y divide-line">
          {runs.map((r) => {
            const s = (r.summary ?? {}) as { total?: number; gaps?: number; needsReview?: number };
            return (
              <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center gap-3 py-3 hover:bg-tint px-2 -mx-2 rounded">
                <div className="flex-1 min-w-0"><div className="font-serif text-sm truncate">{r.name}</div><div className="meta-mono">{r.targetRelease} · {r.createdAt.toLocaleDateString()}</div></div>
                <span className="pill bg-tint text-mut">{r.status}</span>
                {typeof s.total === "number" && <span className="meta-mono">{s.total} reqs · {s.gaps ?? 0} gaps · {s.needsReview ?? 0} review</span>}
              </Link>
            );
          })}
        </div></div>
      )}
    </div>
  );
}
