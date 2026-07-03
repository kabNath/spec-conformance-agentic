"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";

const SECTIONS: { title: string; items: { href: string; label: string; ic: string; badge?: string }[] }[] = [
  { title: "Main", items: [
    { href: "/onboarding", label: "Onboarding", ic: "🚀", badge: "Start" },
    { href: "/dashboard",  label: "Dashboard",  ic: "📊" },
  ]},
  { title: "Conformance", items: [
    { href: "/runs/new", label: "New check", ic: "✅", badge: "NEW" },
  ]},
  { title: "Account", items: [
    { href: "/settings", label: "Settings", ic: "⚙" },
  ]},
];

export default function Sidebar({ userName, orgName }: { userName: string; orgName: string }) {
  const pathname = usePathname();
  return (
    <aside className="w-[260px] shrink-0 bg-panel border-r border-white/10 flex flex-col h-screen relative text-[#c2c8ce]">
      <div className="px-5 pt-5 pb-3 border-b border-white/10 relative">
        <div className="font-serif font-semibold text-[17px] tracking-tight text-[#f4f3f0]">Spec Conformance</div>
        <div className="font-mono text-[9px] tracking-wider2 uppercase mt-0.5 text-[#6b7480]">3GPP / O-RAN · AI agent</div>
        <span className="absolute left-5 right-5 bottom-0 h-px bg-gradient-to-r from-accent to-transparent" />
      </div>

      <div className="px-3 pt-3">
        <OrganizationSwitcher hidePersonal appearance={{ elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between text-[#c2c8ce]" } }} />
      </div>

      <nav className="flex-1 overflow-y-auto py-2 mt-1">
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="sb-section">{sec.title}</div>
            {sec.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(it.href + "/");
              return (
                <Link key={it.href} href={it.href}
                  className={`sb-item ${active ? "sb-item-active border-l-2 border-accent" : "border-l-2 border-transparent"}`}>
                  <span className="w-4 text-center text-[15px] opacity-80">{it.ic}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.badge && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">{it.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3 flex items-center gap-2.5">
        <UserButton afterSignOutUrl="/" />
        <div className="flex-1 min-w-0">
          <div className="font-serif text-[12px] text-[#f4f3f0] truncate">{userName}</div>
          <div className="font-mono text-[9px] tracking-wider2 uppercase text-[#6b7480]">{orgName}</div>
        </div>
      </div>
    </aside>
  );
}
