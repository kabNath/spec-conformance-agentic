// A LangGraph workflow that completes a multi-step conformance task THROUGH the MCP server (no direct access to the
// database, the graph or the models): for each requirement it searches the spec, checks conformance, and verifies the
// signed verdict; abstentions are collected for human review instead of being retried.
//
// The routing is fixed code (no LLM chooses the next step), which keeps the example runnable without model keys; swap
// `route` for an LLM call if you want an agent that plans. Run against a real server:
//   CONFORMANCE_API_KEY=sca_… npx tsx examples/mcp/agent-client.ts lcp100 "The terminal starts timer T901 …"
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Json = Record<string, unknown>;
export interface Finding {
  requirement: string; verdict: string; abstained: boolean; verdict_id: string; clause: string | null;
  integrity_valid: boolean | null; signer_trusted: boolean | null; record_ids: string[];
}

const State = Annotation.Root({
  specId: Annotation<string>(),
  queue: Annotation<string[]>(),
  current: Annotation<Json | null>({ reducer: (_, n) => n, default: () => null }),
  hits: Annotation<Json[]>({ reducer: (_, n) => n, default: () => [] }),
  recordIds: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),
  findings: Annotation<Finding[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
  toReview: Annotation<string[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
});

async function tool(client: Client, name: string, args: Json): Promise<Json> {
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse((r.content as { text: string }[])[0].text) as Json;
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  return body;
}
const recordId = (b: Json) => (b.call as { record_id: string }).record_id;

export function buildAgent(client: Client) {
  return new StateGraph(State)
    .addNode("search", async (s) => {
      const b = await tool(client, "search_spec", { query: s.queue[0], spec_id: s.specId, top_k: 3 });
      return { hits: b.hits as Json[], recordIds: [recordId(b)] };
    })
    .addNode("check", async (s) => {
      const clause = (s.hits[0]?.clause as string | undefined) ?? undefined; // use the best hit as a hint when there is one
      const b = await tool(client, "check_conformance", { requirement_text: s.queue[0], spec_id: s.specId, ...(clause ? { clause } : {}) });
      return { current: b, recordIds: [...s.recordIds, recordId(b)] };
    })
    .addNode("verify", async (s) => {
      const v = await tool(client, "verify_verdict", { verdict_id: s.current!.verdict_id });
      const c = s.current!;
      const f: Finding = {
        requirement: c.requirement as string, verdict: c.verdict as string, abstained: false, verdict_id: c.verdict_id as string,
        clause: ((c.citations as Json[])[0]?.clause as string) ?? null, integrity_valid: v.integrity_valid as boolean,
        signer_trusted: v.signer_trusted as boolean, record_ids: [...s.recordIds, recordId(v)],
      };
      return { findings: [f], queue: s.queue.slice(1), current: null };
    })
    .addNode("escalate", async (s) => {
      const c = s.current!;
      const f: Finding = {
        requirement: c.requirement as string, verdict: c.verdict as string, abstained: true, verdict_id: c.verdict_id as string,
        clause: ((c.citations as Json[])[0]?.clause as string) ?? null, integrity_valid: null, signer_trusted: null, record_ids: s.recordIds,
      };
      return { findings: [f], toReview: [c.requirement as string], queue: s.queue.slice(1), current: null };
    })
    .addEdge(START, "search")
    .addEdge("search", "check")
    // The model-free routing decision: abstentions go to a human, committed verdicts get their signature verified.
    .addConditionalEdges("check", (s) => (s.current!.abstained ? "escalate" : "verify"), { escalate: "escalate", verify: "verify" })
    .addConditionalEdges("verify", (s) => (s.queue.length ? "search" : END), { search: "search", [END]: END })
    .addConditionalEdges("escalate", (s) => (s.queue.length ? "search" : END), { search: "search", [END]: END })
    .compile();
}

export async function runConformanceTask(client: Client, specId: string, requirements: string[]) {
  const final = await buildAgent(client).invoke({ specId, queue: requirements }, { recursionLimit: 10 + requirements.length * 6 });
  return { findings: final.findings as Finding[], needsHumanReview: final.toReview as string[] };
}

async function main() {
  const [specId, ...reqs] = process.argv.slice(2);
  if (!specId || !reqs.length) { console.error("usage: agent-client.ts <spec_id> <requirement>..."); process.exit(2); }
  const client = new Client({ name: "agent-client", version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["conformance-mcp"], env: process.env as Record<string, string> }));
  const report = await runConformanceTask(client, specId, reqs);
  console.log(JSON.stringify(report, null, 2));
  await client.close();
}
if (process.argv[1]?.endsWith("agent-client.ts")) main().catch((e) => { console.error(e); process.exit(1); });
