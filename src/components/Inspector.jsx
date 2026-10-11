import { useEffect, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";

// Height of the bottom sheet when collapsed: grabber, tabs and the first line or two of content.
export const SHEET_PEEK = 124;
const TOP_GAP = 76; // keeps the command bar visible above a fully raised sheet

/**
 * The one container for Details / Loops / What if / Risks / Portfolio. On wide screens it is a
 * floating card that hugs its content and collapses to just the tabs; on phones it is a
 * bottom sheet with peek / half / full detents.
 */
export default function Inspector({ compact, tabs, tab, onTabChange, open, onOpenChange, children }) {
  const tabControl = <SegmentedControl ariaLabel="Panels" options={tabs} value={tab} onChange={onTabChange} className="min-w-0 flex-1" />;
  if (compact) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} header={tabControl}>
        {children}
      </BottomSheet>
    );
  }
  return (
    <aside className="glass absolute right-3 top-3 z-10 flex max-h-[calc(100%-84px)] w-[368px] flex-col overflow-hidden rounded-2xl xl:w-[380px]">
      <div className="flex shrink-0 items-center gap-1.5 p-2">
        {tabControl}
        <button
          aria-label={open ? "Collapse panel" : "Expand panel"}
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill/[0.14] hover:text-label"
        >
          <ChevronUp className={`h-4 w-4 transition-transform duration-300 ease-ios ${open ? "" : "rotate-180"}`} />
        </button>
      </div>
      {/* Animating grid rows between 0fr and 1fr gives a smooth height transition to "auto". */}
      <div className={`grid min-h-0 transition-[grid-template-rows] duration-300 ease-ios ${open ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[minmax(0,0fr)]"}`}>
        <div className="scroll-area min-h-0 px-4 pb-4 pt-2">{children}</div>
      </div>
    </aside>
  );
}

function BottomSheet({ open, onOpenChange, header, children }) {
  const [detent, setDetent] = useState(open ? "half" : "peek");
  const [dragHeight, setDragHeight] = useState(null);
  const drag = useRef(null);

  // Follow the parent's open/closed state without losing a "full" detent the user chose.
  useEffect(() => {
    setDetent((d) => (open ? (d === "peek" ? "half" : d) : "peek"));
  }, [open]);

  const heights = () => ({ peek: SHEET_PEEK, half: Math.round(window.innerHeight * 0.52), full: window.innerHeight - TOP_GAP });
  const goTo = (d) => {
    setDetent(d);
    onOpenChange(d !== "peek");
  };

  const onPointerDown = (e) => {
    if (e.button) return;
    drag.current = { startY: e.clientY, startH: heights()[detent], moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dy = drag.current.startY - e.clientY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    const h = heights();
    setDragHeight(Math.min(h.full, Math.max(h.peek * 0.7, drag.current.startH + dy)));
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    const { startY, startH, moved } = drag.current;
    drag.current = null;
    setDragHeight(null);
    if (!moved) return goTo(detent === "peek" ? "half" : "peek");
    const h = heights();
    const target = startH + (startY - e.clientY);
    const nearest = Object.entries(h).reduce((a, b) => (Math.abs(b[1] - target) < Math.abs(a[1] - target) ? b : a));
    goTo(nearest[0]);
  };

  const height = dragHeight ?? { peek: `${SHEET_PEEK}px`, half: "52dvh", full: `calc(100dvh - ${TOP_GAP}px)` }[detent];
  return (
    <aside
      className={`glass fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[22px] pb-[env(safe-area-inset-bottom)] ${dragHeight == null ? "transition-[height] duration-300 ease-ios" : ""}`}
      style={{ height }}
    >
      <div className="shrink-0 cursor-grab touch-none select-none px-3 pb-2 active:cursor-grabbing" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="mx-auto mb-2 mt-1.5 h-[5px] w-9 rounded-full bg-label-3/60" />
        <div className="flex" onPointerDown={(e) => e.stopPropagation()}>
          {header}
        </div>
      </div>
      <div
        className={`min-h-0 flex-1 px-4 pb-4 pt-1 ${detent === "peek" ? "overflow-hidden" : "scroll-area"}`}
        onClickCapture={(e) => {
          // In the peek position the content is a preview: a tap raises the sheet instead.
          if (detent !== "peek") return;
          e.stopPropagation();
          goTo("half");
        }}
      >
        {children}
      </div>
    </aside>
  );
}
