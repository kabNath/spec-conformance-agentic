import { createHash } from "node:crypto";

/** JSON with sorted object keys: the same value always hashes the same. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v ?? null);
}
export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const hashValue = (v: unknown) => sha256Hex(stableStringify(v));
