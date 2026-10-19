-- Representative rows for every table the product writes (JSON columns, the partial unique index, FKs).
INSERT INTO "Organization"(id, name) VALUES ('org_a', 'Org A'), ('org_b', 'Org B');
INSERT INTO "Asset"(id, "orgId", kind, name, spec, version, release) VALUES ('as1', 'org_a', 'standard', 'lcp100.txt', 'LCP 100', '1.0.0', 'Rel-0');
INSERT INTO "ConformanceRun"(id, "orgId", name, status, summary) VALUES ('run1', 'org_a', 'MCP check_conformance', 'complete', '{"total":2}');
INSERT INTO "EvaluatedRequirement"(id, "runId", "orgId", requirement, source, citations, verdict, normative, confidence, verifier, review, attestation, trace)
VALUES
 ('ev1', 'run1', 'org_a', 'The terminal sends a SessionRequest.', '{"documentId":"lcp100"}', '[{"display":"LCP 100 §5.3.3"}]', 'conformant', 'shall', 0.94,
  '{"agrees":true,"confidence":0.9,"note":"ok"}', '{"required":false}', '{"keyId":"k","signature":"s","contentHash":"h"}', '{"version":"trace-v1","requestId":"req-12345678"}'),
 ('ev2', 'run1', 'org_a', 'The terminal encrypts the channel. ✓ 中文', '{}', '[]', 'insufficient_evidence', 'none', 0.2,
  '{"agrees":true,"confidence":0.5,"note":"No clause to verify."}', '{"required":true,"reason":"no_clause_found"}', NULL, NULL);
INSERT INTO "RejectedQuote"(id, "requirementId", "orgId", text, sha256, length) VALUES ('rq1', 'ev2', 'org_a', 'a rejected quote', 'abc', 16);
INSERT INTO "ApiKey"(id, "orgId", name, prefix, "keyHash") VALUES ('k1', 'org_a', 'old', 'sca_aaaaaaaa', 'h1'), ('k2', 'org_b', 'b', 'sca_bbbbbbbb', 'h2');
UPDATE "ApiKey" SET "revokedAt" = now() WHERE id = 'k1';
INSERT INTO "ApiKey"(id, "orgId", name, prefix, "keyHash") VALUES ('k3', 'org_a', 'new', 'sca_cccccccc', 'h3');
INSERT INTO "McpToolCall"(id, "orgId", "apiKeyId", tool, "requestId", "inputSha256", "outputSha256", outcome, "latencyMs", "verdictId", signed, channel, "llmCalls", "inputTokens", "outputTokens")
VALUES ('c1', 'org_a', 'k3', 'check_conformance', 'req-12345678', repeat('a',64), repeat('b',64), 'ok', 1234, 'ev1', '{"signature":"sig"}', 'http', 3, 1000, 200);
