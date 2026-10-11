import { ExternalLink } from "lucide-react";
import { EDGE_TYPES } from "@/lib/graph";

export const shortName = (name) => name?.replace(/\s*\(.*\)/, "");

// "A → B → C → A" for a circular financing loop (a list of edges).
export const loopPath = (cycle, byKey) => [...cycle.map((e) => e.source), cycle[0].source].map((k) => shortName(byKey[k]?.name)).join(" → ");

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function TypeDot({ type }) {
  const t = EDGE_TYPES[type] || EDGE_TYPES.partnership;
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} title={t.label} />;
}

export function SourceLink({ url }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
      <span className="truncate">{host(url)}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

export function EmptyState({ children }) {
  return <p className="py-6 text-center text-[13px] text-label-2">{children}</p>;
}

// Signed 0–100 impact score, red for harm and green for benefit.
export function ImpactValue({ impact, className = "" }) {
  const harm = impact.sign < 0;
  return (
    <span className={`tabular-nums font-semibold ${harm ? "text-risk" : "text-gain"} ${className}`}>
      {harm ? "−" : "+"}
      {Math.round(impact.value * 100)}
    </span>
  );
}

export function ImpactBar({ impact }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-fill/20">
      <div className={`h-full rounded-full ${impact.sign < 0 ? "bg-risk" : "bg-gain"}`} style={{ width: `${Math.round(impact.value * 100)}%` }} />
    </div>
  );
}
