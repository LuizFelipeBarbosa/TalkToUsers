import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Loader2, Zap, Briefcase, Network, AlertTriangle, ExternalLink, RefreshCw, X, Plus, Star, Tag } from "lucide-react";
import GraphView from "@/components/GraphView";
import { api, OFFLINE, companyKey } from "@/api/backend";
import { EDGE_TYPES, fmtUsd, propagate, impactPath, findCircularFinancing, findSharedDependencies } from "@/lib/graph";

const EXAMPLES = [
  "OpenAI fails to raise its next round and halves its compute commitments",
  "Microsoft stops renting GPU capacity from neoclouds",
  "Nvidia's next-gen chips slip by two quarters",
  "Oracle can't finance its Stargate data centers",
];

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export default function App() {
  const [data, setData] = useState({ companies: [], relationships: [], holdings: [] });
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState("openai");
  const [selected, setSelected] = useState({ kind: "node", key: "openai" });
  const [showAll, setShowAll] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [tab, setTab] = useState("details");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState(null); // {name, step, error, result}
  const [scenario, setScenario] = useState(null);
  const [eventText, setEventText] = useState(EXAMPLES[0]);
  const [highlight, setHighlight] = useState(null); // {edges:Set, nodes:Set, title}

  const reload = useCallback(async () => {
    let d = await api.loadAll();
    if (!OFFLINE && d.companies.length === 0) {
      await api.seed();
      d = await api.loadAll();
    }
    setData(d);
    setLoading(false);
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
  const visible = useMemo(() => {
    if (showAll || !focus || !byKey[focus]) return { nodes: companies, edges };
    const keep = new Set([focus, ...Object.keys(scenario?.impacts || {}), ...Object.keys(highlight?.impacts || {})]);
    let frontier = [focus];
    for (let hop = 0; hop < 2; hop++) {
      const next = [];
      for (const e of edges) {
        if (e.type === "competitor" && hop > 0) continue;
        for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
          if (frontier.includes(a) && !keep.has(b)) {
            keep.add(b);
            next.push(b);
          }
        }
      }
      frontier = next;
    }
    return { nodes: companies.filter((c) => keep.has(c.key)), edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [showAll, companies, edges, focus, byKey, scenario, highlight]);

  const runLookup = async (name, opts) => {
    if (!name.trim()) return;
    setLookup({ name, step: "Starting" });
    setScenario(null);
    setHighlight(null);
    try {
      const res = await api.lookup(name.trim(), (step) => setLookup((l) => ({ ...l, step })), opts);
      const d = await reload();
      const key = res?.key || companyKey(name);
      const n = d.relationships.filter((r) => r.source === key || r.target === key).length;
      setLookup({ name, done: true, result: res, count: n });
      setFocus(key);
      setSelected({ kind: "node", key });
      setTab("details");
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
              {lookup.result?.cached ? " (from earlier lookup)" : lookup.result?.added != null ? `, ${lookup.result.added} new from the web` : ""}
              {lookup.result?.ms ? ` in ${(lookup.result.ms / 1000).toFixed(0)}s` : ""}.
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
            <label className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-1 border border-slate-200">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Deal callouts
            </label>
          </div>
        </div>

        {/* Side panel */}
        <aside className="w-[400px] shrink-0 bg-white border-l border-slate-200 flex flex-col min-h-0">
          <nav className="grid grid-cols-4 border-b border-slate-200 text-xs font-medium">
            {[
              ["details", "Details", Network],
              ["whatif", "What if", Zap],
              ["risks", "Hidden risks", AlertTriangle],
              ["portfolio", "Portfolio", Briefcase],
            ].map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)} className={`py-2.5 flex flex-col items-center gap-0.5 border-b-2 ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                <Icon className="w-4 h-4" />
                {label}
                {id === "risks" && cycles.length + shared.length > 0 && <span className="sr-only">({cycles.length + shared.length})</span>}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto p-4 text-sm">
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
                byKey={byKey}
                companies={companies}
                runScenario={runScenario}
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
                onShowCycle={(c, i) => {
                  setScenario(null);
                  const nodes = Object.fromEntries(c.map((e) => [e.source, { value: 0.55, sign: -1, mark: true }]));
                  setHighlight({ title: `Circular financing loop #${i + 1}`, edges: new Set(c.map((e) => e.key)), impacts: nodes });
                }}
                onShowShared={(s) => {
                  setScenario(null);
                  const imp = { [s.company]: { value: 0.8, sign: -1, origin: true, mark: true } };
                  const hit = new Set();
                  for (const h of s.holdings) if (h.hops === 1) imp[h.company] = { value: 0.45, sign: -1, mark: true };
                  for (const e of edges) {
                    if ((e.source === s.company && imp[e.target]) || (e.target === s.company && imp[e.source])) hit.add(e.key);
                  }
                  setHighlight({ title: `${s.holdings.length} of your holdings depend on ${byKey[s.company]?.name}`, edges: hit, impacts: imp });
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

function TypeDot({ type }) {
  const t = EDGE_TYPES[type] || EDGE_TYPES.partnership;
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ background: t.color }} title={t.label} />;
}

function SourceLink({ url }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline text-xs" onClick={(e) => e.stopPropagation()}>
      {host(url)} <ExternalLink className="w-3 h-3" />
    </a>
  );
}

function Details({ node, edge, byKey, edges, holdings, onSelect, onFocus, onLookup, onAddHolding, lookupBusy }) {
  if (edge) {
    const t = EDGE_TYPES[edge.type];
    return (
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: t?.color }}>
          {t?.label}
        </div>
        <div className="text-base font-semibold">{edge.label}</div>
        <div className="flex items-center gap-2 text-slate-700">
          <button className="font-medium hover:underline" onClick={() => onFocus(edge.source)}>{byKey[edge.source]?.name}</button>
          <span className="text-slate-400">pays →</span>
          <button className="font-medium hover:underline" onClick={() => onFocus(edge.target)}>{byKey[edge.target]?.name}</button>
        </div>
        <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-slate-600">
          {edge.amount_usd && (<><dt>Deal size</dt><dd className="font-medium text-slate-900">{fmtUsd(edge.amount_usd)}</dd></>)}
          {edge.date && (<><dt>Date</dt><dd>{edge.date}</dd></>)}
          <dt>Confidence</dt>
          <dd>{Math.round((edge.confidence ?? 0.7) * 100)}% <span className="text-slate-400">({edge.origin === "seed" ? "curated" : edge.origin === "live" ? "extracted from the article" : "AI web search"})</span></dd>
          <dt>Source</dt>
          <dd><SourceLink url={edge.source_url} /></dd>
        </dl>
        {edge.evidence && <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-600 italic">"{edge.evidence}"</blockquote>}
      </div>
    );
  }
  if (!node) return <p className="text-slate-500">Click a company or a line on the map.</p>;
  const out = edges.filter((e) => e.source === node.key);
  const inc = edges.filter((e) => e.target === node.key);
  const isHolding = holdings.some((h) => h.company === node.key);
  const rows = (list, dir) =>
    list
      .sort((a, b) => (b.amount_usd || 0) - (a.amount_usd || 0))
      .map((e) => {
        const other = byKey[dir === "out" ? e.target : e.source];
        return (
          <li key={e.key} className="flex gap-2 py-1.5 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 -mx-1 px-1 rounded" onClick={() => onSelect({ kind: "edge", key: e.key })}>
            <TypeDot type={e.type} />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2">
                <span className="font-medium truncate">{other?.name}</span>
                {e.amount_usd && <span className="font-semibold text-slate-900 shrink-0">{fmtUsd(e.amount_usd)}</span>}
              </div>
              <div className="text-slate-500 text-xs leading-snug">{e.label}</div>
              <div className="flex gap-2 items-center mt-0.5">
                <SourceLink url={e.source_url} />
                {e.date && <span className="text-[11px] text-slate-400">{e.date}</span>}
                {e.origin !== "seed" && <span className="text-[10px] px-1 rounded bg-indigo-50 text-indigo-700">live</span>}
              </div>
            </div>
          </li>
        );
      });
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold leading-tight">{node.name}</h2>
          {isHolding ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1 shrink-0"><Star className="w-3 h-3" /> In portfolio</span>
          ) : (
            <button className="text-xs px-2 py-0.5 rounded-full border border-slate-300 hover:bg-slate-50 flex items-center gap-1 shrink-0" onClick={() => onAddHolding(node)}>
              <Plus className="w-3 h-3" /> Portfolio
            </button>
          )}
        </div>
        <div className="text-slate-500 text-xs mt-0.5">
          {[node.sector, node.kind === "investor" ? "Investor" : node.kind === "public" ? "Public" : "Private", node.value_usd && `~${fmtUsd(node.value_usd)} value`].filter(Boolean).join(" · ")}
        </div>
        {node.description && <p className="mt-2 text-slate-700">{node.description}</p>}
        <div className="flex gap-2 mt-3">
          <button disabled={lookupBusy} onClick={() => onLookup(node.name, { force: true })} className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 flex items-center gap-1 disabled:opacity-50">
            <RefreshCw className="w-3.5 h-3.5" /> Search the web for more
          </button>
          <button onClick={() => onFocus(node.key)} className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Center map here</button>
        </div>
      </div>
      {out.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Money out ({out.length}): invests in, buys from</h3>
          <ul>{rows(out, "out")}</ul>
        </section>
      )}
      {inc.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Money in ({inc.length}): investors, customers</h3>
          <ul>{rows(inc, "in")}</ul>
        </section>
      )}
      {out.length + inc.length === 0 && <p className="text-slate-500">No relationships found yet. Try "Search the web for more".</p>}
    </div>
  );
}

function WhatIf({ eventText, setEventText, scenario, byKey, companies, runScenario, applyShocks, pathEdges, onSelect }) {
  const others = scenario?.impacts
    ? Object.entries(scenario.impacts)
        .filter(([, v]) => !v.origin)
        .sort((a, b) => b[1].value - a[1].value)
        .slice(0, 8)
    : [];
  const memoFor = (name) => scenario?.memo?.holdings?.find((h) => h.company?.toLowerCase() === name?.toLowerCase());
  const atRisk = (scenario?.portfolio || []).reduce((s, h) => s + (h.impact.sign < 0 ? h.impact.value * (h.stake_usd || 0) : 0), 0);
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">What if…</label>
        <textarea value={eventText} onChange={(e) => setEventText(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Describe an event, in any language" />
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setEventText(ex); runScenario(ex); }} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-left">
              {ex}
            </button>
          ))}
        </div>
        <button onClick={() => runScenario()} disabled={scenario?.running} className="mt-3 w-full h-10 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {scenario?.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Run scenario
        </button>
      </div>
      {scenario?.error && <p className="text-rose-700 bg-rose-50 rounded p-2">{scenario.error}</p>}
      {scenario?.shocks && (
        <>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Direct hit (drag to adjust)</h3>
            {scenario.shocks.map((s, i) => (
              <div key={s.company} className="flex items-center gap-2 py-1">
                <span className="w-32 truncate font-medium">{byKey[s.company]?.name}</span>
                <input
                  type="range" min={0.05} max={1} step={0.05} value={s.severity}
                  onChange={(e) => {
                    const shocks = scenario.shocks.map((x, j) => (j === i ? { ...x, severity: +e.target.value } : x));
                    applyShocks(scenario.event, scenario.headline, shocks, false);
                  }}
                  className="flex-1 accent-rose-600"
                />
                <span className={`w-10 text-right font-semibold ${s.direction < 0 ? "text-rose-700" : "text-emerald-700"}`}>{s.direction < 0 ? "−" : "+"}{Math.round(s.severity * 100)}</span>
              </div>
            ))}
          </section>
          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your portfolio</h3>
              {atRisk > 0 && <span className="text-xs text-rose-700 font-semibold">~{fmtUsd(atRisk)} of value at risk</span>}
            </div>
            {scenario.memoLoading && <p className="text-xs text-slate-500 flex items-center gap-1 mb-1"><Loader2 className="w-3 h-3 animate-spin" /> Writing analyst notes…</p>}
            {scenario.memo?.summary && <p className="bg-slate-50 rounded p-2 mb-2 text-slate-700">{scenario.memo.summary}</p>}
            {scenario.portfolio.length === 0 && <p className="text-slate-500">None of your holdings are reached by this event.</p>}
            <ul className="space-y-2">
              {scenario.portfolio.map((h) => {
                const pe = pathEdges(scenario.impacts, h.company);
                const memo = memoFor(byKey[h.company]?.name);
                return (
                  <li key={h.company} className="rounded-lg border border-slate-200 p-2.5 cursor-pointer hover:border-slate-300" onClick={() => onSelect(h.company)}>
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">{byKey[h.company]?.name}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${h.impact.sign < 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>
                        {h.impact.sign < 0 ? "−" : "+"}{Math.round(h.impact.value * 100)} impact
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-slate-100 overflow-hidden">
                      <div className={`h-full ${h.impact.sign < 0 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.round(h.impact.value * 100)}%` }} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">
                      {impactPath(scenario.impacts, h.company).map((k) => byKey[k]?.name.replace(/\s*\(.*\)/, "")).join(" → ")}
                      {h.impact.paths > 1 && <span className="text-rose-600"> · hit through {h.impact.paths} relationships</span>}
                    </div>
                    {memo ? (
                      <p className="text-xs text-slate-700 mt-1">{memo.explanation}{memo.action && <span className="block mt-0.5 text-indigo-700">Next: {memo.action}</span>}</p>
                    ) : (
                      <p className="text-xs text-slate-600 mt-1">{pe.map((e) => e.label).join("; ")}.</p>
                    )}
                    {h.stake_usd > 0 && <div className="text-[11px] text-slate-400 mt-1">Position {fmtUsd(h.stake_usd)} · est. {fmtUsd(h.impact.value * h.stake_usd)} {h.impact.sign < 0 ? "at risk" : "upside"}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Biggest knock-on effects</h3>
            <ul>
              {others.map(([k, v]) => (
                <li key={k} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-slate-50 rounded -mx-1 px-1" onClick={() => onSelect(k)}>
                  <span className="w-32 truncate">{byKey[k]?.name}</span>
                  <div className="flex-1 h-1.5 rounded bg-slate-100 overflow-hidden">
                    <div className={`h-full ${v.sign < 0 ? "bg-rose-400" : "bg-emerald-500"}`} style={{ width: `${Math.round(v.value * 100)}%` }} />
                  </div>
                  <span className={`w-9 text-right text-xs font-semibold ${v.sign < 0 ? "text-rose-700" : "text-emerald-700"}`}>{v.sign < 0 ? "−" : "+"}{Math.round(v.value * 100)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-400 mt-2">Impact 0–100. Each relationship passes on part of the shock: more if the deal is large relative to the company, less with every hop. Competitors move the other way.</p>
          </section>
        </>
      )}
    </div>
  );
}

function Risks({ cycles, shared, byKey, holdings, onShowCycle, onShowShared }) {
  const name = (k) => byKey[k]?.name.replace(/\s*\(.*\)/, "");
  return (
    <div className="space-y-5">
      <section>
        <h3 className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-600" /> Concentration you can't see in a spreadsheet</h3>
        <p className="text-xs text-slate-500 mb-2">Companies several of your holdings depend on, directly or one step removed.</p>
        {shared.length === 0 && <p className="text-slate-500">No shared dependencies across your portfolio.</p>}
        <ul className="space-y-2">
          {shared.map((s) => (
            <li key={s.company} className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 cursor-pointer hover:border-amber-400" onClick={() => onShowShared(s)}>
              <div className="font-semibold">
                {s.holdings.length} of {holdings.length} holdings depend on {name(s.company)}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                {s.direct > 0 && <span className="text-amber-800 font-medium">{s.direct} directly: </span>}
                {s.holdings.filter((h) => h.hops === 1).map((h) => name(h.company)).join(", ")}
                {s.holdings.some((h) => h.hops === 2) && <span className="text-slate-500">{s.direct > 0 ? "; via another company: " : "Via another company: "}{s.holdings.filter((h) => h.hops === 2).map((h) => name(h.company)).join(", ")}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-rose-600" /> Circular financing</h3>
        <p className="text-xs text-slate-500 mb-2">Money invested in a company that comes back as that company's purchases. Revenue in these loops is less independent than it looks.</p>
        {cycles.length === 0 && <p className="text-slate-500">No loops found on the map.</p>}
        <ul className="space-y-2">
          {cycles.map((c, i) => (
            <li key={i} className="rounded-lg border border-rose-200 bg-rose-50/40 p-2.5 cursor-pointer hover:border-rose-400" onClick={() => onShowCycle(c, i)}>
              <div className="font-semibold text-xs mb-1">Loop #{i + 1} · {c.length} companies{c.some((e) => e.amount_usd) && ` · ${fmtUsd(c.reduce((s, e) => s + (e.amount_usd || 0), 0))} disclosed`}</div>
              <ol className="text-xs space-y-0.5">
                {c.map((e) => (
                  <li key={e.key} className="flex gap-1.5">
                    <TypeDot type={e.type} />
                    <span>
                      <b>{name(e.source)}</b> → <b>{name(e.target)}</b>: {e.label}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Portfolio({ holdings, byKey, companies, total, onChange, onSelect }) {
  const [adding, setAdding] = useState("");
  const options = companies.filter((c) => !holdings.some((h) => h.company === c.key) && c.kind !== "investor");
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">Fund I · {holdings.length} holdings</h3>
        <span className="text-slate-500 text-xs">{fmtUsd(total)} invested</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {holdings.map((h) => (
          <li key={h.id} className="flex items-center gap-2 py-2">
            <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <button className="flex-1 text-left font-medium hover:underline truncate" onClick={() => onSelect(h.company)}>{byKey[h.company]?.name || h.name}</button>
            <span className="text-slate-400 text-xs">$</span>
            <input
              type="number" min={0} step={1}
              defaultValue={(h.stake_usd || 0) / 1e6}
              onBlur={(e) => onChange(() => api.updateHolding(h.id, { stake_usd: +e.target.value * 1e6 }))}
              className="w-16 h-7 rounded border border-slate-300 px-1.5 text-right"
            />
            <span className="text-slate-400 text-xs">M</span>
            <button className="text-slate-400 hover:text-rose-600" onClick={() => onChange(() => api.removeHolding(h.id))}><X className="w-4 h-4" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} className="flex-1 h-9 rounded-md border border-slate-300 px-2 bg-white">
          <option value="">Add a company on the map…</option>
          {options.map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </select>
        <button disabled={!adding} onClick={() => onChange(async () => { await api.addHolding(adding, byKey[adding].name, 2.5e7); setAdding(""); })} className="h-9 px-3 rounded-md bg-slate-900 text-white disabled:opacity-40 flex items-center gap-1"><Plus className="w-4 h-4" /> Add</button>
      </div>
      <p className="text-xs text-slate-500 flex gap-1"><Tag className="w-3.5 h-3.5 shrink-0 mt-0.5" /> To add a company that isn't on the map yet, search for it first.</p>
    </div>
  );
}
