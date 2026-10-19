import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ROUTES } from "../../api/v1";
import { CheckConformanceInput, ExtractRequirementsInput, SearchSpecInput } from "../../mcp/schemas";

const doc = parse(readFileSync(fileURLToPath(new URL("../../docs/openapi.yaml", import.meta.url)), "utf8"));

describe("docs/openapi.yaml", () => {
  it("documents exactly the routes the handler serves", () => {
    const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops as object).map((m) => `${m.toUpperCase()} ${p}`));
    expect(documented.sort()).toEqual([...ROUTES].sort());
  });
  it("has request examples that the real input schemas accept", () => {
    const ex = (path: string) => doc.paths[path].post.requestBody.content["application/json"].example;
    expect(CheckConformanceInput.safeParse(ex("/check")).success).toBe(true);
    expect(SearchSpecInput.safeParse(ex("/search")).success).toBe(true);
    expect(ExtractRequirementsInput.safeParse(ex("/extract")).success).toBe(true);
  });
  it("lists every error code of the implementation", async () => {
    const { toErrorBody } = await import("../../mcp/errors");
    void toErrorBody;
    const src = readFileSync(fileURLToPath(new URL("../../mcp/errors.ts", import.meta.url)), "utf8");
    const codes = [...src.matchAll(/\|\s+"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...doc.components.schemas.Error.properties.error.properties.code.enum].sort()).toEqual(codes.sort());
  });
});
