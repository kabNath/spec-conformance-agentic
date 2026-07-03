// Populate Neo4j (clause graph) + Qdrant (fallback vectors) from a spec file.
// Usage: tsx scripts/ingest.ts <orgId> <standardId> <spec> <version> <release> <file.txt>
// This is the step the vectorless navigator + vector fallback both depend on.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSpec } from "../lib/parser-3gpp";
import { driver } from "../lib/clients/neo4j";
import { qdrant, ensureCollection, CLAUSE_COLLECTION } from "../lib/clients/qdrant";
import { OpenAIEmbeddings } from "@langchain/openai";

// Qdrant point IDs must be an unsigned integer or a UUID — derive a stable UUID
// from `standardId:clause` so re-ingesting the same clause overwrites its point.
function pointId(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function main() {
  const [orgId, standardId, spec, version, release, file] = process.argv.slice(2);
  const text = readFileSync(file, "utf8");
  const tree = parseSpec(text, { spec, version, release });

  // 1) Neo4j — nodes + CHILD + XREF edges (the graph-walk substrate).
  const session = driver.session();
  try {
    for (const id of tree.order) {
      const n = tree.nodes[id];
      await session.run(
        `MERGE (c:Clause {standardId:$sid, clause:$clause})
         SET c.title=$title, c.text=$text, c.normative=$norm`,
        { sid: standardId, clause: id, title: n.title, text: n.text, norm: n.normative }
      );
    }
    for (const id of tree.order) {
      const n = tree.nodes[id];
      for (const child of n.children)
        await session.run(
          `MATCH (a:Clause {standardId:$sid, clause:$p}),(b:Clause {standardId:$sid, clause:$c}) MERGE (a)-[:CHILD]->(b)`,
          { sid: standardId, p: id, c: child });
      for (const x of n.xrefClauses)
        if (tree.nodes[x])
          await session.run(
            `MATCH (a:Clause {standardId:$sid, clause:$p}),(b:Clause {standardId:$sid, clause:$c}) MERGE (a)-[:XREF]->(b)`,
            { sid: standardId, p: id, c: x });
    }
  } finally { await session.close(); }

  // 2) Qdrant — embed each clause for the fallback path.
  await ensureCollection();
  const embedder = new OpenAIEmbeddings({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.EMBEDDINGS_MODEL ?? "openai/text-embedding-3-small",
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
  });
  const ids = tree.order;
  const vectors = await embedder.embedDocuments(ids.map((id) => `${id} ${tree.nodes[id].title}\n${tree.nodes[id].text.slice(0, 800)}`));
  await qdrant.upsert(CLAUSE_COLLECTION, {
    points: ids.map((id, i) => ({
      id: pointId(`${orgId}:${standardId}:${id}`),
      vector: vectors[i],
      payload: { orgId, standardId, clause: id },
    })),
  });

  console.log(`Ingested ${ids.length} clauses into Neo4j + Qdrant for ${spec} ${version}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
