// Entry point of the stdio server (bin/conformance-mcp.mjs and `npm run mcp`).
import { createRealDeps } from "./real-deps";
import { runStdio } from "./stdio";

runStdio(createRealDeps()).catch((e) => {
  console.error(`[conformance-mcp] ${(e as Error).message}`);
  process.exit(1);
});
