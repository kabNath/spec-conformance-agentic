#!/usr/bin/env node
// `npx conformance-mcp` — stdio MCP server. Needs CONFORMANCE_API_KEY and the service env (DATABASE_URL, NEO4J_*, QDRANT_*,
// OPENROUTER_API_KEY, VIDIMUS_URL). Runs the TypeScript sources through tsx.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { tsImport } = await import("tsx/esm/api");
await tsImport(pathToFileURL(join(root, "mcp", "main.ts")).href, import.meta.url);
