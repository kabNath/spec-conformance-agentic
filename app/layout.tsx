import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
export const metadata = { title: "Spec Conformance Agent", description: "3GPP/O-RAN conformance — auditable, signable." };
export const viewport = { width: "device-width", initialScale: 1 };
// The app is wrapped in <ClerkProvider>, which requires the publishable key at
// render time. Render on-request (no static prerender) so the build never needs
// Clerk keys — correct for an auth-gated app whose pages are all per-request.
export const dynamic = "force-dynamic";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<ClerkProvider><html lang="en"><body>{children}</body></html></ClerkProvider>);
}
