import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)", "/runs(.*)", "/api/runs(.*)", "/onboarding(.*)", "/settings(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
    });
  }
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
