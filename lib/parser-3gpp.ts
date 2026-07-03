// ============================================================
// 3GPP-aware parser — THE MOAT (Phase 1)
// ------------------------------------------------------------
// A 3GPP spec is NOT flat prose. It has: hierarchical clause numbering
// (5, 5.3, 5.3.5, 5.3.5.1), tables, ASN.1 blocks, message sequence
// charts, and — decisively — normative keywords (shall / should / may).
// Generic chunking destroys all of that. This parser preserves it, and
// the structure it emits is exactly what the vectorless navigator walks.
//
// Replaces lib/rag.ts::chunkRegulation() from the AEC scaffold, whose
// article-based (第X條) splitting is wrong for 3GPP's decimal clauses.
// ============================================================

import type { NormativeKeyword } from "./conformance-contract";

// A clause heading like "5.3.5.1  Random access procedure initialization"
// 3GPP headings are a dotted number, 2+ spaces, then a title.
const CLAUSE_RE = /^(\d+(?:\.\d+)*)\s{2,}(.+?)\s*$/;

// Normative keywords, in priority order (strongest first).
const NORMATIVE_PATTERNS: { kw: NormativeKeyword; re: RegExp }[] = [
  { kw: "shall_not",  re: /\bshall not\b/i },
  { kw: "shall",      re: /\bshall\b/i },
  { kw: "should_not", re: /\bshould not\b/i },
  { kw: "should",     re: /\bshould\b/i },
  { kw: "may",        re: /\bmay\b/i },
];

// Cross-references: "clause 5.5.3", "subclause 5.3.5", "TS 38.300",
// "as defined in 38.331 [5]".  We capture both intra-doc clause refs
// and inter-doc spec refs.
const XREF_CLAUSE_RE = /\b(?:sub)?clause\s+(\d+(?:\.\d+)+)/gi;
const XREF_SPEC_RE = /\bTS\s?(\d{2}\.\d{3}(?:-\d+)?)/gi;

export interface ClauseNode {
  clause: string;             // "5.3.5"
  title: string;              // heading title
  depth: number;              // number of dotted segments
  text: string;               // body text of this clause (excl. children)
  normative: NormativeKeyword; // strongest force present in the body
  xrefClauses: string[];      // intra-doc clause references found in body
  xrefSpecs: string[];        // "38.300" style spec references found in body
  charStart: number;
  charEnd: number;
  children: string[];         // clause ids of direct children
}

export interface ClauseTree {
  spec: string;               // "TS 38.331"
  version: string;            // "18.3.0"
  release: string;            // "Rel-18"
  nodes: Record<string, ClauseNode>; // keyed by clause id
  roots: string[];            // top-level clause ids, in document order
  order: string[];            // all clause ids, in document order (the ToC)
}

/** Detect the strongest normative keyword present in a body of text. */
export function detectNormative(text: string): NormativeKeyword {
  for (const { kw, re } of NORMATIVE_PATTERNS) if (re.test(text)) return kw;
  return "none";
}

function extractXrefs(text: string): { clauses: string[]; specs: string[] } {
  const clauses = new Set<string>();
  const specs = new Set<string>();
  let m: RegExpExecArray | null;
  XREF_CLAUSE_RE.lastIndex = 0;
  while ((m = XREF_CLAUSE_RE.exec(text)) !== null) clauses.add(m[1]);
  XREF_SPEC_RE.lastIndex = 0;
  while ((m = XREF_SPEC_RE.exec(text)) !== null) specs.add(m[1]);
  return { clauses: [...clauses], specs: [...specs] };
}

const parentOf = (clause: string): string | null => {
  const i = clause.lastIndexOf(".");
  return i === -1 ? null : clause.slice(0, i);
};

/**
 * Parse a raw 3GPP spec text into a clause tree.
 * `meta` carries the spec/version/release the caller already knows
 * (from the upload form or the filename), since the cover page is noisy.
 */
export function parseSpec(
  raw: string,
  meta: { spec: string; version: string; release: string }
): ClauseTree {
  const text = raw.replace(/\r/g, "");
  const lines = text.split("\n");

  // 1) Locate every clause heading with its absolute char offset.
  const heads: { clause: string; title: string; depth: number; at: number }[] = [];
  let offset = 0;
  for (const line of lines) {
    const m = CLAUSE_RE.exec(line);
    if (m) {
      const clause = m[1];
      // Guard against decimals that are not headings (e.g. "3.14 seconds"):
      // real headings sit on their own line and the title is non-empty prose.
      heads.push({ clause, title: m[2].trim(), depth: clause.split(".").length, at: offset });
    }
    offset += line.length + 1; // +1 for the stripped "\n"
  }

  // 2) Body of each clause = text from its heading to the next heading.
  const nodes: Record<string, ClauseNode> = {};
  const order: string[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const start = h.at;
    const end = i + 1 < heads.length ? heads[i + 1].at : text.length;
    const body = text.slice(start, end);
    const { clauses, specs } = extractXrefs(body);
    nodes[h.clause] = {
      clause: h.clause,
      title: h.title,
      depth: h.depth,
      text: body.trim(),
      normative: detectNormative(body),
      xrefClauses: clauses.filter((c) => c !== h.clause),
      xrefSpecs: specs,
      charStart: start,
      charEnd: end,
      children: [],
    };
    order.push(h.clause);
  }

  // 3) Wire parent → child relationships (the tree the navigator walks).
  const roots: string[] = [];
  for (const id of order) {
    const p = parentOf(id);
    if (p && nodes[p]) nodes[p].children.push(id);
    else roots.push(id);
  }

  return { spec: meta.spec, version: meta.version, release: meta.release, nodes, roots, order };
}

/** A compact table-of-contents view — what the vectorless navigator reads first. */
export function tableOfContents(tree: ClauseTree, maxDepth = 3): string {
  return tree.order
    .filter((id) => tree.nodes[id].depth <= maxDepth)
    .map((id) => {
      const n = tree.nodes[id];
      const indent = "  ".repeat(n.depth - 1);
      const norm = n.normative !== "none" ? ` [${n.normative}]` : "";
      return `${indent}${n.clause}  ${n.title}${norm}`;
    })
    .join("\n");
}

/** Follow cross-references one hop out from a clause (the graph-walk edges). */
export function neighbours(tree: ClauseTree, clause: string): string[] {
  const n = tree.nodes[clause];
  if (!n) return [];
  return n.xrefClauses.filter((c) => tree.nodes[c]);
}
