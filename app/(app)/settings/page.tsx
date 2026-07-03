import { auth } from "@clerk/nextjs/server";
export default async function Settings() {
  const { orgId, orgSlug, userId } = await auth();
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="font-serif text-2xl">Settings</h1>
      <div className="card p-5 space-y-2 text-sm">
        <div><span className="text-mut">Organization:</span> {orgSlug ?? orgId}</div>
        <div><span className="text-mut">User:</span> {userId}</div>
        <div className="meta-mono pt-2">Tenant isolation is app-layer (Clerk orgId), not DB RLS.</div>
      </div>
    </div>
  );
}
