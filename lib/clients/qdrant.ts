// Qdrant — vector store for the VECTOR FALLBACK only (primary retrieval is the
// vectorless Neo4j graph-walk). One collection per deployment, filtered by orgId.
import { QdrantClient } from "@qdrant/js-client-rest";

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY || undefined,
});

export const CLAUSE_COLLECTION = "clause_chunks";
export const VECTOR_DIM = 1536; // text-embedding-3-small

export async function ensureCollection() {
  const exists = await qdrant.collectionExists(CLAUSE_COLLECTION);
  if (!exists.exists) {
    await qdrant.createCollection(CLAUSE_COLLECTION, {
      vectors: { size: VECTOR_DIM, distance: "Cosine" },
    });
  }
}

/** Fallback search: nearest clauses for a query vector, scoped to org + standard. */
export async function searchClauses(orgId: string, standardId: string, vector: number[], limit = 5) {
  const res = await qdrant.search(CLAUSE_COLLECTION, {
    vector, limit,
    filter: { must: [{ key: "orgId", match: { value: orgId } }, { key: "standardId", match: { value: standardId } }] },
  });
  return res.map((p) => (p.payload as { clause: string }).clause);
}
