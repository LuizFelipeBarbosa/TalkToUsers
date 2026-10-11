// Graph model, risk propagation and hidden-risk detection. Pure functions, no UI.
//
// Edge direction follows the money: investor -> investee, buyer -> seller,
// acquirer -> acquired, owner -> subsidiary. A shock to one company travels both ways along an edge,
// with a different strength depending on which side you are on.

// Apple system hues that read on both light and dark canvases. Pure red is left out:
// it is reserved for the risk state of a what-if.
export const EDGE_TYPES = {
  owner: { label: "Owner / parent", color: "#5e5ce6" },
  investment: { label: "Investment", color: "#32ade6" },
  venture: { label: "Venture capital", color: "#34c759" },
  hardware: { label: "Hardware / chips", color: "#f0508c" },
  cloud: { label: "Cloud / compute", color: "#007aff" },
  software: { label: "Software / customer", color: "#af52de" },
  supply: { label: "Supply / services", color: "#a2845e" },
  acquisition: { label: "Acquisition", color: "#ff9500" },
  partnership: { label: "Partnership", color: "#8e8e93" },
  competitor: { label: "Competitor", color: "#aeaeb2", dashed: true },
};

// How much the receiving side (target) depends on the paying side (source)
// when no deal size is known, and vice versa.
const RECEIVER_DEPENDENCE = { owner: 0.6, investment: 0.35, venture: 0.35, hardware: 0.2, cloud: 0.3, software: 0.15, supply: 0.2, acquisition: 0.55, partnership: 0.1, competitor: 0.1 };
const PAYER_DEPENDENCE = { owner: 0.35, investment: 0.25, venture: 0.2, hardware: 0.2, cloud: 0.25, software: 0.3, supply: 0.3, acquisition: 0.35, partnership: 0.1, competitor: 0.1 };

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

const MONEY_TYPES = new Set(["owner", "investment", "venture", "hardware", "cloud", "software", "supply", "acquisition"]);

/**
 * Circular financing: directed money loops (length 2-5) that include at least one
 * investment. Money invested in a customer comes back as that customer's purchases.
 * Parallel deals between the same two companies don't repeat a loop; each loop of companies is reported once, through its largest disclosed deals.
 */
export function findCircularFinancing(edges, maxLen = 5) {
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
  const sorted = cycles.sort((a, b) => total(b) - total(a) || a.length - b.length);
  const loopKeys = new Set();
  return sorted.filter((cyc) => {
    const key = cyc.map((e) => e.source).join(">");
    if (loopKeys.has(key)) return false;
    loopKeys.add(key);
    return true;
  });
}

// The most money that can go all the way round a loop: it is only as big as its smallest
// deal, so a loop with an undisclosed deal counts as 0. (Adding up the deals instead would
// rank long chains first just for having more of them.)
export const loopFlow = (loop) => Math.min(...loop.map((e) => e.amount_usd || 0));

// Which capital edge a loop is listed under: an investment over ownership, then the larger deal.
const ANCHOR_RANK = { investment: 2, venture: 2, owner: 1 };

/**
 * Groups money loops by the investment that starts them, so one deal whose money comes back
 * several ways is listed once. Each route is its loop rotated to start with that investment
 * (investor → investee → … → investor). Routes run shortest first, then by flow; groups by
 * their biggest flow, then by the size of the investment.
 * Returns [{ id, investment, routes }].
 */
export function groupLoops(loops) {
  const groups = new Map();
  for (const loop of loops) {
    const investment = loop
      .filter((e) => ANCHOR_RANK[e.type])
      .reduce((a, b) => (ANCHOR_RANK[b.type] - ANCHOR_RANK[a.type] || (b.amount_usd || 0) - (a.amount_usd || 0)) > 0 ? b : a);
    const i = loop.indexOf(investment);
    const route = [...loop.slice(i), ...loop.slice(0, i)];
    if (!groups.has(investment.key)) groups.set(investment.key, { id: investment.key, investment, routes: [] });
    groups.get(investment.key).routes.push(route);
  }
  const flow = (g) => Math.max(...g.routes.map(loopFlow));
  return [...groups.values()]
    .map((g) => ({ ...g, routes: g.routes.sort((a, b) => a.length - b.length || loopFlow(b) - loopFlow(a)) }))
    .sort((a, b) => flow(b) - flow(a) || (b.investment.amount_usd || 0) - (a.investment.amount_usd || 0) || b.routes.length - a.routes.length);
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

/**
 * Collapse the map to each company's biggest connections. Around a focus company, the focus keeps
 * its `keepDirect` biggest direct links and each of those keeps its `keepPerHub` biggest links
 * further out. On the whole map (no focus), a company keeps `keepPerHub` of the companies that link
 * only to it. The rest fold into the company's "+N" count; `extra` ({ key: n }) shows n more of them.
 * Pinned companies always show, and one two hops out brings along the link to the focus it goes through.
 * Returns { nodes, edges, more: { key: { count, extra } } }, where count is how many are still folded.
 */
export function collapseMap(nodes, edges, { focus, pinned, extra = {}, keepDirect = 8, keepPerHub = 3 }) {
  const byKey = new Map(nodes.map((node, index) => [node.key, { node, index }]));
  const deals = new Map(); // key -> Map(other key -> total deal size between them)
  const addDeal = (a, b, amount) => {
    if (!deals.has(a)) deals.set(a, new Map());
    deals.get(a).set(b, (deals.get(a).get(b) || 0) + amount);
  };
  for (const edge of edges) {
    if (edge.source === edge.target || !byKey.has(edge.source) || !byKey.has(edge.target)) continue;
    addDeal(edge.source, edge.target, edge.amount_usd || 0);
    addDeal(edge.target, edge.source, edge.amount_usd || 0);
  }
  const neighboursOf = (key) => [...(deals.get(key)?.keys() || [])];
  // Biggest deal with the hub first, then the most valuable company, then the original order.
  const ranked = (hub, keys) => keys.sort((a, b) => (
    deals.get(hub).get(b) - deals.get(hub).get(a)
    || (byKey.get(b).node.value_usd || 0) - (byKey.get(a).node.value_usd || 0)
    || byKey.get(a).index - byKey.get(b).index
  ));

  // [hub, the connections it can fold], in the order they are opened: the focus before its links.
  const groups = [];
  let direct = new Set();
  if (focus) {
    const directKeys = ranked(focus, neighboursOf(focus));
    direct = new Set(directKeys);
    groups.push([focus, directKeys]);
    for (const hub of directKeys) {
      groups.push([hub, ranked(hub, neighboursOf(hub).filter((key) => key !== focus && !direct.has(key)))]);
    }
  } else {
    const leavesByHub = new Map();
    for (const node of nodes) {
      const neighbours = neighboursOf(node.key);
      if (neighbours.length !== 1) continue;
      const [hub] = neighbours;
      if (!pinned.has(hub) && deals.get(hub).size === 1) continue; // a pair that only links to each other
      if (!leavesByHub.has(hub)) leavesByHub.set(hub, []);
      leavesByHub.get(hub).push(node.key);
    }
    for (const [hub, leaves] of leavesByHub) groups.push([hub, ranked(hub, leaves)]);
  }

  const foldable = new Set(groups.flatMap(([, children]) => children));
  const visible = new Set(nodes.filter((node) => !foldable.has(node.key) || pinned.has(node.key)).map((node) => node.key));
  for (const key of pinned) {
    if (!foldable.has(key) || direct.has(key)) continue;
    const via = neighboursOf(key).filter((other) => direct.has(other));
    if (via.length) visible.add(via.reduce((a, b) => (deals.get(key).get(b) > deals.get(key).get(a) ? b : a)));
  }
  // A hub always shows the same top of its list, so pinning a company (selecting it, say) never
  // brings in another one.
  for (const [hub, children] of groups) {
    if (!visible.has(hub)) continue;
    const keep = (hub === focus ? keepDirect : keepPerHub) + (extra[hub] || 0);
    for (const key of children.slice(0, keep)) visible.add(key);
  }

  const more = {};
  for (const [hub, children] of groups) {
    if (!visible.has(hub)) continue;
    const count = children.filter((child) => !visible.has(child)).length;
    if (count > 0 || extra[hub]) more[hub] = { count, extra: extra[hub] || 0 };
  }
  return {
    nodes: nodes.filter((node) => visible.has(node.key)),
    edges: edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    more,
  };
}
