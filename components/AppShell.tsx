import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { demoEnabled } from "@/lib/demo";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const demo = demoEnabled(process.env, (await headers()).get("host"));
  if (demo) {
    return (
      <div className="flex h-screen overflow-hidden bg-white">
        <div className="hidden lg:block shrink-0"><Sidebar userName="Demo user" orgName="demo (no auth)" demo /></div>
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="bg-amber-100 text-amber-900 text-xs px-4 py-1.5 border-b border-amber-300">DEMO MODE — authentication is disabled. Local use only (127.0.0.1); never enable in production.</div>
          <Topbar userName="Demo user" orgName="demo (no auth)" />
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    );
  }
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");
  // Clerk requires an active Organization (= tenant) for the app; send them to onboarding to create one.
  if (!orgId) redirect("/onboarding");

  const user = await currentUser();
  const name = user?.firstName ?? user?.username ?? "You";

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <div className="hidden lg:block shrink-0">
        <Sidebar userName={name} orgName={orgSlug ?? "Organization"} />
      </div>
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar userName={name} orgName={orgSlug ?? "Organization"} />
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
