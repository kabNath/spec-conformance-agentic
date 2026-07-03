"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

// Mobile navigation: a hamburger (shown < lg) that opens the Sidebar as a
// slide-in drawer. The static sidebar handles ≥ lg. Closes on route change.
export default function MobileNav({ userName, orgName }: { userName: string; orgName: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]); // close after navigating

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="lg:hidden inline-flex items-center justify-center w-9 h-9 -ml-1 rounded-md border border-line text-ink transition hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Drawer + scrim (mobile only) */}
      <div className={`lg:hidden fixed inset-0 z-50 overflow-hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <div className={`absolute inset-y-0 left-0 max-w-[85vw] shadow-2xl transition-transform duration-200 motion-reduce:transition-none ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <Sidebar userName={userName} orgName={orgName} />
        </div>
      </div>
    </>
  );
}
