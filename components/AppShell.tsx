import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default async function AppShell({ children }: { children: React.ReactNode }) {
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
