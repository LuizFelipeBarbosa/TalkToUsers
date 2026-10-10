// Graph model, risk propagation and hidden-risk detection. Pure functions, no UI.
//
// Edge direction follows the money: investor -> investee, buyer -> seller,
// acquirer -> acquired, owner -> subsidiary. A shock to one company travels both ways along an edge,
// with a different strength depending on which side you are on.

export const EDGE_TYPES = {
  owner: { label: "Owner / parent", color: "#1e3a8a" },
  investment: { label: "Investment", color: "#22b8cf" },
  venture: { label: "Venture capital", color: "#40c057" },
  hardware: { label: "Hardware / chips", color: "#e64980" },
  cloud: { label: "Cloud / compute", color: "#4c6ef5" },
  software: { label: "Software / customer", color: "#9775fa" },
  supplier: { label: "Supplier / customer", color: "#e8590c" },
  acquisition: { label: "Acquisition", color: "#f59f00" },
  partnership: { label: "Partnership", color: "#868e96" },
  competitor: { label: "Competitor", color: "#adb5bd", dashed: true },
};

// How much the receiving side (target) depends on the paying side (source)
// when no deal size is known, and vice versa.
const RECEIVER_DEPENDENCE = { owner: 0.6, investment: 0.35, venture: 0.35, hardware: 0.2, cloud: 0.3, software: 0.15, supplier: 0.25, acquisition: 0.55, partnership: 0.1, competitor: 0.1 };
const PAYER_DEPENDENCE = { owner: 0.35, investment: 0.25, venture: 0.2, hardware: 0.2, cloud: 0.25, software: 0.3, supplier: 0.3, acquisition: 0.35, partnership: 0.1, competitor: 0.1 };

const DEFAULT_VALUE = 5e9; // used when a company's size is unknown

export function fmtUsd(n) {
  if (n == null || !isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${+(n / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `$${+(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${+(n / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `$${+(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

export function nodeRadius(node) {
  const b = (node.value_usd || 0) / 1e9;
  return node.kind === "investor" && !node.value_usd ? 9 : 9 + 8.5 * Math.log10(b + 1);
}

export function edgeWidth(edge) {
  if (!edge.amount_usd) return 1.4;
  return 1.4 + 2.4 * Math.log10(edge.amount_usd / 1e9 + 1);
}

// Strength (0..1) with which a shock at `from` reaches `to` across `edge`.
export function transmission(edge, from, to, nodesById) {
  const type = edge.type;
  const toVal = nodesById[to]?.value_usd || DEFAULT_VALUE;
  const receiverSide = edge.target === to; // `to` receives money from `from`
  const base = receiverSide ? RECEIVER_DEPENDENCE[type] : PAYER_DEPENDENCE[type];
  if (!edge.amount_usd || type === "competitor") return base ?? 0.1;
  // Deal size relative to the exposed company's size, square-rooted so a deal
  // worth 25% of a company reads as ~0.5 exposure rather than 0.25.
  const w = Math.sqrt(edge.amount_usd / toVal) * 1.1;
  return Math.min(0.95, Math.max(0.05, Math.max(w, base * 0.5)));
}

function adjacency(edges) {
  const adj = {};
  for (const e of edges) {
    (adj[e.source] ||= []).push({ edge: e, other: e.target });
    (adj[e.target] ||= []).push({ edge: e, other: e.source });
  }
  return adj;
}

/**
 * Propagate one or more shocks through the graph.
 * shocks: [{ company: key, severity: 0..1, direction: -1 | 1 }]
 * Returns { impacts: { key: { value, sign, via, edge, hops } }, edgesHit: Set<edgeId> }
 * value is 0..1; sign -1 is harm, +1 is benefit (competitors flip the sign).
 */
export function propagate(nodes, edges, shocks, { maxHops = 3, threshold = 0.03 } = {}) {
  const nodesById = Object.fromEntries(nodes.map((n) => [n.key, n]));
  const adj = adjacency(edges);
  const impacts = {};
  const origins = new Set();
  for (const s of shocks) {
    if (!nodesById[s.company]) continue;
    origins.add(s.company);
    impacts[s.company] = { value: Math.min(1, s.severity), sign: s.direction < 0 ? -1 : 1, via: null, edge: null, hops: 0, origin: true };
  }
  // Breadth-first by hop: a company's impact is fixed the first hop it is reached,
  // combining (noisy-OR) every counterparty that reaches it on that hop, so a company
  // exposed through several counterparties ends up worse off than through one.
  let frontier = [...origins];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const decay = Math.pow(0.85, hop - 1);
    const incoming = {};
    for (const from of frontier) {
      const src = impacts[from];
      for (const { edge, other } of adj[from] || []) {
        if (impacts[other]) {
          if (!impacts[other].origin && impacts[other].hops < hop) impacts[other].paths += 1;
          continue;
        }
        const v = src.value * transmission(edge, from, other, nodesById) * decay;
        if (v < threshold) continue;
        const sign = edge.type === "competitor" ? -src.sign : src.sign;
        (incoming[other] ||= []).push({ v, sign, from, edge });
      }
    }
    frontier = [];
    for (const [key, contribs] of Object.entries(incoming)) {
      const best = contribs.reduce((a, b) => (b.v > a.v ? b : a));
      const value = Math.min(0.95, 1 - contribs.reduce((p, c) => p * (1 - c.v), 1));
      impacts[key] = { value, sign: best.sign, via: best.from, edge: best.edge.key, hops: hop, paths: contribs.length };
      frontier.push(key);
    }
  }
  const edgesHit = new Set(Object.values(impacts).map((i) => i.edge).filter(Boolean));
  return { impacts, edgesHit };
}

// Walk the `via` chain back to the origin: ["openai", "oracle", ...]
export function impactPath(impacts, key) {
  const path = [key];
  let cur = impacts[key];
  const seen = new Set([key]);
  while (cur && cur.via && !seen.has(cur.via)) {
    path.unshift(cur.via);
    seen.add(cur.via);
    cur = impacts[cur.via];
  }
  return path;
}

const MONEY_TYPES = new Set(["owner", "investment", "venture", "hardware", "cloud", "software", "supplier", "acquisition"]);

/**
 * Circular financing: directed money loops (length 2-4) that include at least one
 * investment. Money invested in a customer comes back as that customer's purchases.
 */
export function findCircularFinancing(edges, maxLen = 4) {
  const out = {};
  for (const e of edges) if (MONEY_TYPES.has(e.type)) (out[e.source] ||= []).push(e);
  const cycles = [];
  const seen = new Set();
  const starts = Object.keys(out).sort();
  for (const start of starts) {
    const stack = [[start, [], new Set([start])]];
    while (stack.length) {
      const [node, path, visited] = stack.pop();
      for (const e of out[node] || []) {
        if (e.target === start && path.length + 1 >= 2) {
          const cyc = [...path, e];
          if (!cyc.some((x) => x.type === "investment" || x.type === "venture" || x.type === "owner")) continue;
          const nodes = cyc.map((x) => x.source);
          // Canonical form so each loop is reported once, whatever node it starts at.
          const sig = [...nodes].sort().join(">") + "|" + cyc.map((x) => x.key).sort().join(",");
          if (seen.has(sig)) continue;
          seen.add(sig);
          cycles.push(cyc);
        } else if (!visited.has(e.target) && path.length + 1 < maxLen && e.target > start) {
          // Only extend to nodes "after" the start so each loop is found from its smallest node.
          const v = new Set(visited);
          v.add(e.target);
          stack.push([e.target, [...path, e], v]);
        }
      }
    }
  }
  const total = (c) => c.reduce((s, e) => s + (e.amount_usd || 0), 0);
  return cycles.sort((a, b) => total(b) - total(a) || a.length - b.length);
}

/**
 * Hidden concentration: companies outside the portfolio that several portfolio
 * companies depend on (directly, or one company removed).
 */
export function findSharedDependencies(nodes, edges, holdingKeys, { minHoldings = 2 } = {}) {
  const adj = adjacency(edges.filter((e) => e.type !== "competitor"));
  const holdings = new Set(holdingKeys);
  const exposure = {}; // dep -> Map(holding -> hops)
  for (const h of holdingKeys) {
    const seen = new Map([[h, 0]]);
    let frontier = [h];
    for (let hop = 1; hop <= 2; hop++) {
      const next = [];
      for (const n of frontier) {
        for (const { other } of adj[n] || []) {
          if (seen.has(other)) continue;
          seen.set(other, hop);
          next.push(other);
        }
      }
      frontier = next;
    }
    for (const [dep, hops] of seen) {
      if (dep === h || holdings.has(dep)) continue;
      (exposure[dep] ||= new Map()).set(h, hops);
    }
  }
  const nodesById = Object.fromEntries(nodes.map((n) => [n.key, n]));
  return Object.entries(exposure)
    .filter(([dep, m]) => m.size >= minHoldings && nodesById[dep]?.kind !== "investor" && [...m.values()].includes(1))
    .map(([dep, m]) => ({
      company: dep,
      holdings: [...m.entries()].map(([h, hops]) => ({ company: h, hops })),
      direct: [...m.values()].filter((x) => x === 1).length,
    }))
    .sort((a, b) => b.direct - a.direct || b.holdings.length - a.holdings.length)
    .slice(0, 4);
}
