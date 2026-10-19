// LOCAL DEMO MODE — lets one person try the app on their own machine without a Clerk account.
//
//   DEMO_MODE=1 (exactly "1") AND NODE_ENV !== "production" AND the request Host is localhost/127.0.0.1/[::1]
//
// Off by default. With NODE_ENV=production and DEMO_MODE=1 it THROWS (the app fails closed, loudly) instead of
// silently serving an unauthenticated tenant. Start it with `npm run dev:demo`, which also binds the server to the
// loopback interface only (`-H localhost`): the Host-header check alone cannot stop a LAN client that sends "Host: localhost".
// (`-H 127.0.0.1` breaks Next's internal middleware proxy because `localhost` resolves to ::1 first.)
// Everything created in demo mode belongs to one fixed demo organisation, never to a real Clerk organisation.

export const DEMO_ORG_ID = "org_demo_local";
export const DEMO_USER_ID = "user_demo_local";

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host);
}

export function demoEnabled(env: { DEMO_MODE?: string; NODE_ENV?: string }, host: string | null | undefined): boolean {
  if (env.DEMO_MODE !== "1") return false;
  if (env.NODE_ENV === "production") throw new Error("DEMO_MODE=1 is not allowed when NODE_ENV=production: refusing to disable authentication");
  return isLocalHost(host);
}
