// Tenant scoping — replaces Supabase RLS. With Clerk, the active organization id
// is the tenant. EVERY data-access call must go through orgId from here.
import { auth } from "@clerk/nextjs/server";

export async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  const { orgId, userId } = await auth();
  if (!userId) throw new Error("Unauthenticated");
  if (!orgId) throw new Error("No active organization selected");
  return { orgId, userId };
}
