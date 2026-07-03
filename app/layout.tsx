import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
export const metadata = { title: "Spec Conformance Agent", description: "3GPP/O-RAN conformance — auditable, signable." };
export const viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<ClerkProvider><html lang="en"><body>{children}</body></html></ClerkProvider>);
}
