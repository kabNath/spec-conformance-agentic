// Offline tests for the local demo mode switch (lib/demo.ts). Run: npx tsx scripts/test-demo-mode.ts
import { demoEnabled, isLocalHost, DEMO_ORG_ID } from "../lib/demo";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

check("disabled by default (variable unset)", demoEnabled({ NODE_ENV: "development" }, "localhost:3000") === false);
check("disabled unless the value is exactly 1 ('true', 'yes', '0', '' do not enable it)",
  ["true", "yes", "0", "", "TRUE", " 1"].every((v) => demoEnabled({ DEMO_MODE: v, NODE_ENV: "development" }, "localhost:3000") === false));
check("enabled with DEMO_MODE=1 in development on localhost / 127.0.0.1 / [::1], with or without port",
  ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000"].every((h) => demoEnabled({ DEMO_MODE: "1", NODE_ENV: "development" }, h) === true));
check("never enabled for another host (LAN address, public name, spoof attempts)",
  ["192.168.1.5:3000", "example.com", "localhost.evil.com", "evil.com:3000", "127.0.0.1.evil.com", "", null, undefined].every((h) => demoEnabled({ DEMO_MODE: "1", NODE_ENV: "development" }, h as string) === false));
check("REFUSED in production: DEMO_MODE=1 with NODE_ENV=production throws (fails closed, whatever the host)",
  throws(() => demoEnabled({ DEMO_MODE: "1", NODE_ENV: "production" }, "localhost:3000")) && throws(() => demoEnabled({ DEMO_MODE: "1", NODE_ENV: "production" }, "example.com")));
check("production without the variable is simply disabled", demoEnabled({ NODE_ENV: "production" }, "localhost") === false);
check("the demo organisation id cannot be a real Clerk org id", DEMO_ORG_ID.startsWith("org_demo_") && !/^org_[0-9A-Za-z]{27}$/.test(DEMO_ORG_ID));
check("isLocalHost", isLocalHost("localhost") && isLocalHost("127.0.0.1:80") && !isLocalHost("0.0.0.0:3000"));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall demo-mode tests passed");
