// Tenant scoping — replaces Supabase RLS. With Clerk, the active organization id
// is the tenant. EVERY data-access call must go through orgId from here.
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { demoEnabled, DEMO_ORG_ID, DEMO_USER_ID } from "./demo";

export async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  // Local demo mode: one fixed demo organisation, never a real tenant (lib/demo.ts).
  if (demoEnabled(process.env, (await headers()).get("host"))) return { orgId: DEMO_ORG_ID, userId: DEMO_USER_ID };
  const { orgId, userId } = await auth();
  if (!userId) throw new Error("Unauthenticated");
  if (!orgId) throw new Error("No active organization selected");
  return { orgId, userId };
}
