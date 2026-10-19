// API keys: "sca_" + 40 hex chars. Only the SHA-256 is stored; `prefix` (the first 12 characters) finds the row.
// One active key per organisation (database constraint); rotate with scripts/create-api-key.ts --rotate.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { McpToolError } from "./errors";

export const KEY_PREFIX_LEN = 12;

export interface ApiKeyRow { id: string; orgId: string; keyHash: string; revokedAt: Date | null }
export interface KeyStore {
  findByPrefix(prefix: string): Promise<ApiKeyRow | null>;
  touch(id: string): Promise<void>;
}
export interface Principal { orgId: string; apiKeyId: string }

export const hashApiKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = "sca_" + randomBytes(20).toString("hex");
  return { key, prefix: key.slice(0, KEY_PREFIX_LEN), keyHash: hashApiKey(key) };
}

/** Resolves a raw key to its organisation. Every failure is the same `unauthorized` error (no oracle on why). */
export async function authenticate(store: KeyStore, rawKey: string | undefined | null): Promise<Principal> {
  const fail = () => new McpToolError("unauthorized", "Missing, unknown or revoked API key");
  if (!rawKey || !/^sca_[0-9a-f]{40}$/.test(rawKey)) throw fail();
  const row = await store.findByPrefix(rawKey.slice(0, KEY_PREFIX_LEN));
  if (!row || row.revokedAt) throw fail();
  const a = Buffer.from(hashApiKey(rawKey), "hex"), b = Buffer.from(row.keyHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw fail();
  await store.touch(row.id).catch(() => undefined); // lastUsedAt is informative; never block a call on it
  return { orgId: row.orgId, apiKeyId: row.id };
}
