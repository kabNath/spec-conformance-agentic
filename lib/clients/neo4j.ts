// Neo4j — the clause cross-reference GRAPH. This is the substrate the vectorless
// navigator walks: (:Clause)-[:CHILD]->(:Clause) and (:Clause)-[:XREF]->(:Clause).
import neo4j, { type Driver } from "neo4j-driver";

const g = globalThis as unknown as { neo4j?: Driver };
export const driver: Driver =
  g.neo4j ??
  neo4j.driver(process.env.NEO4J_URI!, neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!));
if (process.env.NODE_ENV !== "production") g.neo4j = driver;

/** Cross-references one hop out from a clause (the graph-walk edges). */
export async function neighbours(standardId: string, clause: string): Promise<string[]> {
  const session = driver.session();
  try {
    const r = await session.run(
      `MATCH (c:Clause {standardId:$standardId, clause:$clause})-[:XREF]->(n:Clause)
       RETURN n.clause AS clause`,
      { standardId, clause }
    );
    return r.records.map((rec) => rec.get("clause"));
  } finally { await session.close(); }
}

/** A clause node's properties as stored in the graph. */
export type ClauseNode = { clause: string; title: string; text: string; normative?: string | null };

/** Read a clause's title + body from the graph. */
export async function getClause(standardId: string, clause: string): Promise<ClauseNode | null> {
  const session = driver.session();
  try {
    const r = await session.run(
      `MATCH (c:Clause {standardId:$standardId, clause:$clause}) RETURN c LIMIT 1`,
      { standardId, clause }
    );
    return (r.records[0]?.get("c").properties as ClauseNode | undefined) ?? null;
  } finally { await session.close(); }
}
