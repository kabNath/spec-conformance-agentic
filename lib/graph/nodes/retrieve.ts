import { neighbours, getClause, type ClauseNode } from "../../clients/neo4j";
import { searchClauses } from "../../clients/qdrant";
import { llmJSON } from "../../clients/openrouter";
import { citationDisplay, type ClauseCitation, type NormativeKeyword } from "../../conformance-contract";
import { selectWindow } from "../../citation-window";
import type { ConformanceStateT } from "../state";

const MAX_HOPS = 4, MAX_RESEEDS = 2;

export async function embed(text: string): Promise<number[]> {
  // OpenRouter/OpenAI embeddings via the LangChain OpenAI embeddings endpoint.
  const { OpenAIEmbeddings } = await import("@langchain/openai");
  const e = new OpenAIEmbeddings({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.EMBEDDINGS_MODEL ?? "openai/text-embedding-3-small",
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
  });
  return e.embedQuery(text);
}

/** The citation for a clause that was read in the graph: relevance-selected window of its text, normative force, display string. */
export async function citationFromClause(
  meta: { spec: string; version: string; release: string }, standardId: string, clause: string, requirement: string,
): Promise<ClauseCitation> {
  const c = await getClause(standardId, clause);
  // Relevance-selected window (was: first 500 chars, which clipped the governing sentence — R06/R08).
  const win = selectWindow(String(c?.text ?? ""), requirement);
  const base = {
    spec: meta.spec, version: meta.version, release: meta.release,
    clause, clauseTitle: c?.title, text: win.text, charStart: win.start, charEnd: win.end,
    normative: (c?.normative ?? "none") as NormativeKeyword,
  };
  return { ...base, display: citationDisplay(base) };
}

/** Retrieval for ONE requirement outside a LangGraph run (MCP check_conformance): the same navigator, same fallback. */
export async function retrieveForRequirement(input: {
  requirement: string; orgId: string; standardId: string; standardMeta: { spec: string; version: string; release: string };
}): Promise<{ citations: ClauseCitation[]; path: string[] }> {
  const r = await retrieveNode({
    orgId: input.orgId, standardId: input.standardId, standardMeta: input.standardMeta,
    requirements: [{ requirement: input.requirement }], cursor: 0,
  } as ConformanceStateT);
  return { citations: r.citations ?? [], path: r.path ?? [] };
}

interface NavStep { action: "read" | "follow" | "done" | "stuck"; clause?: string; done?: boolean }

export async function retrieveNode(s: ConformanceStateT): Promise<Partial<ConformanceStateT>> {
  const req = s.requirements[s.cursor];
  const path: string[] = [];
  let seed: string[] = [];

  for (let reseed = 0; reseed <= MAX_RESEEDS; reseed++) {
    let current: string | null = seed[0] ?? null;
    let found: string | null = null;

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const node: ClauseNode | null = current ? await getClause(s.standardId, current) : null;
      const nbrs = current ? await neighbours(s.standardId, current) : [];
      const sys =
        "You navigate a 3GPP spec graph like an expert. Decide the next action. " +
        "Only ever choose a clause id listed in CANDIDATE CLAUSES or XREFS — never invent " +
        'an id, and never use a spec number such as "38.331" (that is a document, not a clause). ' +
        'Reply ONLY JSON {"action":"read|follow|done|stuck","clause":"<id>","done":<bool>}.';
      const user: string =
        `REQUIREMENT:\n${req.requirement}\n\n` +
        (seed.length ? `CANDIDATE CLAUSES: ${seed.join(", ")}\n` : "") +
        (node ? `CURRENT ${node.clause} "${node.title}":\n${String(node.text).slice(0, 1200)}\nXREFS: ${nbrs.join(", ") || "none"}\n`
              : "No clause read yet. Pick a candidate or say stuck.\n");
      const step: NavStep = await llmJSON<NavStep>(sys, user);
      if (step.action === "stuck") break;
      if (step.action === "done" && current) { found = current; break; }
      if ((step.action === "read" || step.action === "follow") && step.clause) {
        // Only follow clauses that actually exist in the graph. This drops
        // hallucinated ids and spec numbers like "38.331" that are not clause
        // nodes — following those otherwise burned the entire hop budget going
        // nowhere. If the pick is invalid, stop walking and fall through to the
        // Qdrant re-seed, which supplies real clause ids to start from.
        const target = await getClause(s.standardId, step.clause);
        if (!target) break;
        current = step.clause; path.push(step.clause);
        if (step.done) { found = current; break; }
      } else break;
    }

    if (found) {
      return { citations: [await citationFromClause(s.standardMeta, s.standardId, found, req.requirement)], path };
    }

    // stalled → Qdrant fallback re-seed
    if (reseed < MAX_RESEEDS) {
      const vec = await embed(req.requirement);
      seed = await searchClauses(s.orgId, s.standardId, vec);
      if (seed.length === 0) break;
    }
  }
  return { citations: [], path };
}
