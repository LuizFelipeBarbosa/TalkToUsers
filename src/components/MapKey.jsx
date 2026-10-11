import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EDGE_TYPES } from "@/lib/graph";

const DEAL_FILTERS = [
  { value: 0, label: "All" },
  { value: 1e9, label: "$1B+" },
  { value: 1e10, label: "$10B+" },
];
const VALUE_FILTERS = [
  { value: 0, label: "All" },
  { value: 1e10, label: "$10B+" },
  { value: 1e11, label: "$100B+" },
];

// Approximate rendered size, so fitting the map can keep clear of the key. Phones wrap the
// text over more lines; a filter caption adds about 24px.
export const mapKeySize = (open, compact) => (open ? { w: compact ? 340 : 400, h: compact ? 300 : 270 } : { w: 130, h: 34 });

const STORAGE_KEY = "ripple.mapKey";

// Whether the key is open, remembered per browser. Storage can be unavailable (private
// windows, blocked site data); the key then simply starts open.
export function useMapKeyOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const set = (next) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
    } catch {
      // Not remembered; the key still opens and closes.
    }
  };
  return [open, set];
}

/**
 * How to read the map, pinned bottom-left and open on first visit, plus the deal-size and
 * company-value filters. Collapses to a small "Key" pill.
 */
export default function MapKey({ compact, open, onOpenChange, minDeal, onMinDeal, minValue, onMinValue, stats, style }) {
  const hidden = [minDeal > 0 && "Undisclosed deals hidden", minValue > 0 && "Companies with no stated value hidden"].filter(Boolean);

  if (!open) {
    return (
      <button style={style} onClick={() => onOpenChange(true)} className="glass absolute z-20 inline-flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-label-2 hover:text-label">
        <Info className="h-4 w-4" />
        Key{hidden.length > 0 && " · filtered"}
      </button>
    );
  }

  return (
    <div style={style} className={`glass fade-in absolute z-20 rounded-2xl p-3 ${compact ? "w-[min(340px,calc(100%-84px))]" : "w-[400px]"}`}>
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[13.5px] leading-tight">
          <span className="font-semibold">How to read the map</span>
        </h2>
        <button aria-label="Hide the key" title="Hide the key" onClick={() => onOpenChange(false)} className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill/[0.14] hover:text-label">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] leading-snug">
        <Item glyph={<SizeGlyph />}>Circle size = market value</Item>
        <Item glyph={<WidthGlyph />}>Thicker = bigger deal</Item>
        <Item glyph={<ArrowGlyph />}>Money flows this way</Item>
        <Item glyph={<LoopGlyph />}>Money loop</Item>
        <Item glyph={<span className="text-[12px] leading-none text-warn">★</span>}>Your portfolio</Item>
        <Item glyph={<MoreGlyph />}>More connections, {compact ? "tap" : "click"} to show</Item>
      </ul>
      {/* Line colour = kind of relationship. */}
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-snug text-label-2">
        {Object.entries(EDGE_TYPES).map(([k, t]) => (
          <li key={k} className="flex items-center gap-1">
            <svg width="14" height="6" aria-hidden>
              <line x1="0" y1="3" x2="14" y2="3" stroke={t.color} strokeWidth="2.5" strokeDasharray={t.dashed ? "3 2" : undefined} />
            </svg>
            {t.label}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] leading-snug text-label-2">
        {compact ? "Tap" : "Click"} any line for the deal and its source. Distance means nothing; exposure is in <span className="font-medium text-label">Risks</span> and <span className="font-medium text-label">What if</span>.
      </p>

      <div className="mt-2.5 space-y-1.5 border-t border-separator/[0.12] pt-2.5">
        <Filter label="Deals" options={DEAL_FILTERS} value={minDeal} onChange={onMinDeal} />
        <Filter label="Companies" options={VALUE_FILTERS} value={minValue} onChange={onMinValue} />
        {hidden.length > 0 && <p className="text-[11px] text-label-2">{hidden.join(" · ")}</p>}
        {stats && <p className="text-[11px] text-label-3">{stats}</p>}
      </div>
    </div>
  );
}

function Item({ glyph, children }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="grid shrink-0 place-items-center text-label-2" aria-hidden>
        {glyph}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Filter({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[12px] text-label-2">{label}</span>
      <SegmentedControl size="sm" ariaLabel={`Filter ${label.toLowerCase()} by size`} options={options} value={value} onChange={onChange} className="min-w-0 flex-1" />
    </div>
  );
}

const SizeGlyph = () => (
  <svg width="22" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.2">
    <circle cx="5" cy="9" r="3.5" />
    <circle cx="17.5" cy="7" r="6.3" />
  </svg>
);

const WidthGlyph = () => (
  <svg width="18" height="12" viewBox="0 0 26 12" stroke="currentColor" strokeLinecap="round">
    <line x1="2" y1="3" x2="24" y2="3" strokeWidth="1.2" />
    <line x1="2" y1="9" x2="24" y2="9" strokeWidth="3.5" />
  </svg>
);

const ArrowGlyph = () => (
  <svg width="18" height="10" viewBox="0 0 26 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="2" y1="5" x2="20" y2="5" />
    <path d="M17.5 1.5 L23 5 L17.5 8.5 z" fill="currentColor" strokeWidth="0" />
  </svg>
);

const MoreGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2">
    <circle cx="7" cy="7" r="5.5" />
  </svg>
);

const LoopGlyph = () => (
  <svg width="18" height="10" viewBox="0 0 26 10" className="text-risk" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round">
    <line x1="2" y1="5" x2="24" y2="5" />
  </svg>
);
