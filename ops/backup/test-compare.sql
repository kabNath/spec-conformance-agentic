-- One line per table: row count and an order-independent content hash. Equal output on source and restored database = identical data.
SELECT 'Organization', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "Organization" t UNION ALL
SELECT 'Asset', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "Asset" t UNION ALL
SELECT 'ConformanceRun', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "ConformanceRun" t UNION ALL
SELECT 'EvaluatedRequirement', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "EvaluatedRequirement" t UNION ALL
SELECT 'RejectedQuote', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "RejectedQuote" t UNION ALL
SELECT 'ApiKey', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "ApiKey" t UNION ALL
SELECT 'McpToolCall', count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM "McpToolCall" t UNION ALL
SELECT '_prisma_migrations', count(*), '' FROM "_prisma_migrations" UNION ALL
SELECT 'indexes', count(*), md5(string_agg(indexdef, '|' ORDER BY indexname)) FROM pg_indexes WHERE schemaname = 'public'
ORDER BY 1;
