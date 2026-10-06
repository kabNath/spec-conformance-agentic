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

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
