// Create the API key of an organisation (for the MCP server). The key is printed ONCE; only its SHA-256 is stored.
//   npm run api-key:create -- <orgId> [name] [--rotate]
// One active key per organisation: without --rotate the script refuses if one exists; with --rotate it revokes it first.
import { PrismaClient } from "@prisma/client";
import { generateApiKey } from "../mcp/auth";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rotate = process.argv.includes("--rotate");
  const [orgId, name = "mcp"] = args;
  if (!orgId) { console.error("usage: create-api-key.ts <orgId> [name] [--rotate]"); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const active = await prisma.apiKey.findFirst({ where: { orgId, revokedAt: null } });
    if (active && !rotate) { console.error(`Organisation ${orgId} already has an active key (${active.prefix}…). Use --rotate to replace it.`); process.exit(1); }
    const k = generateApiKey();
    await prisma.$transaction(async (tx) => {
      if (active) await tx.apiKey.update({ where: { id: active.id }, data: { revokedAt: new Date() } });
      await tx.organization.upsert({ where: { id: orgId }, update: {}, create: { id: orgId, name: orgId } });
      await tx.apiKey.create({ data: { orgId, name, prefix: k.prefix, keyHash: k.keyHash } });
    });
    console.log(`API key for ${orgId}${active ? ` (replaces ${active.prefix}…)` : ""}. Copy it now, it cannot be shown again:\n\n  ${k.key}\n`);
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
