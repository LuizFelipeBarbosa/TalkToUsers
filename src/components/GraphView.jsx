import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter, forceX, forceY } from "d3-force";
import { select } from "d3-selection";
import "d3-transition";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { EDGE_TYPES, edgeWidth, nodeRadius, fmtUsd } from "@/lib/graph";
import { useMediaQuery } from "@/lib/useMediaQuery";

// SVG colors per appearance. They mirror the CSS tokens in index.css, as hex values
// because impact fills are mixed numerically.
const GRAPH_COLORS = {
  light: {
    node: "#ffffff",
    nodeStroke: "rgba(0,0,0,0.12)",
    shadow: 0.12,
    label: "#1d1d1f",
    label2: "#6e6e73",
    select: "#0071e3",
    holding: "#ff9500",
    risk: "#ff3b30",
    riskText: "#d70015",
    gain: "#34c759",
    gainText: "#248a3d",
  },
  dark: {
    node: "#2c2c2e",
    nodeStroke: "rgba(255,255,255,0.14)",
    shadow: 0.5,
    label: "#f5f5f7",
    label2: "#98989d",
    select: "#0a84ff",
    holding: "#ff9f0a",
    risk: "#ff453a",
    riskText: "#ff6961",
    gain: "#30d158",
    gainText: "#30db5b",
  },
};

function impactFill(imp, c) {
  if (!imp) return c.node;
  if (imp.mark) return mix(c.node, c.holding, 0.35);
  const t = Math.min(0.9, imp.value / 0.7);
  return mix(c.node, imp.sign > 0 ? c.gain : c.risk, t);
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

// Quadratic arc from s to t, bent to one side so A->B and B->A don't overlap.
function arcPath(s, t, rS, rT, bend = 0.18) {
  const dx = t.x - s.x, dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const cx = (s.x + t.x) / 2 + nx * len * bend;
  const cy = (s.y + t.y) / 2 + ny * len * bend;
  const a = Math.atan2(cy - s.y, cx - s.x);
  const b = Math.atan2(t.y - cy, t.x - cx);
  const sx = s.x + Math.cos(a) * rS, sy = s.y + Math.sin(a) * rS;
  const tx = t.x - Math.cos(b) * (rT + 3), ty = t.y - Math.sin(b) * (rT + 3);
  // Label anchor: the curve's midpoint.
  const mx = 0.25 * sx + 0.5 * cx + 0.25 * tx, my = 0.25 * sy + 0.5 * cy + 0.25 * ty;
  return { d: `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`, mx, my };
}

function edgeArc(e, s, t) {
  return arcPath(s, t, s.r, t.r, e.type === "competitor" ? 0.08 : 0.2);
}

const shortName = (name) => name.replace(/\s*\(.*\)/, "");

// Where a company starts on the ring before the layout runs. Derived from its key, so the
// same data gives the same map on every visit.
const startAngle = (key) => ([...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 3600) * (Math.PI / 1800);

/**
 * Force-directed relationship map. `insets` ({top, right, bottom, left, corner?}) is the part of the
 * canvas covered by floating UI, which fitting keeps nodes out of. The ref exposes
 * zoomIn / zoomOut / fit for external map controls.
 */
const GraphView = forwardRef(function GraphView({ nodes, edges, holdings, focus, selected, onSelect, impacts, edgesHit, showLabels, insets, folds = {}, onToggleFold }, ref) {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const simRef = useRef(null);
  const zoomRef = useRef(null);
  const posRef = useRef({}); // key -> {x, y}, survives data reloads
  const fitted = useRef(false);
  const userMoved = useRef(false); // the user panned, zoomed or dragged since the last layout started
  const nodeEls = useRef(new Map());
  const edgeEls = useRef(new Map());
  const labelEls = useRef(new Map());
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const layoutKey = useRef(null); // the companies, links and canvas size the current layout was made for
  // The map fills the window, so start at its size: a placeholder size would lay the map out twice.
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [hoverEdge, setHoverEdge] = useState(null);
  const holdingSet = useMemo(() => new Set(holdings.map((h) => h.company)), [holdings]);
  const c = GRAPH_COLORS[useMediaQuery("(prefers-color-scheme: dark)") ? "dark" : "light"];

  // Resize with the container.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Simulation nodes/links are copies that keep their positions across renders.
  const simNodes = useMemo(
    () =>
      nodes.map((n) => {
        const p = posRef.current[n.key];
        const o = { ...n, r: nodeRadius(n), x: p?.x, y: p?.y };
        if (o.x == null) {
          const ang = startAngle(n.key);
          let neighbour;
          for (const e of edges) {
            const other = e.source === n.key ? e.target : e.target === n.key ? e.source : null;
            if (other && posRef.current[other]) {
              neighbour = posRef.current[other];
              break;
            }
          }
          o.x = (neighbour?.x ?? size.w / 2) + Math.cos(ang) * (neighbour ? 60 : 200);
          o.y = (neighbour?.y ?? size.h / 2) + Math.sin(ang) * (neighbour ? 60 : 200);
        }
        return o;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges],
  );
  const byKey = useMemo(() => Object.fromEntries(simNodes.map((n) => [n.key, n])), [simNodes]);
  const simLinks = useMemo(
    () => edges.filter((e) => byKey[e.source] && byKey[e.target]).map((e) => ({ ...e, s: e.source, t: e.target })),
    [edges, byKey],
  );

  const paint = () => {
    for (const n of simNodes) {
      const el = nodeEls.current.get(n.key);
      if (el) el.setAttribute("transform", `translate(${n.x},${n.y})`);
    }
    for (const e of simLinks) {
      const s = byKey[e.source], t = byKey[e.target];
      if (!s || !t) continue;
      const { d, mx, my } = edgeArc(e, s, t);
      const edgeEl = edgeEls.current.get(e.key);
      if (edgeEl) {
        for (const path of edgeEl.querySelectorAll("path")) path.setAttribute("d", d);
      }
      const labelEl = labelEls.current.get(e.key);
      if (labelEl) labelEl.setAttribute("transform", `translate(${mx},${my})`);
    }
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  // Fit everything into the uncovered part of the canvas. A panel in the bottom-left corner
  // (`insets.corner`, {w, h}) is cleared by fitting the map above it or beside it, whichever
  // draws the map bigger.
  const fitView = (animate) => {
    if (!simNodes.length || !zoomRef.current) return;
    const { top = 0, right = 0, bottom = 0, left = 0, corner } = insetsRef.current || {};
    const xs = simNodes.flatMap((n) => [n.x - n.r - 40, n.x + n.r + 40]);
    const ys = simNodes.flatMap((n) => [n.y - n.r - 20, n.y + n.r + 30]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const areas = corner ? [{ left, bottom: Math.max(bottom, corner.h) }, { left: Math.max(left, corner.w), bottom }] : [{ left, bottom }];
    const fits = areas.map((a) => {
      const aw = Math.max(120, size.w - a.left - right);
      const ah = Math.max(120, size.h - top - a.bottom);
      return { left: a.left, aw, ah, k: Math.min(1.6, 0.94 / Math.max((x1 - x0) / aw, (y1 - y0) / ah)) };
    });
    const { left: l, aw, ah, k } = fits.reduce((best, f) => (f.k > best.k ? f : best));
    const tr = zoomIdentity.translate(l + aw / 2 - (k * (x0 + x1)) / 2, top + ah / 2 - (k * (y0 + y1)) / 2).scale(k);
    const svg = select(svgRef.current);
    (animate ? svg.transition().duration(500) : svg).call(zoomRef.current.transform, tr);
  };
  const fitRef = useRef(fitView);
  fitRef.current = fitView;

  // Pan & zoom. Set up before the layout below, which fits the view through it.
  useLayoutEffect(() => {
    const z = d3zoom()
      .scaleExtent([0.2, 4])
      .filter((ev) => !ev.target.closest?.("[data-node]") && !ev.button)
      .on("zoom", (ev) => {
        if (ev.sourceEvent) userMoved.current = true;
        select(gRef.current).attr("transform", ev.transform);
      });
    select(svgRef.current).call(z).on("dblclick.zoom", null);
    zoomRef.current = z;
  }, []);

  // Runs before the browser paints, so a new visitor never sees the layout move: the first
  // layout runs to rest off screen. When companies or links change later (a lookup, a filter),
  // the map settles visibly so you can see what changed. A re-render with the same companies
  // and links (say, a highlight) carries on from where the previous layout was, usually at rest.
  useLayoutEffect(() => {
    const prev = simRef.current;
    prev?.stop();
    const key = [simNodes.map((n) => n.key).sort(), simLinks.map((l) => l.key).sort(), size.w, size.h].join("|");
    const firstLayout = layoutKey.current == null;
    const unchanged = key === layoutKey.current;
    layoutKey.current = key;
    const links = simLinks.map((l) => ({ source: l.s, target: l.t, l }));
    // Pull harder across the short side of the screen so the layout takes the screen's shape
    // (tall on phones, wide on desktops). The charge is the same for every company, so distance
    // on the map doesn't depend on size.
    const aspect = size.w / size.h;
    const sim = forceSimulation(simNodes)
      .force("link", forceLink(links).id((d) => d.key).distance((d) => 95 + d.source.r + d.target.r).strength(0.3))
      .force("charge", forceManyBody().strength(-1000))
      .force("collide", forceCollide().radius((d) => d.r + 30))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("x", forceX(size.w / 2).strength(0.03 / Math.min(1, aspect)))
      .force("y", forceY(size.h / 2).strength(0.04 * Math.min(1, aspect)))
      .on("tick", () => {
        for (const n of simNodes) posRef.current[n.key] = { x: n.x, y: n.y };
        if (!fitted.current && sim.alpha() < 0.12) {
          fitted.current = true;
          fitRef.current(true);
        }
        paintRef.current();
      })
      // The layout keeps spreading a little after the first fit; settle the view on the
      // final positions unless the user has taken control of it.
      .on("end", () => !userMoved.current && fitRef.current(true));
    simRef.current = sim;
    if (firstLayout) {
      // d3's full run (alpha decays from 1 to its minimum in 300 ticks), then mark it at rest.
      sim.stop().tick(300).alpha(0);
      for (const n of simNodes) posRef.current[n.key] = { x: n.x, y: n.y };
      fitted.current = true;
      fitRef.current(false);
      paintRef.current();
    } else if (unchanged) {
      sim.alpha(prev.alpha());
      if (sim.alpha() < sim.alphaMin()) sim.stop();
    } else {
      sim.alpha(0.5);
      fitted.current = false;
      userMoved.current = false;
    }
    return () => sim.stop();
  }, [simNodes, simLinks, size.w, size.h]);

  // When floating UI changes the free space (the chip appearing, the key collapsing, the card
  // opening), refit unless the user has taken control of the view. Before the first frame the
  // fit is instant, so the first open never animates.
  const painted = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => (painted.current = true));
    return () => cancelAnimationFrame(id);
  }, []);
  const { top = 0, right = 0, bottom = 0, left = 0, corner } = insets || {};
  useLayoutEffect(() => {
    if (layoutKey.current && !userMoved.current) fitRef.current(painted.current);
  }, [top, right, bottom, left, corner?.w, corner?.h]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.4),
    zoomOut: () => select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1 / 1.4),
    fit: () => fitRef.current(true),
  }));

  // Node dragging (pointer events, so it works on touch too).
  const drag = useRef(null);
  const toGraph = (ev) => {
    const pt = svgRef.current.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    return pt.matrixTransform(gRef.current.getScreenCTM().inverse());
  };
  const onPointerDown = (ev, n) => {
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { n, moved: false };
    userMoved.current = true;
    simRef.current.alphaTarget(0.25).restart();
  };
  const onPointerMove = (ev) => {
    if (!drag.current) return;
    const p = toGraph(ev);
    drag.current.n.fx = p.x;
    drag.current.n.fy = p.y;
    drag.current.moved = true;
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { n, moved } = drag.current;
    simRef.current.alphaTarget(0);
    n.fx = null;
    n.fy = null;
    if (!moved) onSelect({ kind: "node", key: n.key });
    drag.current = null;
  };

  const impactMode = impacts && Object.keys(impacts).length > 0;
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of edges) {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    }
    return s;
  }, [focus, edges]);

  // Edge lines are drawn under the nodes and their labels above them, so a callout is never
  // hidden behind a company.
  const edgeLines = [];
  const edgeLabels = [];
  for (const e of simLinks) {
    const s = byKey[e.source], t = byKey[e.target];
    if (s?.x == null || t?.x == null) continue;
    const { d, mx, my } = edgeArc(e, s, t);
    const meta = EDGE_TYPES[e.type] || EDGE_TYPES.partnership;
    const hit = impactMode && edgesHit?.has(e.key);
    const isSel = selected?.kind === "edge" && selected.key === e.key;
    const isHover = hoverEdge === e.key;
    const inFocus = !focusSet || (focusSet.has(e.source) && focusSet.has(e.target) && (e.source === focus || e.target === focus));
    const dim = (impactMode && !hit) || (!impactMode && focusSet && !inFocus);
    const w = edgeWidth(e) * 0.85;
    const touchesFocus = focus && (e.source === focus || e.target === focus);
    // Callouts show just the deal size; the full description appears on hover or selection.
    const callout = (showLabels && !dim && e.amount_usd >= (touchesFocus ? 5e9 : 4e10)) || (hit && e.amount_usd >= 5e9);
    const fullLabel = (isHover || isSel) && e.label;
    const text = e.label?.length > 44 ? e.label.slice(0, 42) + "…" : e.label;
    edgeLines.push(
      <g
        key={e.key}
        ref={(el) => {
          if (el) edgeEls.current.set(e.key, el);
          else edgeEls.current.delete(e.key);
        }}
        opacity={dim && !isHover && !isSel ? 0.1 : 1}
        className="cursor-pointer"
        onMouseEnter={() => setHoverEdge(e.key)}
        onMouseLeave={() => setHoverEdge(null)}
        onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "edge", key: e.key }); }}
      >
        <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, w + 8)} />
        <path
          d={d}
          fill="none"
          stroke={hit ? c.risk : meta.color}
          strokeWidth={hit ? w + 1 : isSel || isHover ? w + 1.2 : w}
          strokeDasharray={meta.dashed ? "4 4" : hit ? "10 6" : undefined}
          className={hit ? "flow" : undefined}
          markerEnd={e.type === "competitor" ? undefined : `url(#arrow-${hit ? "hit" : e.type})`}
          strokeLinecap="round"
          opacity={hit || isSel || isHover || touchesFocus ? 1 : 0.7}
        />
      </g>,
    );
    if (fullLabel || callout) {
      edgeLabels.push(
        <g
          key={e.key}
          ref={(el) => {
            if (el) labelEls.current.set(e.key, el);
            else labelEls.current.delete(e.key);
          }}
          transform={`translate(${mx},${my})`}
        >
          <text x={0} y={0} dy={3} textAnchor="middle" className="edge-label" fontSize={10} fill={hit ? c.riskText : c.label2}>
            {e.amount_usd && (
              <tspan fontWeight={600} fill={hit ? c.riskText : c.label}>
                {fmtUsd(e.amount_usd)}
              </tspan>
            )}
            {fullLabel && `${e.amount_usd ? " · " : ""}${text}`}
            {isHover && !isSel && (
              <tspan x={0} dy={13} fontSize={9.5}>
                {[e.date, "Click for details"].filter(Boolean).join(" · ")}
              </tspan>
            )}
          </text>
        </g>,
      );
    }
  }

  const types = Object.keys(EDGE_TYPES);

  return (
    <svg ref={svgRef} width={size.w} height={size.h} className="block select-none touch-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={(e) => e.target === svgRef.current && onSelect(null)}>
      <defs>
        {types.map((t) => (
          <marker key={t} id={`arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,1.5 L9,5 L0,8.5 z" fill={EDGE_TYPES[t].color} />
          </marker>
        ))}
        <marker id="arrow-hit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0,1.5 L9,5 L0,8.5 z" fill={c.risk} />
        </marker>
        <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="2.2" floodColor="#000" floodOpacity={c.shadow} />
        </filter>
      </defs>
      <g ref={gRef}>
        {edgeLines}
        {/* Nodes */}
        {simNodes.map((n) => {
          const imp = impacts?.[n.key];
          const isHolding = holdingSet.has(n.key);
          const isSel = selected?.kind === "node" && selected.key === n.key;
          const isFocus = n.key === focus;
          const dim = (impactMode && !imp) || (!impactMode && focusSet && !focusSet.has(n.key));
          const fill = impactFill(imp, c);
          const inside = n.r > 22;
          const fold = folds[n.key];
          const foldText = fold?.open ? "−" : fold ? `+${fold.count}` : "";
          const foldWidth = foldText.length * 5.5 + 8;
          const foldX = n.r * 0.7;
          const foldY = -n.r * 0.7;
          return (
            <g
              key={n.key}
              ref={(el) => {
                if (el) nodeEls.current.set(n.key, el);
                else nodeEls.current.delete(n.key);
              }}
              data-node
              transform={`translate(${n.x},${n.y})`}
              opacity={dim && !isSel ? 0.3 : 1}
              className="cursor-pointer"
              onPointerDown={(ev) => onPointerDown(ev, n)}
            >
              {imp?.origin && !imp.mark && <circle r={n.r + 6} fill="none" stroke={c.risk} strokeWidth={2} className="pulse" />}
              {isSel && <circle r={n.r + 6} fill={c.select} opacity={0.18} />}
              <circle
                r={n.r}
                fill={fill}
                filter={simNodes.length <= 150 ? "url(#node-shadow)" : undefined}
                stroke={isSel ? c.select : isHolding ? c.holding : isFocus ? c.label : c.nodeStroke}
                strokeWidth={isSel ? 2.5 : isHolding ? 2.25 : isFocus ? 2 : 1}
              />
              {isHolding && (
                <text y={-n.r - 5} textAnchor="middle" fontSize={10} fill={c.holding}>★</text>
              )}
              <text
                textAnchor="middle"
                y={inside ? -2 : n.r + 13}
                fontSize={n.r > 30 ? 12.5 : 11}
                fontWeight={inside || isFocus ? 600 : 500}
                className="node-label"
                style={inside ? { stroke: fill } : undefined}
                fill={c.label}
              >
                {shortName(n.name)}
              </text>
              {n.value_usd && inside && (
                <text textAnchor="middle" y={12} fontSize={10.5} fontWeight={500} className="node-label" style={{ stroke: fill }} fill={c.label} fillOpacity={0.6}>{fmtUsd(n.value_usd)}</text>
              )}
              {imp && !imp.origin && !imp.mark && (
                <text textAnchor="middle" y={inside ? n.r + 13 : n.r + 26} fontSize={10.5} fontWeight={700} className="node-label" fill={imp.sign < 0 ? c.riskText : c.gainText}>
                  {imp.sign < 0 ? "−" : "+"}{Math.round(imp.value * 100)}
                </text>
              )}
              {fold && (
                <g
                  className="cursor-pointer"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => { ev.stopPropagation(); onToggleFold?.(n.key); }}
                >
                  <title>{fold.open ? `Fold ${fold.count} connections` : `Show ${fold.count} more connections`}</title>
                  <rect x={foldX - foldWidth / 2} y={foldY - 7} width={foldWidth} height={14} rx={7} fill={c.select} />
                  <text x={foldX} y={foldY} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fontWeight={600} fill="#fff">{foldText}</text>
                </g>
              )}
            </g>
          );
        })}
        {edgeLabels}
      </g>
    </svg>
  );
});

export default GraphView;
