import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CreateOrganization } from "@clerk/nextjs";
import Link from "next/link";

export default async function Onboarding() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (orgId) {
    // already has an active org → skip to the app
    return (
      <div className="max-w-3xl mx-auto py-10 text-center space-y-4">
        <h1 className="font-serif text-3xl font-bold">You're set up</h1>
        <p className="text-mut">Your organization is active.</p>
        <Link href="/runs/new" className="btn-accent">Run your first check →</Link>
      </div>
    );
  }
  return (
    <div className="max-w-xl mx-auto py-10 space-y-6">
      <header className="text-center">
        <h1 className="font-serif text-3xl font-bold">Create your organization</h1>
        <div className="label-mono mt-2">Your org is your tenant — its data is isolated from everyone else</div>
      </header>
      <div className="grid place-items-center"><CreateOrganization afterCreateOrganizationUrl="/dashboard" /></div>
    </div>
  );
}
