import { useState } from "react";
import { ArrowRight, FoldVertical, LocateFixed, Plus, RefreshCw, Star, UnfoldVertical } from "lucide-react";
import { EDGE_TYPES, fmtUsd } from "@/lib/graph";
import { Button } from "@/components/ui/button";
import { Row, Section } from "@/components/ui/list";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState, SourceLink, TypeDot, shortName } from "./common";

const PREVIEW_ROWS = 6;

export default function Details({ node, edge, ...props }) {
  if (edge) return <EdgeDetails edge={edge} byKey={props.byKey} onFocus={props.onFocus} />;
  if (!node) return <EmptyState>Select a company or a connection on the map.</EmptyState>;
  // Keyed so the in/out filter and "show all" reset when another company is selected.
  return <NodeDetails key={node.key} node={node} {...props} />;
}

function NodeDetails({ node, byKey, edges, holdings, onSelect, onFocus, onLookup, onAddHolding, lookupBusy, more, onShowMore, onShowFewer }) {
  const byAmount = (a, b) => (b.amount_usd || 0) - (a.amount_usd || 0);
  const out = edges.filter((e) => e.source === node.key).sort(byAmount);
  const inc = edges.filter((e) => e.target === node.key).sort(byAmount);
  const [direction, setDirection] = useState(out.length ? "out" : "in");
  const [showAll, setShowAll] = useState(false);
  const isHolding = holdings.some((h) => h.company === node.key);
  const list = direction === "out" ? out : inc;
  const kind = node.kind === "investor" ? "Investor" : node.kind === "public" ? "Public" : "Private";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-semibold leading-tight tracking-tight">{node.name}</h2>
        <p className="mt-0.5 text-[12.5px] text-label-2">{[node.sector, kind].filter(Boolean).join(" · ")}</p>
        {node.value_usd > 0 && <ValueLine node={node} />}
        {node.description && <p className="mt-2 line-clamp-3 text-[13px] leading-snug text-label/80">{node.description}</p>}
        <div className="mt-3 flex flex-wrap gap-1">
          {isHolding ? (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-warn/15 px-2.5 text-[12px] font-medium text-warn">
              <Star className="h-3.5 w-3.5 fill-current" /> In portfolio
            </span>
          ) : (
            <Button size="sm" variant="tinted" onClick={() => onAddHolding(node)}>
              <Plus className="h-3.5 w-3.5" /> Portfolio
            </Button>
          )}
          <Button size="sm" disabled={lookupBusy} onClick={() => onLookup(node.name, { force: true })}>
            <RefreshCw className="h-3.5 w-3.5" /> Find more
          </Button>
          <Button size="sm" onClick={() => onFocus(node.key)}>
            <LocateFixed className="h-3.5 w-3.5" /> Center
          </Button>
          {more?.count > 0 && (
            <Button size="sm" onClick={() => onShowMore(node.key)}>
              <UnfoldVertical className="h-3.5 w-3.5" /> Show more
            </Button>
          )}
          {more?.extra > 0 && (
            <Button size="sm" onClick={() => onShowFewer(node.key)}>
              <FoldVertical className="h-3.5 w-3.5" /> Show fewer
            </Button>
          )}
        </div>
      </div>

      {out.length + inc.length === 0 ? (
        <EmptyState>No relationships found yet. Try Find more to search the web.</EmptyState>
      ) : (
        <div>
          <SegmentedControl
            size="sm"
            ariaLabel="Direction of money"
            options={[
              { value: "out", label: `Money out · ${out.length}` },
              { value: "in", label: `Money in · ${inc.length}` },
            ]}
            value={direction}
            onChange={(d) => {
              setDirection(d);
              setShowAll(false);
            }}
          />
          <p className="mt-1.5 px-1 text-[11.5px] text-label-2">{direction === "out" ? "Invests in, buys from" : "Investors, customers"}</p>
          {list.length === 0 ? (
            <EmptyState>Nothing in this direction.</EmptyState>
          ) : (
            <Section className="mt-2">
              {(showAll ? list : list.slice(0, PREVIEW_ROWS)).map((e) => (
                <Row
                  key={e.key}
                  leading={<TypeDot type={e.type} />}
                  title={byKey[direction === "out" ? e.target : e.source]?.name}
                  subtitle={e.label}
                  trailing={e.amount_usd && <span className="text-[13px] font-semibold tabular-nums">{fmtUsd(e.amount_usd)}</span>}
                  onClick={() => onSelect({ kind: "edge", key: e.key })}
                />
              ))}
            </Section>
          )}
          {list.length > PREVIEW_ROWS && (
            <button className="mt-1.5 px-1 text-[12.5px] font-medium text-accent hover:underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show less" : `Show all ${list.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const BASIS = { funding_round: "funding round", tender_offer: "tender offer", ipo: "IPO", acquisition: "acquisition", market_cap: "market cap" };

// The company's value (circle size, and shock strength on deals with an amount) and where
// it comes from: a page that states it (dated and quoted), the curated demo data, or the
// model's estimate. Rows saved before value_source existed are curated (seed) or estimates.
function ValueLine({ node }) {
  const source = node.value_source || (node.origin === "seed" ? "seed" : "llm_estimate");
  const label = source === "article"
    ? [fmtUsd(node.value_usd), BASIS[node.value_basis] || "value", node.value_as_of && `as of ${node.value_as_of}`].filter(Boolean).join(" · ")
    : `~${fmtUsd(node.value_usd)} value · ${source === "seed" ? "curated" : "estimate"}`;
  const title = [node.value_evidence && `“${node.value_evidence}”`, node.seed_value_usd && `Curated demo value was ${fmtUsd(node.seed_value_usd)}`].filter(Boolean).join("\n");
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-label-2" title={title || undefined}>
      <span className="shrink-0">{label}</span>
      {source === "article" && <SourceLink url={node.value_source_url} />}
    </p>
  );
}

const PROVENANCE = { seed: "curated", live: "from the article", crunchbase: "Crunchbase profile", llm_web: "AI web search" };

function EdgeDetails({ edge, byKey, onFocus }) {
  const t = EDGE_TYPES[edge.type] || EDGE_TYPES.partnership;
  const provenance = PROVENANCE[edge.origin] || PROVENANCE.llm_web;
  const value = (v) => <span className="text-[13px] text-label-2">{v}</span>;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold leading-snug">{edge.label}</h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => onFocus(edge.source)}>{shortName(byKey[edge.source]?.name)}</Button>
          <span className="flex items-center gap-1 text-[11.5px] text-label-2">
            pays <ArrowRight className="h-3.5 w-3.5" />
          </span>
          <Button size="sm" onClick={() => onFocus(edge.target)}>{shortName(byKey[edge.target]?.name)}</Button>
        </div>
      </div>
      {/* Size and date always show, so a missing value reads as unknown rather than overlooked. */}
      <Section>
        <Row title="Deal size" trailing={edge.amount_usd ? <span className="text-[13px] font-semibold tabular-nums">{fmtUsd(edge.amount_usd)}</span> : value("Not disclosed")} />
        <Row title="Date" trailing={value(edge.date || "Not reported")} />
        <Row title="Deal type" trailing={<span className="flex items-center gap-1.5 text-[13px] text-label-2"><TypeDot type={edge.type} />{t.label}</span>} />
        {edge.source_url && <Row title="Source" trailing={<span className="flex min-w-0 max-w-[60%] text-[13px]"><SourceLink url={edge.source_url} /></span>} />}
        <Row title="Confidence" trailing={value(`${Math.round((edge.confidence ?? 0.7) * 100)}% · ${provenance}`)} />
      </Section>
      {edge.evidence && <blockquote className="border-l-2 border-separator/30 pl-3 text-[13px] italic leading-snug text-label-2">“{edge.evidence}”</blockquote>}
    </div>
  );
}
