import { useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter, forceX, forceY } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { EDGE_TYPES, edgeWidth, nodeRadius, fmtUsd } from "@/lib/graph";

function baseLabelSize(n) {
  return n.r > 45 ? 15 : n.r > 30 ? 13 : n.r > 14 ? 11.5 : 9.5;
}

function impactFill(imp) {
  if (!imp) return "#f1f3f5";
  if (imp.mark) return "#ffd8a8";
  const t = Math.min(1, imp.value / 0.7);
  if (imp.sign > 0) return mix("#ebfbee", "#2f9e44", t);
  return mix("#fff0f0", "#e03131", t);
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

export default function GraphView({ nodes, edges, holdings, focus, selected, onSelect, impacts, edgesHit, showLabels }) {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const simRef = useRef(null);
  const posRef = useRef({}); // key -> {x, y}, survives data reloads
  const [, setTick] = useState(0);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [hoverEdge, setHoverEdge] = useState(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [zoomK, setZoomK] = useState(1);
  // Names never shrink below ~9px on screen, however far the map is zoomed out.
  const labelSize = (n) => Math.max(baseLabelSize(n), 9 / Math.max(zoomK, 0.05));
  const holdingSet = useMemo(() => new Set(holdings.map((h) => h.company)), [holdings]);
  // Parents / majority owners get a ring in the owner-edge colour and at least a mid-size circle.
  const ownerList = [...new Set(edges.filter((e) => e.type === "owner").map((e) => e.source))].sort().join("|");
  const ownerSet = useMemo(() => new Set(ownerList.split("|").filter(Boolean)), [ownerList]);

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
          const ang = Math.random() * Math.PI * 2;
          o.x = size.w / 2 + Math.cos(ang) * 200;
          o.y = size.h / 2 + Math.sin(ang) * 200;
        }
        return o;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, ownerSet],
  );
  const byKey = useMemo(() => Object.fromEntries(simNodes.map((n) => [n.key, n])), [simNodes]);
  const simLinks = useMemo(
    () => edges.filter((e) => byKey[e.source] && byKey[e.target]).map((e) => ({ ...e, s: e.source, t: e.target })),
    [edges, byKey],
  );

  useEffect(() => {
    simRef.current?.stop();
    const links = simLinks.map((l) => ({ source: l.s, target: l.t, l }));
    const sim = forceSimulation(simNodes)
      .force("link", forceLink(links).id((d) => d.key).distance((d) => 95 + d.source.r + d.target.r).strength(0.3))
      .force("charge", forceManyBody().strength((d) => -520 - d.r * 14))
      .force("collide", forceCollide().radius((d) => d.r + 30))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("x", forceX(size.w / 2).strength(0.03))
      .force("y", forceY(size.h / 2).strength(0.04))
      .alpha(Object.keys(posRef.current).length ? 0.5 : 1)
      .alphaDecay(0.035)
      .on("tick", () => {
        for (const n of simNodes) posRef.current[n.key] = { x: n.x, y: n.y };
        if (!fitted.current && sim.alpha() < 0.12) {
          fitted.current = true;
          fitView();
        }
        setTick((t) => t + 1);
      })
      // Fit once more when the layout has fully settled, unless the user has panned or zoomed.
      .on("end", () => fitted.current && !userZoomed.current && fitView());
    fitted.current = false;
    userZoomed.current = false;
    // Lay the graph out up front (cheap for a few hundred nodes), so circles appear in place
    // instead of flying around while a scenario's ripple plays; the rest settles gently.
    sim.stop();
    for (let i = 0; i < 300 && sim.alpha() > 0.04; i++) sim.tick();
    for (const n of simNodes) posRef.current[n.key] = { x: n.x, y: n.y };
    if (zoomRef.current) {
      fitted.current = true;
      fitView();
    }
    setTick((t) => t + 1);
    sim.restart();
    simRef.current = sim;
    return () => sim.stop();
  }, [simNodes, simLinks, size.w, size.h]);

  // Pan & zoom.
  const zoomRef = useRef(null);
  useEffect(() => {
    const z = d3zoom()
      .scaleExtent([0.2, 4])
      .filter((ev) => !ev.target.closest?.("[data-node]") && (ev.type !== "wheel" || true))
      .on("zoom", (ev) => {
        if (ev.sourceEvent) userZoomed.current = true;
        setZoomK(Math.round(ev.transform.k * 20) / 20);
        select(gRef.current).attr("transform", ev.transform);
      });
    select(svgRef.current).call(z).on("dblclick.zoom", null);
    zoomRef.current = z;
  }, []);

  // Fit everything into view once the layout settles after a data change.
  const fitted = useRef(false);
  const userZoomed = useRef(false);
  const fitView = () => {
    if (!simNodes.length || !zoomRef.current) return;
    const xs = simNodes.flatMap((n) => [n.x - n.r - 40, n.x + n.r + 40]);
    const ys = simNodes.flatMap((n) => [n.y - n.r - 20, n.y + n.r + 30]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(1.6, 0.94 / Math.max((x1 - x0) / size.w, (y1 - y0) / (size.h - 70)));
    const tr = zoomIdentity.translate(size.w / 2 - (k * (x0 + x1)) / 2, (size.h - 70) / 2 - (k * (y0 + y1)) / 2).scale(k);
    select(svgRef.current).call(zoomRef.current.transform, tr);
  };

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

  // Ripple animation: when a scenario starts, reveal its impact one hop at a time,
  // outward from the company that was hit.
  const [wave, setWave] = useState(Infinity);
  useEffect(() => {
    if (!impactMode) return setWave(Infinity);
    const maxHop = Math.max(0, ...Object.values(impacts).map((i) => i.hops || 0));
    if (!maxHop || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setWave(Infinity);
    setWave(0);
    // The first hop waits a moment so the layout has mostly settled before the wave leaves.
    let h = 0;
    let id;
    const step = () => {
      h += 1;
      setWave(h > maxHop ? Infinity : h);
      if (h <= maxHop) id = setTimeout(step, 900);
    };
    id = setTimeout(step, 600);
    return () => clearTimeout(id);
  }, [impacts, impactMode]);
  const reached = (key) => impacts?.[key] && (impacts[key].hops || 0) <= wave;
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of edges) {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    }
    return s;
  }, [focus, edges]);

  const types = Object.keys(EDGE_TYPES);

  // Deal callouts only on the few biggest deals (around the focus company, if any); the rest on hover.
  const callouts = useMemo(() => {
    const pool = simLinks.filter((e) => e.amount_usd && (!focus || e.source === focus || e.target === focus));
    return new Set(pool.sort((a, b) => b.amount_usd - a.amount_usd).slice(0, 5).map((e) => e.key));
  }, [simLinks, focus]);

  // Every circle gets its name unless it would overlap a bigger company's label
  // (bigger companies claim their space first); hidden names still show on hover.
  const labelled = new Set();
  {
    const boxes = [];
    for (const n of [...simNodes].sort((a, b) => b.r - a.r)) {
      if (n.x == null) continue;
      const fs = labelSize(n);
      const w = Math.min(n.name.length, 28) * fs * 0.56;
      const cy = n.r > 22 ? n.y : n.y + n.r + 10;
      const box = [n.x - w / 2, cy - fs, n.x + w / 2, cy + (n.r > 22 ? fs + 4 : 2)];
      const free = boxes.every((b) => box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]);
      if (free || n.key === focus) {
        boxes.push(box);
        labelled.add(n.key);
      }
    }
  }

  return (
    <svg ref={svgRef} width={size.w} height={size.h} className="block select-none touch-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={(e) => e.target === svgRef.current && onSelect(null)}>
      <defs>
        {types.map((t) => (
          <marker key={t} id={`arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" fill={EDGE_TYPES[t].color} />
          </marker>
        ))}
        <marker id="arrow-hit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" fill="#c92a2a" />
        </marker>
      </defs>
      <g ref={gRef}>
        {/* Edges */}
        {simLinks.map((e) => {
          const s = byKey[e.source], t = byKey[e.target];
          if (s?.x == null || t?.x == null) return null;
          const { d, mx, my } = arcPath(s, t, s.r, t.r, e.type === "competitor" ? 0.08 : 0.2);
          const meta = EDGE_TYPES[e.type] || EDGE_TYPES.partnership;
          const grouped = s.group || t.group;
          const hit = impactMode && edgesHit?.has(e.key) && reached(e.source) && reached(e.target);
          const isSel = selected?.kind === "edge" && selected.key === e.key;
          const inFocus = !focusSet || (focusSet.has(e.source) && focusSet.has(e.target) && (e.source === focus || e.target === focus));
          const linksAffected = impacts?.[e.source] && impacts?.[e.target];
          const dim = !grouped && ((impactMode && !hit && !linksAffected) || (!impactMode && focusSet && !inFocus));
          // In a scenario, other links between affected companies stay as faint context so the shock path stands out.
          const faint = impactMode && !hit && !grouped && linksAffected && !isSel && hoverEdge !== e.key;
          const w = edgeWidth(e);
          const showLabel = (showLabels && !dim && !faint && callouts.has(e.key)) || hoverEdge === e.key || isSel || (hit && e.amount_usd >= 5e9);
          return (
            <g key={e.key} opacity={dim ? 0.12 : faint ? 0.22 : 1} className="cursor-pointer fade" onMouseEnter={() => setHoverEdge(e.key)} onMouseLeave={() => setHoverEdge(null)} onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "edge", key: e.key }); }}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, w + 6)} />
              <path
                d={d}
                fill="none"
                stroke={hit ? "#c92a2a" : meta.color}
                strokeWidth={hit ? w + 1.2 : isSel ? w + 1.5 : faint ? Math.min(w, 1.4) : w}
                strokeDasharray={meta.dashed ? "5 5" : hit ? "10 6" : undefined}
                className={hit ? "flow edge-line" : "edge-line"}
                markerEnd={faint || e.type === "competitor" || e.type === "partnership" ? undefined : `url(#arrow-${hit ? "hit" : e.type})`}
                strokeLinecap="round"
                opacity={0.9}
              />
              {showLabel && e.label && (
                <text x={mx} y={my} textAnchor="middle" className="edge-label" fontSize={10.5} fill={hit ? "#a61e1e" : "#343a40"}>
                  {/* Callouts show just the amount; the full description appears on hover or click. */}
                  {hoverEdge === e.key || isSel || !e.amount_usd
                    ? `${e.amount_usd ? `${fmtUsd(e.amount_usd)} · ` : ""}${e.label.length > 48 ? e.label.slice(0, 46) + "…" : e.label}`
                    : fmtUsd(e.amount_usd)}
                </text>
              )}
            </g>
          );
        })}
        {/* Nodes */}
        {simNodes.map((n) => {
          const rawImp = impacts?.[n.key];
          const imp = rawImp && reached(n.key) ? rawImp : null;
          const isHolding = holdingSet.has(n.key);
          const isSel = selected?.kind === "node" && selected.key === n.key;
          const dim = !n.group && ((impactMode && !rawImp) || (!impactMode && focusSet && !focusSet.has(n.key)));
          const justHit = imp && wave !== Infinity && (imp.hops || 0) === wave;
          const showName = n.group || labelled.has(n.key) || isSel || hoverNode === n.key;
          return (
            <g key={n.key} data-node transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.25 : 1} className="cursor-pointer fade" onPointerDown={(ev) => onPointerDown(ev, n)} onMouseEnter={() => setHoverNode(n.key)} onMouseLeave={() => setHoverNode(null)}>
              {imp?.origin && !imp.mark && <circle r={n.r + 6} fill="none" stroke="#e03131" strokeWidth={2} className="pulse" />}
              {imp?.origin && !imp.mark && wave !== Infinity && <circle key={`wave-${wave}`} r={n.r} fill="none" stroke={imp.sign < 0 ? "#e03131" : "#2f9e44"} strokeWidth={3} className="wave" vectorEffect="non-scaling-stroke" style={{ "--s": (n.r + 150) / n.r }} />}
              {justHit && !imp.origin && <circle key={`burst-${wave}`} r={n.r} fill="none" stroke={imp.sign < 0 ? "#e03131" : "#2f9e44"} strokeWidth={2.5} className="burst" vectorEffect="non-scaling-stroke" />}
              <circle
                r={n.r}
                className="node-circle"
                fill={n.group ? "#ffffff" : impactFill(imp)}
                strokeDasharray={n.group ? "4 3" : undefined}
                stroke={n.group ? "#868e96" : isSel ? "#1c7ed6" : isHolding ? "#f08c00" : n.key === focus ? "#212529" : ownerSet.has(n.key) ? EDGE_TYPES.owner.color : "#ced4da"}
                strokeWidth={isSel ? 3.5 : isHolding ? 3 : n.key === focus ? 2.5 : ownerSet.has(n.key) ? 3 : 1.2}
              />
              {isHolding && (
                <text y={-n.r - 4} textAnchor="middle" fontSize={11} fill="#f08c00">★</text>
              )}
              {showName && (
                <text textAnchor="middle" y={n.r > 22 ? -2 : n.r + 13} fontSize={labelSize(n)} fontWeight={n.r > 22 || n.key === focus ? 700 : 500} className="node-label" fill={n.group ? "#495057" : n.r > 14 || n.key === focus ? "#212529" : "#495057"}>
                  {n.r > 30 ? n.name : n.name.replace(/\s*\(.*\)/, "")}
                </text>
              )}
              {n.value_usd && n.r > 22 && (
                <text textAnchor="middle" y={13} fontSize={11.5} fontWeight={600} className="node-label" fill="#495057">{fmtUsd(n.value_usd)}</text>
              )}
              {imp && !imp.origin && !imp.mark && (
                <text textAnchor="middle" y={n.r > 22 ? 27 : n.r + 26} fontSize={10.5} fontWeight={700} className="node-label" fill={imp.sign < 0 ? "#c92a2a" : "#2b8a3e"}>
                  {imp.sign < 0 ? "−" : "+"}{Math.round(imp.value * 100)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
