import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, Zap, Network, X } from "lucide-react";
import GraphView from "@/components/GraphView";
import { SegmentedControl } from "@/components/ui/segmented-control";
import Details from "@/components/panels/Details";
import WhatIf from "@/components/panels/WhatIf";
import Risks from "@/components/panels/Risks";
import Portfolio from "@/components/panels/Portfolio";
import { api, OFFLINE, companyKey } from "@/api/backend";
import { canonicalGraph } from "../base44/shared/seed.js";
import { EDGE_TYPES, propagate, impactPath, findCircularFinancing, findSharedDependencies } from "@/lib/graph";

const EXAMPLES = [
  "OpenAI fails to raise its next round and halves its compute commitments",
  "Microsoft stops renting GPU capacity from neoclouds",
  "Nvidia's next-gen chips slip by two quarters",
  "Oracle can't finance its Stargate data centers",
];

const KEY_LINKS = 14; // counterparties drawn around the focus company before "All links"
const MORE_PREFIX = "__more:";
const IMPACT_NODES = 24; // most-affected companies drawn in a scenario before "All links"

export default function App() {
  const [data, setData] = useState({ companies: [], relationships: [], holdings: [] });
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState("openai");
  const [selected, setSelected] = useState({ kind: "node", key: "openai" });
  const [showAll, setShowAll] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [allLinks, setAllLinks] = useState(false);
  const [tab, setTab] = useState("details");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState(null); // {name, step, error, result}
  const [scenario, setScenario] = useState(null);
  const [eventText, setEventText] = useState(EXAMPLES[0]);
  const [highlight, setHighlight] = useState(null); // {edges:Set, nodes:Set, title}
  // Companies looked up in this browser: their links stay on the faded background map.
  const [mine, setMine] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("ripple.searched") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [cleared, setCleared] = useState(() => {
    try {
      return localStorage.getItem("ripple.cleared") === "1";
    } catch {
      return false;
    }
  });
  const clearSearches = () => {
    setMine(new Set());
    setCleared(true);
    setLookup(null);
    try {
      localStorage.setItem("ripple.searched", "[]");
      localStorage.setItem("ripple.cleared", "1");
    } catch {}
  };
  const remember = (key) =>
    setMine((m) => {
      if (m.has(key)) return m;
      const next = new Set([...m, key]);
      try {
        localStorage.setItem("ripple.searched", JSON.stringify([...next]));
      } catch {}
      return next;
    });

  // Reloads can overlap (a lookup and the background value search both reload): only the
  // most recently started one may replace the data, so an older, slower read never wipes
  // out a company that was just mapped.
  const reloadSeq = useRef(0);
  const lastLookup = useRef(null);
  const reload = useCallback(async (fresh) => {
    const seq = ++reloadSeq.current;
    if (fresh?.relationships) lastLookup.current = fresh;
    const extra = lastLookup.current;
    let d = await api.loadAll();
    if (!OFFLINE && d.companies.length === 0) {
      await api.seed();
      d = await api.loadAll();
    }
    // Records a lookup just saved, in case this read doesn't include them yet.
    if (extra?.companies?.length || extra?.relationships?.length) {
      const haveC = new Set(d.companies.map((c) => c.key));
      const haveR = new Set(d.relationships.map((r) => r.key));
      d = canonicalGraph({
        companies: [...d.companies, ...(extra.companies || []).filter((c) => !haveC.has(c.key))],
        relationships: [...d.relationships, ...(extra.relationships || []).filter((r) => !haveR.has(r.key))],
        holdings: d.holdings,
      });
    }
    if (seq === reloadSeq.current) {
      setData(d);
      setLoading(false);
    }
    return d;
  }, []);

  useEffect(() => {
    reload().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [reload]);

  const companies = data.companies;
  const byKey = useMemo(() => Object.fromEntries(companies.map((c) => [c.key, c])), [companies]);
  const edges = useMemo(() => data.relationships.filter((r) => byKey[r.source] && byKey[r.target]), [data.relationships, byKey]);
  const edgeByKey = useMemo(() => Object.fromEntries(edges.map((e) => [e.key, e])), [edges]);
  const holdings = data.holdings;
  const holdingKeys = useMemo(() => holdings.map((h) => h.company), [holdings]);

  // What is drawn: the focus company's 2-hop neighbourhood (plus anything a scenario
  // touched), or the whole map when "Show whole map" is on.
  // Links found only by the cache pre-fill are left off the map unless they touch the company
  // in focus or one searched in this browser, so the pre-fill doesn't clutter the background.
  // After "Clear searches" only the seed links and later searches stay in the background.
  const shown = (e) => mine.has(e.source) || mine.has(e.target) || (cleared ? e.origin === "seed" : !e.prefilled);
  const visible = useMemo(() => {
    if (showAll || !focus || !byKey[focus]) {
      const bgEdges = edges.filter(shown);
      const used = new Set(bgEdges.flatMap((e) => [e.source, e.target]));
      return { nodes: companies.filter((c) => used.has(c.key) || c.origin === "seed" || mine.has(c.key)), edges: bgEdges };
    }
    const keep = new Set([focus, ...Object.keys(scenario?.impacts || {}), ...Object.keys(highlight?.impacts || {})]);
    if (!allLinks && (scenario?.impacts || highlight)) return impactView();
    if (!allLinks) return keyLinks(keep);
    let frontier = [focus];
    for (let hop = 0; hop < 2; hop++) {
      const next = [];
      for (const e of edges) {
        if (e.type === "competitor" && hop > 0) continue;
        if (hop > 0 && !shown(e)) continue;
        for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
          if (frontier.includes(a) && !keep.has(b)) {
            keep.add(b);
            next.push(b);
          }
        }
      }
      frontier = next;
    }
    return {
      nodes: companies.filter((c) => keep.has(c.key)),
      edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target) && (e.source === focus || e.target === focus || shown(e))),
    };
  }, [showAll, allLinks, companies, edges, focus, byKey, scenario, highlight, mine, cleared, holdingKeys]);
  useEffect(() => setAllLinks(false), [focus, scenario?.impacts, highlight]);

  // Scenario / highlight view: only the companies the shock reaches (the most affected,
  // plus the chain that connects each back to the origin) and the lines it travels along.
  function impactView() {
    const imp = highlight ? highlight.impacts : scenario.impacts;
    const hit = (highlight ? highlight.edges : scenario.edgesHit) || new Set();
    const weight = ([, v]) => (v.origin ? 2 : 0) + v.value;
    const ranked = Object.entries(imp).filter(([k]) => byKey[k]).sort((a, b) => weight(b) - weight(a));
    const keep = new Set();
    for (const [k] of ranked.slice(0, IMPACT_NODES)) {
      for (let cur = k; cur && !keep.has(cur); cur = imp[cur]?.via) keep.add(cur);
    }
    const nodes = companies.filter((c) => keep.has(c.key));
    // Every relationship between the companies shown, one line per pair, preferring the line
    // the shock travelled along, so directly-hit companies stay connected to each other.
    const pairs = {};
    const rank = (e) => (hit.has(e.key) ? 2e15 : 0) + (e.type === "competitor" ? 0 : 1e15) + (e.amount_usd || 0);
    for (const e of edges) {
      if (!keep.has(e.source) || !keep.has(e.target)) continue;
      const pk = [e.source, e.target].sort().join("|");
      if (!pairs[pk] || rank(e) > rank(pairs[pk])) pairs[pk] = e;
    }
    const out = Object.values(pairs);
    const rest = ranked.length - keep.size;
    const origin = ranked.find(([, v]) => v.origin)?.[0];
    if (rest > 0 && origin) {
      const key = `${MORE_PREFIX}affected`;
      nodes.push({ key, name: `+${rest} more affected`, group: true, r_fixed: 17 });
      out.push({ key, source: origin, target: key, type: "partnership" });
    }
    return { nodes, edges: out };
  }

  // Default focus view: only the focus company's most important counterparties (biggest
  // deals, then biggest companies), with the rest folded into "+N investors" / "+N more"
  // circles that expand to every link when clicked.
  function keyLinks(keep) {
    const holdingSet = new Set(holdingKeys);
    const direct = {};
    for (const e of edges) {
      if (e.source !== focus && e.target !== focus) continue;
      const o = e.source === focus ? e.target : e.source;
      (direct[o] ||= []).push(e);
    }
    const score = (o) => {
      const es = direct[o];
      const c = byKey[o];
      const amount = Math.max(0, ...es.map((e) => e.amount_usd || 0));
      const pinned = holdingSet.has(o) || es.some((e) => e.type === "owner") || mine.has(o);
      return (pinned ? 1e16 : 0) + amount + 0.05 * (c?.value_usd || 0);
    };
    const ranked = Object.keys(direct).sort((a, b) => score(b) - score(a));
    const isMinorInvestor = (o) => byKey[o]?.kind === "investor" && !direct[o].some((e) => e.amount_usd) && score(o) < 1e16;
    const top = ranked.filter((o) => !isMinorInvestor(o)).slice(0, KEY_LINKS);
    for (const o of top) keep.add(o);
    const nodes = companies.filter((c) => keep.has(c.key));
    // One line per pair of companies (the biggest deal); every deal is still listed in the side panel.
    const pairs = {};
    for (const e of edges) {
      if (!keep.has(e.source) || !keep.has(e.target)) continue;
      if (e.source !== focus && e.target !== focus && !(shown(e) && e.type !== "competitor" && e.amount_usd >= 1e9)) continue;
      const pk = [e.source, e.target].sort().join("|");
      if (!pairs[pk] || (e.amount_usd || 0) > (pairs[pk].amount_usd || 0)) pairs[pk] = e;
    }
    const out = Object.values(pairs);
    const rest = ranked.filter((o) => !keep.has(o));
    const investors = rest.filter(isMinorInvestor);
    const others = rest.filter((o) => !isMinorInvestor(o));
    for (const [id, list, label, type] of [["investors", investors, "investors", "venture"], ["more", others, "more", "partnership"]]) {
      if (!list.length) continue;
      const key = `${MORE_PREFIX}${id}`;
      nodes.push({ key, name: `+${list.length} ${label}`, group: true, r_fixed: 17 });
      out.push({ key, source: type === "venture" ? key : focus, target: type === "venture" ? focus : key, type });
    }
    return { nodes, edges: out };
  }

  const runLookup = async (name, opts) => {
    if (!name.trim()) return;
    setLookup({ name, step: "Starting" });
    setScenario(null);
    setHighlight(null);
    try {
      const res = await api.lookup(name.trim(), (step) => setLookup((l) => ({ ...l, step })), opts);
      const d = await reload(res);
      const key = res?.key || companyKey(name);
      const n = d.relationships.filter((r) => r.source === key || r.target === key).length;
      setLookup({ name, done: true, result: res, count: n });
      remember(key);
      setFocus(key);
      setSelected({ kind: "node", key });
      setTab("details");
      // Search market values the lookup couldn't source, without holding up the map.
      const near = new Set([key, ...d.relationships.filter((r) => r.source === key || r.target === key).flatMap((r) => [r.source, r.target])]);
      const stale = (c) => !c.value_source_url || !c.value_fetched || Date.now() - Date.parse(c.value_fetched) > 7 * 864e5;
      const todo = d.companies.filter((c) => near.has(c.key) && c.kind !== "investor" && c.origin !== "seed" && stale(c)).map((c) => c.key);
      if (todo.length) api.fillValues(todo, reload).catch((err) => console.warn("value search failed", err));
    } catch (e) {
      setLookup({ name, error: String(e.message || e) });
    }
  };

  // ---------- What-if ----------
  const runScenario = async (text) => {
    const ev = (text ?? eventText).trim();
    if (!ev) return;
    setHighlight(null);
    setScenario({ event: ev, running: true });
    const parsed = await api.parseEvent(ev, companies);
    if (!parsed.shocks?.length) {
      setScenario({ event: ev, error: "Couldn't match this event to a company on the graph. Name a company that's on the map." });
      return;
    }
    applyShocks(ev, parsed.headline, parsed.shocks, true);
  };

  const applyShocks = async (event, headline, shocks, withMemo) => {
    const { impacts, edgesHit } = propagate(companies, edges, shocks);
    const portfolio = holdings
      .map((h) => ({ ...h, impact: impacts[h.company] }))
      .filter((h) => h.impact)
      .sort((a, b) => b.impact.value * (b.stake_usd || 1) - a.impact.value * (a.stake_usd || 1));
    const next = { event, headline, shocks, impacts, edgesHit, portfolio, memo: null, memoLoading: withMemo };
    setScenario((s) => ({ ...next, memo: withMemo ? null : s?.memo }));
    setTab("whatif");
    if (withMemo) {
      const payload = portfolio.map((h) => ({
        company: byKey[h.company]?.name,
        impact: +h.impact.value.toFixed(2),
        direction: h.impact.sign < 0 ? "harm" : "benefit",
        stake_usd: h.stake_usd,
        path: impactPath(impacts, h.company).map((k) => byKey[k]?.name),
        edges: pathEdges(impacts, h.company).map((e) => e.label),
      }));
      const memo = payload.length ? await api.explain(event, payload) : null;
      setScenario((s) => (s && s.event === event ? { ...s, memo, memoLoading: false } : s));
    }
  };

  const pathEdges = (impacts, key) => {
    const out = [];
    let cur = key;
    const seen = new Set();
    while (impacts[cur]?.edge && !seen.has(cur)) {
      seen.add(cur);
      const e = edgeByKey[impacts[cur].edge];
      if (e) out.unshift(e);
      cur = impacts[cur].via;
    }
    return out;
  };

  const cycles = useMemo(() => findCircularFinancing(edges).slice(0, 6), [edges]);
  const shared = useMemo(() => findSharedDependencies(companies, edges, holdingKeys), [companies, edges, holdingKeys]);

  const graphImpacts = highlight ? highlight.impacts : scenario?.impacts;
  const graphEdgesHit = highlight ? highlight.edges : scenario?.edgesHit;

  const selNode = selected?.kind === "node" ? byKey[selected.key] : null;
  const selEdge = selected?.kind === "edge" ? edgeByKey[selected.key] : null;

  const totalStake = holdings.reduce((s, h) => s + (h.stake_usd || 0), 0);
  const tabs = [
    { value: "details", label: "Details" },
    { value: "whatif", label: "What if" },
    { value: "risks", label: "Risks", badge: cycles.length + shared.length },
    { value: "portfolio", label: "Portfolio" },
  ];

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-indigo-600 grid place-items-center text-white font-black">R</div>
          <div>
            <div className="font-bold leading-tight">Ripple</div>
            <div className="text-[11px] text-slate-500 leading-tight">Who's connected to whom, and what breaks if one of them does</div>
          </div>
        </div>
        <form
          className="flex-1 max-w-xl flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runLookup(query);
          }}
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              list="company-names"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type any company, e.g. Base44, Ramp, Stripe…"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="company-names">
              {companies.map((c) => (
                <option key={c.key} value={c.name} />
              ))}
            </datalist>
          </div>
          <button disabled={!!lookup && !lookup.done && !lookup.error} className="h-10 px-4 rounded-lg bg-slate-900 text-white font-medium disabled:opacity-50 flex items-center gap-2">
            {lookup && !lookup.done && !lookup.error ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
            Map it
          </button>
        </form>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          {OFFLINE && <span className="px-2 py-1 rounded bg-amber-100 text-amber-800 font-medium">Offline demo data</span>}
          <span>
            {companies.length} companies · {edges.length} relationships
          </span>
        </div>
      </header>

      {lookup && (
        <div className={`px-5 py-2 text-sm border-b flex items-center gap-2 ${lookup.error ? "bg-rose-50 border-rose-200 text-rose-800" : lookup.done ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-indigo-50 border-indigo-200 text-indigo-800"}`}>
          {!lookup.done && !lookup.error && <Loader2 className="w-4 h-4 animate-spin" />}
          {lookup.error ? (
            <span>Couldn't map {lookup.name}: {lookup.error}</span>
          ) : lookup.done ? (
            <span>
              Mapped <b>{byKey[lookup.result?.key]?.name || lookup.name}</b>: {lookup.count} relationships
              {!lookup.result?.cached && lookup.result?.added != null ? `, ${lookup.result.added} new from the web` : ""}
              {!lookup.result?.cached && lookup.result?.ms ? ` in ${(lookup.result.ms / 1000).toFixed(0)}s` : ""}.
            </span>
          ) : (
            <span>
              Mapping <b>{lookup.name}</b>: {lookup.step}…
            </span>
          )}
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setLookup(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Graph */}
        <div className="flex-1 relative min-w-0 bg-[radial-gradient(circle_at_center,#ffffff,#f1f3f5)]">
          {loading ? (
            <div className="absolute inset-0 grid place-items-center text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <GraphView
              nodes={visible.nodes}
              edges={visible.edges}
              holdings={holdings}
              focus={scenario?.impacts || highlight ? null : focus}
              selected={selected}
              onSelect={(s) => {
                if (s?.key?.startsWith(MORE_PREFIX)) return setAllLinks(true);
                setSelected(s);
                if (s) setTab("details");
              }}
              impacts={graphImpacts}
              edgesHit={graphEdgesHit}
              showLabels={showLabels}
            />
          )}
          {(scenario?.impacts || highlight) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/95 border border-rose-200 shadow-sm rounded-full pl-4 pr-2 py-1.5 text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-rose-600" />
              <span className="font-medium max-w-[460px] truncate">{highlight ? highlight.title : scenario.headline || scenario.event}</span>
              <button
                className="rounded-full hover:bg-slate-100 p-1"
                onClick={() => {
                  setScenario(null);
                  setHighlight(null);
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <Legend />
          <div className="absolute top-3 left-3 flex flex-col gap-1.5 text-xs">
            <label className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-1 border border-slate-200">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show whole map
            </label>
            {!showAll && (
              <label className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-1 border border-slate-200">
                <input type="checkbox" checked={allLinks} onChange={(e) => setAllLinks(e.target.checked)} /> All links
              </label>
            )}
            <label className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-1 border border-slate-200">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Deal callouts
            </label>
            <button className="text-left bg-white/90 rounded px-2 py-1 border border-slate-200 hover:bg-slate-50" onClick={clearSearches} title="Remove earlier searches from the faded background">
              Clear searches
            </button>
          </div>
        </div>

        {/* Side panel */}
        <aside className="w-[380px] shrink-0 bg-canvas border-l border-slate-200 flex flex-col min-h-0">
          <div className="shrink-0 p-2">
            <SegmentedControl ariaLabel="Panels" options={tabs} value={tab} onChange={setTab} />
          </div>
          <div className="scroll-area flex-1 min-h-0 px-4 pb-4 pt-2">
            {tab === "details" && (
              <Details
                node={selNode}
                edge={selEdge}
                byKey={byKey}
                edges={edges}
                holdings={holdings}
                onSelect={setSelected}
                onFocus={(k) => {
                  setFocus(k);
                  setSelected({ kind: "node", key: k });
                }}
                onLookup={(name, opts) => runLookup(name, opts)}
                onAddHolding={async (c) => {
                  await api.addHolding(c.key, c.name, 2.5e7);
                  reload();
                }}
                lookupBusy={!!lookup && !lookup.done && !lookup.error}
              />
            )}
            {tab === "whatif" && (
              <WhatIf
                eventText={eventText}
                setEventText={setEventText}
                scenario={scenario}
                examples={EXAMPLES}
                byKey={byKey}
                holdingsCount={holdings.length}
                onRun={(text) => {
                  setEventText(text);
                  runScenario(text);
                }}
                applyShocks={applyShocks}
                pathEdges={pathEdges}
                onSelect={(k) => setSelected({ kind: "node", key: k })}
              />
            )}
            {tab === "risks" && (
              <Risks
                cycles={cycles}
                shared={shared}
                byKey={byKey}
                holdings={holdings}
                activeId={highlight?.id}
                onShowCycle={(c, i) => {
                  setScenario(null);
                  const nodes = Object.fromEntries(c.map((e) => [e.source, { value: 0.55, sign: -1, mark: true }]));
                  setHighlight({ id: `cycle-${i}`, title: `Circular financing loop #${i + 1}`, edges: new Set(c.map((e) => e.key)), impacts: nodes });
                }}
                onSelectEdge={(key) => {
                  setSelected({ kind: "edge", key });
                  setTab("details");
                }}
                onShowShared={(s, id) => {
                  setScenario(null);
                  const imp = { [s.company]: { value: 0.8, sign: -1, origin: true, mark: true } };
                  const hit = new Set();
                  for (const h of s.holdings) if (h.hops === 1) imp[h.company] = { value: 0.45, sign: -1, mark: true };
                  for (const e of edges) {
                    if ((e.source === s.company && imp[e.target]) || (e.target === s.company && imp[e.source])) hit.add(e.key);
                  }
                  setHighlight({ id, title: `${s.holdings.length} of your holdings depend on ${byKey[s.company]?.name}`, edges: hit, impacts: imp });
                }}
                onClear={() => setHighlight(null)}
              />
            )}
            {tab === "portfolio" && (
              <Portfolio
                holdings={holdings}
                byKey={byKey}
                companies={companies}
                total={totalStake}
                onChange={async (fn) => {
                  await fn();
                  reload();
                }}
                onSelect={(k) => {
                  setFocus(k);
                  setSelected({ kind: "node", key: k });
                  setTab("details");
                }}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-3 left-3 bg-white/95 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 shadow-sm max-w-[520px]">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {Object.entries(EDGE_TYPES).map(([k, t]) => (
          <span key={k} className="flex items-center gap-1">
            <svg width="18" height="6">
              <line x1="0" y1="3" x2="18" y2="3" stroke={t.color} strokeWidth="2.5" strokeDasharray={t.dashed ? "4 3" : undefined} />
            </svg>
            {t.label}
          </span>
        ))}
      </div>
      <div className="mt-1 text-slate-500">
        Circle size = market value · Line thickness = deal size · Arrows follow the money · <span className="text-amber-600">★ your portfolio</span>
      </div>
    </div>
  );
}
