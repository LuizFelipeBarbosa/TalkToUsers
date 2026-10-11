import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import GraphView from "@/components/GraphView";
import CommandBar from "@/components/CommandBar";
import Inspector, { SHEET_PEEK } from "@/components/Inspector";
import MapControls from "@/components/MapControls";
import MapKey, { mapKeySize, useMapKeyOpen } from "@/components/MapKey";
import Details from "@/components/panels/Details";
import WhatIf from "@/components/panels/WhatIf";
import Loops from "@/components/panels/Loops";
import Risks from "@/components/panels/Risks";
import Portfolio from "@/components/panels/Portfolio";
import { loopPath, shortName } from "@/components/panels/common";
import { api, OFFLINE, companyKey } from "@/api/backend";
import { propagate, impactPath, findCircularFinancing, groupLoops, loopFlow, findSharedDependencies, collapseMap } from "@/lib/graph";
import { useMediaQuery } from "@/lib/useMediaQuery";

const EXAMPLES = [
  "OpenAI fails to raise its next round and halves its compute commitments",
  "Microsoft stops renting GPU capacity from neoclouds",
  "Nvidia's next-gen chips slip by two quarters",
  "Oracle can't finance its Stargate data centers",
];

// How many more of a company's folded connections one click on its "+N" shows.
const SHOW_MORE_STEP = 10;

// Phones, and tablets held upright, get a bottom sheet; wider screens get a floating card.
const COMPACT_QUERY = "(max-width: 767px), (max-width: 1023px) and (orientation: portrait)";
const WIDE_QUERY = "(min-width: 1280px)"; // matches Tailwind's xl, where the card widens
const startsCompact = () => window.matchMedia(COMPACT_QUERY).matches;

export default function App() {
  const compact = useMediaQuery(COMPACT_QUERY);
  const wide = useMediaQuery(WIDE_QUERY);
  const [data, setData] = useState({ companies: [], relationships: [], holdings: [] });
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState("openai");
  const [selected, setSelected] = useState({ kind: "node", key: "openai" });
  const [showAll, setShowAll] = useState(false);
  const [showLabels, setShowLabels] = useState(() => !startsCompact());
  const [extra, setExtra] = useState({}); // company -> how many more of its folded connections are shown
  const [foldBusy, setFoldBusy] = useState(true);
  const [minDeal, setMinDeal] = useState(0); // hide deals below this size (USD)
  const [showUndisclosed, setShowUndisclosed] = useState(false); // keep deals with no amount when minDeal is set
  const [minValue, setMinValue] = useState(0); // hide companies valued below this (USD)
  const [keyOpen, setKeyOpen] = useMapKeyOpen();
  const [tab, setTab] = useState("details");
  const [panelOpen, setPanelOpen] = useState(() => !startsCompact());
  const [lookup, setLookup] = useState(null); // {name, step, error, result}
  const [scenario, setScenario] = useState(null);
  const [highlight, setHighlight] = useState(null); // {id, title, edges:Set, impacts}
  const graphRef = useRef(null);
  const searchRef = useRef(null);

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

  const impacted = useMemo(
    () => new Set(Object.keys({ ...scenario?.impacts, ...highlight?.impacts })),
    [scenario?.impacts, highlight?.impacts]
  );
  const selectedEdgeKey = selected?.kind === "edge" ? selected.key : null;
  const selectedNodeKey = selected?.kind === "node" ? selected.key : null;
  const pinned = useMemo(() => {
    const keys = new Set([focus, ...holdingKeys, ...impacted]);
    if (selectedNodeKey) keys.add(selectedNodeKey);
    for (const edgeKey of [...(scenario?.edgesHit || []), ...(highlight?.edges || [])]) {
      const edge = edgeByKey[edgeKey];
      if (edge) {
        keys.add(edge.source);
        keys.add(edge.target);
      }
    }
    if (selectedEdgeKey) {
      const edge = edgeByKey[selectedEdgeKey];
      if (edge) {
        keys.add(edge.source);
        keys.add(edge.target);
      }
    }
    return keys;
  }, [focus, holdingKeys, impacted, scenario?.edgesHit, highlight?.edges, edgeByKey, selectedEdgeKey, selectedNodeKey]);

  // What is drawn: the focus company's 2-hop neighbourhood (plus anything a scenario
  // touched), or the whole map when "Show whole map" is on. `centre` is the company the
  // neighbourhood was walked from, or null for the whole map. The deal and company filters
  // apply first. They never hide the focus company, holdings, or what a scenario or
  // highlight points at, and they only change the view: Loops, Risks and What if use every edge.
  const neighbourhood = useMemo(() => {
    const filtering = minDeal > 0 || minValue > 0;
    let shownCompanies = companies;
    let shownEdges = edges;
    if (filtering) {
      const pinnedAgainstFilters = new Set([focus, ...holdingKeys, ...impacted]);
      const pinnedEdges = new Set([...(scenario?.edgesHit || []), ...(highlight?.edges || [])]);
      shownCompanies = companies.filter((c) => pinnedAgainstFilters.has(c.key) || (c.value_usd || 0) >= minValue);
      const shown = new Set(shownCompanies.map((c) => c.key));
      const bigEnough = (e) => minDeal === 0 || (e.amount_usd ? e.amount_usd >= minDeal : showUndisclosed);
      shownEdges = edges.filter((e) => pinnedEdges.has(e.key) || (shown.has(e.source) && shown.has(e.target) && bigEnough(e)));
      // Companies the filters left without a line would float alone.
      const linked = new Set(shownEdges.flatMap((e) => [e.source, e.target]));
      shownCompanies = shownCompanies.filter((c) => linked.has(c.key) || pinnedAgainstFilters.has(c.key));
    }
    if (showAll || !focus || !byKey[focus]) return { nodes: shownCompanies, edges: shownEdges, centre: null };
    const keep = new Set([focus]);
    let frontier = new Set([focus]);
    for (let hop = 0; hop < 2; hop++) {
      const next = new Set();
      for (const e of shownEdges) {
        if (e.type === "competitor" && hop > 0) continue;
        for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
          if (frontier.has(a) && !keep.has(b)) {
            keep.add(b);
            next.add(b);
          }
        }
      }
      frontier = next;
    }
    // Added after the walk, so highlighting companies inside the neighbourhood doesn't
    // change which companies are drawn (and doesn't move the map).
    for (const k of impacted) keep.add(k);
    return { nodes: shownCompanies.filter((c) => keep.has(c.key)), edges: shownEdges.filter((e) => keep.has(e.source) && keep.has(e.target)), centre: focus };
  }, [showAll, companies, edges, focus, byKey, scenario?.edgesHit, highlight?.edges, impacted, holdingKeys, minDeal, showUndisclosed, minValue]);

  const visible = useMemo(
    () => foldBusy
      ? collapseMap(neighbourhood.nodes, neighbourhood.edges, { focus: neighbourhood.centre, pinned, extra })
      : { ...neighbourhood, more: {} },
    [foldBusy, neighbourhood, pinned, extra]
  );

  const showPanel = (t) => {
    setTab(t);
    setPanelOpen(true);
  };

  // A company's "+N" shows its next few folded connections; "Show fewer" folds them all back.
  const showMore = (key) => setExtra((current) => ({ ...current, [key]: (current[key] || 0) + SHOW_MORE_STEP }));
  const showFewer = (key) => {
    setExtra((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  // A newly centred map opens folded.
  const changeFocus = (key) => {
    setFocus(key);
    setExtra({});
  };

  const focusCompany = (key) => {
    changeFocus(key);
    setSelected({ kind: "node", key });
    showPanel("details");
  };

  const clearScenario = () => {
    setScenario(null);
    setHighlight(null);
  };

  const select = (s) => {
    setSelected(s);
    if (s) showPanel("details");
    else if (compact) setPanelOpen(false);
  };

  const runLookup = async (name, opts) => {
    if (!name.trim()) return;
    setLookup({ name, step: "Starting" });
    clearScenario();
    try {
      // The graph grows as each research round saves, including the Crunchbase round that
      // finishes in the background after the lookup has returned.
      const onUpdate = () => reload().catch(console.error);
      const res = await api.lookup(name.trim(), (step) => setLookup((l) => ({ ...l, step })), { ...opts, onUpdate });
      const d = await reload();
      const key = res?.key || companyKey(name);
      const n = d.relationships.filter((r) => r.source === key || r.target === key).length;
      const mappedName = d.companies.find((c) => c.key === key)?.name || name;
      setLookup({ name: mappedName, done: true, result: res, count: n });
      focusCompany(key);
    } catch (e) {
      setLookup({ name, error: String(e.message || e) });
    }
  };
  const dismissLookup = useCallback(() => setLookup(null), []);

  // ---------- What-if ----------
  const runScenario = async (text) => {
    const ev = text.trim();
    if (!ev) return;
    setHighlight(null);
    setScenario({ event: ev, running: true });
    showPanel("whatif");
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
    showPanel("whatif");
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

  const loopGroups = useMemo(() => groupLoops(findCircularFinancing(edges)), [edges]);
  const shared = useMemo(() => findSharedDependencies(companies, edges, holdingKeys), [companies, edges, holdingKeys]);

  // Draw money loops on the map, everything else faded: one route back to the investor, or
  // (with no routeIndex) every route of the group.
  const showLoop = (group, routeIndex) => {
    setScenario(null);
    const routes = routeIndex == null ? group.routes : [group.routes[routeIndex]];
    const loopEdges = routes.flat();
    const nodes = Object.fromEntries(loopEdges.map((e) => [e.source, { value: 0.55, sign: -1, mark: true }]));
    const { source, target } = group.investment;
    const title = routes.length > 1
      ? `Money loops: ${shortName(byKey[source]?.name)} → ${shortName(byKey[target]?.name)}, ${routes.length} ways back`
      : `Money loop: ${loopPath(routes[0], byKey)}`;
    const id = routeIndex == null ? `loop:${group.id}` : `loop:${group.id}:${routeIndex}`;
    setHighlight({ id, kind: "loop", title, edges: new Set(loopEdges.map((e) => e.key)), impacts: nodes });
  };

  // The first screen leads with the biggest money loop, which shows what the map is for at a
  // glance. It runs before the first paint, so the map never shows without it. Phones keep the
  // sheet down so the map stays in view.
  useLayoutEffect(() => {
    if (loading || !loopGroups.length) return;
    const top = loopGroups[0];
    const biggest = top.routes.reduce((a, b) => (loopFlow(b) > loopFlow(a) ? b : a));
    showLoop(top, top.routes.indexOf(biggest));
    setSelected(null);
    if (compact) setTab("loops");
    else showPanel("loops");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ⌘K or / focuses the search; Escape steps back: selection, then scenario, then the panel.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (selected) setSelected(null);
        else if (scenario || highlight) clearScenario();
        else setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, scenario, highlight]);

  const graphImpacts = highlight ? highlight.impacts : scenario?.impacts;
  const graphEdgesHit = highlight ? highlight.edges : scenario?.edgesHit;
  const chip = highlight ? highlight.title : scenario?.impacts ? scenario.headline || scenario.event : null;

  const selNode = selected?.kind === "node" ? byKey[selected.key] : null;
  const selEdge = selected?.kind === "edge" ? edgeByKey[selected.key] : null;

  const totalStake = holdings.reduce((s, h) => s + (h.stake_usd || 0), 0);

  // Canvas area covered by floating UI, which fitting the map keeps clear.
  const cardWidth = wide ? 380 : 368;
  // The key sits in the bottom-left corner; the map fits above it or beside it.
  const key = mapKeySize(keyOpen, compact, minDeal > 0);
  const top = chip ? 116 : 72; // the search bar, plus the chip under it
  const insets = compact
    ? { top, right: 56, bottom: SHEET_PEEK + 8, left: 0, corner: { w: key.w + 24, h: SHEET_PEEK + key.h + 20 } }
    : { top, right: panelOpen ? cardWidth + 24 : 0, bottom: 64, left: 0, corner: { w: key.w + 24, h: key.h + 24 } };

  const tabs = [
    { value: "details", label: "Details" },
    { value: "loops", label: "Loops", badge: loopGroups.length },
    { value: "whatif", label: "What if" },
    { value: "risks", label: "Risks", badge: shared.length },
    { value: "portfolio", label: "Portfolio" },
  ];

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-canvas text-label">
      <main className="absolute inset-0">
        {loading ? (
          <div className="grid h-full place-items-center text-label-2">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <GraphView
            ref={graphRef}
            nodes={visible.nodes}
            edges={visible.edges}
            more={visible.more}
            holdings={holdings}
            focus={scenario?.impacts || highlight ? null : focus}
            selected={selected}
            onSelect={select}
            onShowMore={showMore}
            onShowFewer={showFewer}
            impacts={graphImpacts}
            edgesHit={graphEdgesHit}
            showLabels={showLabels}
            insets={insets}
          />
        )}
      </main>

      <CommandBar
        ref={searchRef}
        className="absolute left-3 top-[max(12px,env(safe-area-inset-top))] z-40"
        style={{ width: compact ? "calc(100% - 24px)" : `min(440px, calc(100% - ${cardWidth + 36}px))` }}
        companies={companies}
        examples={EXAMPLES}
        lookup={lookup}
        onDismissLookup={dismissLookup}
        scenarioBusy={!!scenario?.running}
        chip={chip}
        chipAction={highlight?.kind === "loop" ? "Explore the map" : undefined}
        onClearChip={clearScenario}
        onPickCompany={(key) => {
          clearScenario();
          focusCompany(key);
        }}
        onLookup={runLookup}
        onRunScenario={runScenario}
      />

      <MapControls
        graph={graphRef}
        compact={compact}
        style={compact ? { right: 12, bottom: `calc(${SHEET_PEEK + 12}px + env(safe-area-inset-bottom))` } : { right: 12, bottom: 12 }}
        showAll={showAll}
        onShowAll={setShowAll}
        foldBusy={foldBusy}
        onFoldBusy={setFoldBusy}
        showLabels={showLabels}
        onShowLabels={setShowLabels}
        stats={{ companies: companies.length, relationships: edges.length }}
        offline={OFFLINE}
      />

      <MapKey
        compact={compact}
        style={compact ? { left: 12, bottom: `calc(${SHEET_PEEK + 12}px + env(safe-area-inset-bottom))` } : { left: 12, bottom: 12 }}
        open={keyOpen}
        onOpenChange={setKeyOpen}
        minDeal={minDeal}
        onMinDeal={setMinDeal}
        showUndisclosed={showUndisclosed}
        onShowUndisclosed={setShowUndisclosed}
        minValue={minValue}
        onMinValue={setMinValue}
      />

      <Inspector compact={compact} tabs={tabs} tab={tab} onTabChange={showPanel} open={panelOpen} onOpenChange={setPanelOpen}>
        {tab === "details" && (
          <Details
            node={selNode}
            edge={selEdge}
            byKey={byKey}
            edges={edges}
            holdings={holdings}
            onSelect={setSelected}
            onFocus={(k) => {
              changeFocus(k);
              setSelected({ kind: "node", key: k });
            }}
            onLookup={runLookup}
            more={visible.more[selNode?.key]}
            onShowMore={showMore}
            onShowFewer={showFewer}
            onAddHolding={async (c) => {
              await api.addHolding(c.key, c.name, 2.5e7);
              reload();
            }}
            lookupBusy={!!lookup && !lookup.done && !lookup.error}
          />
        )}
        {tab === "loops" && (
          <Loops
            groups={loopGroups}
            byKey={byKey}
            holdingKeys={holdingKeys}
            activeId={highlight?.id}
            onShowLoop={showLoop}
            onSelectEdge={(key) => select({ kind: "edge", key })}
            onClear={() => setHighlight(null)}
          />
        )}
        {tab === "whatif" && (
          <WhatIf
            scenario={scenario}
            examples={EXAMPLES}
            byKey={byKey}
            holdingsCount={holdings.length}
            onRun={runScenario}
            applyShocks={applyShocks}
            pathEdges={pathEdges}
            onSelect={(k) => setSelected({ kind: "node", key: k })}
          />
        )}
        {tab === "risks" && (
          <Risks
            shared={shared}
            byKey={byKey}
            holdings={holdings}
            activeId={highlight?.id}
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
            onSelect={focusCompany}
          />
        )}
      </Inspector>
    </div>
  );
}
