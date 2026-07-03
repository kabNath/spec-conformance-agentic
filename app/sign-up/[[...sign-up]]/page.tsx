import { SignUp } from "@clerk/nextjs";
export default function Page() { return <div className="min-h-screen grid place-items-center bg-tint"><SignUp afterSignUpUrl="/onboarding" /></div>; }
