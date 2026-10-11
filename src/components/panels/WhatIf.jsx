import { useState } from "react";
import { ChevronRight, Info, Loader2, Zap } from "lucide-react";
import { fmtUsd, impactPath } from "@/lib/graph";
import { Row, Section } from "@/components/ui/list";
import { EmptyState, ImpactBar, ImpactValue, shortName } from "./common";

export default function WhatIf({ scenario, examples, byKey, holdingsCount, onRun, applyShocks, pathEdges, onSelect }) {
  if (scenario?.running) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-label-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Tracing the shock through the map…
      </div>
    );
  }
  if (!scenario?.shocks) {
    return (
      <div className="space-y-4">
        {scenario?.error ? (
          <p className="rounded-xl bg-risk/10 p-3 text-[13px] leading-snug text-risk">{scenario.error}</p>
        ) : (
          <p className="px-1 text-[13px] leading-snug text-label-2">Describe an event in the search bar, or try one of these. The shock travels through every relationship to your portfolio.</p>
        )}
        <Section title="Examples">
          {examples.map((ex) => (
            <Row key={ex} leading={<Zap className="h-4 w-4 shrink-0 text-risk" />} title={<span className="whitespace-normal font-normal leading-snug">{ex}</span>} onClick={() => onRun(ex)} />
          ))}
        </Section>
      </div>
    );
  }
  return <Results scenario={scenario} byKey={byKey} holdingsCount={holdingsCount} applyShocks={applyShocks} pathEdges={pathEdges} onSelect={onSelect} />;
}

function Results({ scenario, byKey, holdingsCount, applyShocks, pathEdges, onSelect }) {
  const [expanded, setExpanded] = useState(null);
  const [showKnockOn, setShowKnockOn] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const atRisk = scenario.portfolio.reduce((s, h) => s + (h.impact.sign < 0 ? h.impact.value * (h.stake_usd || 0) : 0), 0);
  const knockOn = Object.entries(scenario.impacts)
    .filter(([, v]) => !v.origin)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 8);
  const memoFor = (name) => scenario.memo?.holdings?.find((h) => h.company?.toLowerCase() === name?.toLowerCase());

  const setSeverity = (i, severity) => {
    const shocks = scenario.shocks.map((x, j) => (j === i ? { ...x, severity } : x));
    applyShocks(scenario.event, scenario.headline, shocks, false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-semibold leading-snug">{scenario.headline || scenario.event}</h2>
        <div className="mt-3 flex gap-6">
          <Stat value={atRisk > 0 ? `~${fmtUsd(atRisk)}` : "$0"} label="value at risk" tone={atRisk > 0 ? "text-risk" : ""} />
          <Stat
            value={
              <>
                {scenario.portfolio.length}
                <span className="text-[20px] text-label-3">/{holdingsCount}</span>
              </>
            }
            label="holdings reached"
          />
        </div>
      </div>

      <Section title="Direct hit" footer="Drag to change how hard each company is hit.">
        {scenario.shocks.map((s, i) => {
          const harm = s.direction < 0;
          return (
            <div key={s.company} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-24 truncate text-[13.5px] font-medium">{shortName(byKey[s.company]?.name)}</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={s.severity}
                aria-label={`Severity for ${byKey[s.company]?.name}`}
                onChange={(e) => setSeverity(i, +e.target.value)}
                className="slider flex-1"
                style={{ "--slider-color": `rgb(var(${harm ? "--risk" : "--gain"}))`, "--slider-pct": `${((s.severity - 0.05) / 0.95) * 100}%` }}
              />
              <span className={`w-9 text-right text-[13px] font-semibold tabular-nums ${harm ? "text-risk" : "text-gain"}`}>
                {harm ? "−" : "+"}
                {Math.round(s.severity * 100)}
              </span>
            </div>
          );
        })}
      </Section>

      <div>
        {scenario.memoLoading && (
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] text-label-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Writing analyst notes…
          </p>
        )}
        {scenario.memo?.summary && <p className="mb-3 px-1 text-[13px] leading-snug text-label/80">{scenario.memo.summary}</p>}
        {scenario.portfolio.length === 0 ? (
          <EmptyState>None of your holdings are reached by this event.</EmptyState>
        ) : (
          <Section title="Your portfolio">
            {scenario.portfolio.map((h) => {
              const name = byKey[h.company]?.name;
              const open = expanded === h.company;
              const memo = open && memoFor(name);
              return (
                <Row
                  key={h.company}
                  title={name}
                  trailing={<ImpactValue impact={h.impact} className="text-[13px]" />}
                  chevron={open ? "open" : true}
                  active={open}
                  onClick={() => {
                    setExpanded(open ? null : h.company);
                    onSelect(h.company);
                  }}
                >
                  <div className="px-3 pb-2.5">
                    <ImpactBar impact={h.impact} />
                    {open && (
                      <div className="fade-in mt-2 space-y-1 text-[12px] leading-snug">
                        <p className="text-label-2">
                          {impactPath(scenario.impacts, h.company).map((k) => shortName(byKey[k]?.name)).join(" → ")}
                          {h.impact.paths > 1 && <span className="text-risk"> · hit through {h.impact.paths} relationships</span>}
                        </p>
                        {memo ? (
                          <p>
                            {memo.explanation}
                            {memo.action && <span className="mt-0.5 block text-accent">Next: {memo.action}</span>}
                          </p>
                        ) : (
                          <p>{pathEdges(scenario.impacts, h.company).map((e) => e.label).join("; ")}.</p>
                        )}
                        {h.stake_usd > 0 && (
                          <p className="text-label-2">
                            Position {fmtUsd(h.stake_usd)} · est. {fmtUsd(h.impact.value * h.stake_usd)} {h.impact.sign < 0 ? "at risk" : "upside"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Row>
              );
            })}
          </Section>
        )}
      </div>

      <div className="space-y-2">
        <Disclosure open={showKnockOn} onToggle={() => setShowKnockOn((s) => !s)} label={`Knock-on effects · ${knockOn.length}`} />
        {showKnockOn && (
          <Section className="fade-in">
            {knockOn.map(([k, v]) => (
              <Row key={k} title={byKey[k]?.name} trailing={<ImpactValue impact={v} className="text-[12.5px]" />} onClick={() => onSelect(k)}>
                <div className="px-3 pb-2.5">
                  <ImpactBar impact={v} />
                </div>
              </Row>
            ))}
          </Section>
        )}
        <button className="flex items-center gap-1.5 px-1 text-[12px] text-label-2 hover:text-label" onClick={() => setShowMethod((s) => !s)}>
          <Info className="h-3.5 w-3.5" /> How impact is scored
        </button>
        {showMethod && (
          <p className="fade-in px-1 text-[11.5px] leading-snug text-label-2">
            Impact runs 0–100. Each relationship passes on part of the shock: more if the deal is large relative to the company, less with every hop. Competitors move the other way.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, tone = "" }) {
  return (
    <div>
      <div className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-[12px] text-label-2">{label}</div>
    </div>
  );
}

function Disclosure({ open, onToggle, label }) {
  return (
    <button className="flex w-full items-center justify-between px-1 text-[13px] font-semibold text-label-2 hover:text-label" onClick={onToggle} aria-expanded={open}>
      {label}
      <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
    </button>
  );
}
