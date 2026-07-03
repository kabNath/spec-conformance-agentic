"use client";
import { usePathname } from "next/navigation";
import MobileNav from "./MobileNav";
const TITLES: Record<string, string> = { "/dashboard": "Dashboard", "/runs/new": "New conformance check", "/onboarding": "Onboarding", "/settings": "Settings" };
export default function Topbar({ userName, orgName }: { userName: string; orgName: string }) {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? (pathname.startsWith("/runs/") ? "Conformance matrix" : "—");
  return (
    <div className="h-[52px] bg-white border-b border-line flex items-center px-4 sm:px-5 gap-3 shrink-0">
      <MobileNav userName={userName} orgName={orgName} />
      <div className="font-mono text-[10px] text-mut-2 flex items-center gap-1.5 min-w-0">
        <span className="hidden sm:inline">Spec Conformance</span>
        <span className="hidden sm:inline text-line">›</span>
        <span className="text-ink font-medium truncate">{title}</span>
      </div>
    </div>
  );
}
