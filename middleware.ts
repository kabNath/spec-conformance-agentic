import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { demoEnabled } from "./lib/demo";

const isProtected = createRouteMatcher(["/dashboard(.*)", "/runs(.*)", "/api/runs(.*)", "/onboarding(.*)", "/settings(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  // Local demo mode (DEMO_MODE=1, development, localhost only — see lib/demo.ts): no Clerk gate.
  if (demoEnabled(process.env, req.headers.get("host"))) return;
  if (isProtected(req)) {
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
    });
  }
});

// /api/mcp, /api/v1 and /api/healthz authenticate with an API key (or are public), never with a Clerk session: they are kept out of
// the Clerk middleware so they also work in a deployment that has no Clerk configuration (API-only self-hosting).
// The matcher must be a static literal (Next analyses it at build time): no template strings.
export const config = {
  matcher: ["/((?!_next|api/mcp|api/v1|api/healthz|.*\\..*).*)", "/(api(?!/(?:mcp|v1|healthz)(?:/|$))|trpc)(.*)"],
};
