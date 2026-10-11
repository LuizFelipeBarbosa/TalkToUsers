import { useEffect, useRef, useState } from "react";
import { Layers, Minus, Plus, Scan } from "lucide-react";
import { EDGE_TYPES } from "@/lib/graph";
import { Switch } from "@/components/ui/switch";

/**
 * Zoom / fit buttons plus a Layers popover holding the view toggles and the connection colours
 * (how to read the rest of the map is in MapKey).
 * Horizontal pill bottom-right on wide screens; vertical stack above the sheet on phones.
 */
export default function MapControls({ graph, compact, showAll, onShowAll, foldBusy, onFoldBusy, showLabels, onShowLabels, stats, offline, style }) {
  const [layersOpen, setLayersOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!layersOpen) return;
    const close = (e) => {
      if (e.type === "keydown") {
        if (e.key !== "Escape") return;
        e.stopPropagation(); // App's window-level Escape handler should not also fire
        setLayersOpen(false);
      } else if (!rootRef.current?.contains(e.target)) {
        setLayersOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [layersOpen]);

  // Touch layouts drop the zoom buttons: pinching does that.
  const buttons = [
    !compact && { label: "Zoom in", Icon: Plus, onClick: () => graph.current?.zoomIn() },
    !compact && { label: "Zoom out", Icon: Minus, onClick: () => graph.current?.zoomOut() },
    { label: "Fit map to screen", Icon: Scan, onClick: () => graph.current?.fit() },
    { label: "Layers and legend", Icon: Layers, onClick: () => setLayersOpen((o) => !o), active: layersOpen },
  ].filter(Boolean);

  return (
    <div ref={rootRef} className="absolute z-20" style={style}>
      <div className={`glass flex rounded-full p-1 ${compact ? "flex-col" : "items-center"}`}>
        {buttons.map(({ label, Icon, onClick, active }) => (
          <button
            key={label}
            aria-label={label}
            title={label}
            aria-expanded={Icon === Layers ? active : undefined}
            onClick={onClick}
            className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${active ? "bg-accent text-white" : "text-label-2 hover:bg-fill/[0.14] hover:text-label"}`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        ))}
      </div>

      {layersOpen && (
        <div className={`glass fade-in absolute w-[316px] max-w-[calc(100vw-80px)] rounded-2xl p-3 ${compact ? "bottom-0 right-full mr-2" : "bottom-full right-0 mb-2"}`}>
          <div className="overflow-hidden rounded-xl bg-fill/[0.08]">
            <Toggle label="Show whole map" checked={showAll} onChange={onShowAll} />
            <Toggle label="Fold busy companies" checked={foldBusy} onChange={onFoldBusy} />
            <Toggle label="Deal callouts" checked={showLabels} onChange={onShowLabels} />
          </div>

          <h3 className="mb-1.5 mt-3 px-1 text-[12px] font-semibold text-label-2">Connections</h3>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-1 text-[11.5px]">
            {Object.entries(EDGE_TYPES).map(([k, t]) => (
              <li key={k} className="flex min-w-0 items-center gap-1.5">
                <svg width="16" height="6" className="shrink-0" aria-hidden>
                  <line x1="1" y1="3" x2="15" y2="3" stroke={t.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={t.dashed ? "3 3" : undefined} />
                </svg>
                <span className="truncate" title={t.label}>{t.label}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-separator/[0.12] px-1 pt-2.5 text-[11.5px] text-label-2">
            <span>
              {stats.companies} companies · {stats.relationships} relationships
            </span>
            {offline && <span className="shrink-0 whitespace-nowrap rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">Offline demo</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="relative flex min-h-[40px] items-center justify-between gap-3 px-3 text-[13.5px] after:absolute after:bottom-0 after:left-3 after:right-0 after:h-px after:bg-separator/[0.12] last:after:hidden">
      <span>{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
