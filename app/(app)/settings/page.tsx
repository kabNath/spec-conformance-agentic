import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { demoEnabled, DEMO_ORG_ID, DEMO_USER_ID } from "@/lib/demo";
export default async function Settings() {
  const demo = demoEnabled(process.env, (await headers()).get("host"));
  const { orgId, orgSlug, userId } = demo ? { orgId: DEMO_ORG_ID, orgSlug: "demo (no auth)", userId: DEMO_USER_ID } : await auth();
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
