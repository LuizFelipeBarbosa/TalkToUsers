import { useState } from "react";
import { ChevronRight, Repeat } from "lucide-react";
import { fmtUsd } from "@/lib/graph";
import { Section, Row } from "@/components/ui/list";
import { EmptyState, TypeDot, shortName } from "./common";

const ROUTES_SHOWN = 3;

/**
 * Every money loop on the map, one row per investment whose money comes back to the investor.
 * Opening a row draws all its routes back; a route draws only that loop. `activeId` is the
 * highlight drawn on the map: "loop:<investment key>" or "loop:<investment key>:<route index>".
 */
export default function Loops({ groups, byKey, holdingKeys, activeId, onShowLoop, onSelectEdge, onClear }) {
  const [allRoutesOf, setAllRoutesOf] = useState(null); // group whose routes are all listed
  const name = (k) => shortName(byKey[k]?.name);

  return (
    <div className="space-y-3">
      <p className="px-1 text-[12px] leading-snug text-label-2">
        Money invested in a company that comes back as that company's purchases, so the revenue is less independent than it looks. Found automatically from every deal on the map.
      </p>
      <Section title={`Money loops · ${groups.length}`}>
        {groups.length === 0 && <EmptyState>No loops found on the map.</EmptyState>}
        {groups.map((g) => {
          const id = `loop:${g.id}`;
          const open = activeId === id || !!activeId?.startsWith(`${id}:`);
          const { source, target } = g.investment;
          const activeRoute = open && activeId !== id ? Number(activeId.slice(id.length + 1)) : null;
          // Routes come shortest first, so deals paid straight back lead and the rest go via other companies.
          const directCount = g.routes.filter((r) => r.length === 2).length;
          const viaRoutes = g.routes.slice(directCount);
          const routes = allRoutesOf === g.id || activeRoute - directCount >= ROUTES_SHOWN ? viaRoutes : viaRoutes.slice(0, ROUTES_SHOWN);
          const hiddenRoutes = viaRoutes.length - routes.length;
          return (
            <Row
              key={g.id}
              title={`${name(source)} → ${name(target)}`}
              subtitle={summary(g, name, holdingKeys)}
              chevron={open ? "open" : true}
              active={open}
              onClick={() => (open ? onClear() : onShowLoop(g))}
            >
              {open && (
                <div className="fade-in space-y-0.5 px-1.5 pb-2 text-[12px] leading-snug">
                  <Deal edge={g.investment} name={name} onSelect={onSelectEdge} />
                  {directCount > 0 && (
                    <>
                      <p className="flex items-center gap-1 px-1.5 pt-1 font-semibold text-label-2">
                        <Repeat className="h-3 w-3 shrink-0" />
                        Circular: comes straight back
                      </p>
                      {g.routes.slice(0, directCount).map(([, back]) => (
                        <Deal key={back.key} edge={back} name={name} onSelect={onSelectEdge} />
                      ))}
                    </>
                  )}
                  {routes.map((route, viaIndex) => {
                    const i = directCount + viaIndex;
                    const selected = activeRoute === i;
                    return (
                      <div key={route.map((e) => e.key).join(",")} className={`rounded-lg ${selected ? "bg-accent/[0.1]" : ""}`}>
                        <button
                          aria-expanded={selected}
                          className="flex w-full items-baseline gap-1 rounded-lg px-1.5 py-1 text-left font-semibold text-label-2 hover:text-label"
                          onClick={(ev) => {
                            ev.stopPropagation(); // the row itself toggles the group
                            onShowLoop(g, selected ? undefined : i);
                          }}
                        >
                          <ChevronRight className={`h-3 w-3 shrink-0 self-center transition-transform duration-200 ${selected ? "rotate-90" : ""}`} />
                          {routeName(route, name)}
                        </button>
                        {selected && (
                          <ol className="fade-in pb-1 pl-3">
                            {route.slice(1).map((e) => (
                              <li key={e.key}>
                                <Deal edge={e} name={name} onSelect={onSelectEdge} />
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                  {(hiddenRoutes > 0 || allRoutesOf === g.id) && (
                    <button
                      className="w-full rounded-lg px-1.5 py-1 text-left font-medium text-accent hover:bg-fill/[0.1]"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setAllRoutesOf(allRoutesOf === g.id ? null : g.id);
                      }}
                    >
                      {hiddenRoutes > 0 ? `${hiddenRoutes} more ${hiddenRoutes === 1 ? "way" : "ways"} back` : "Show fewer"}
                    </button>
                  )}
                </div>
              )}
            </Row>
          );
        })}
      </Section>
    </div>
  );
}

// "Invests $100B · comes back 3 ways · ★ CoreWeave"
function summary(group, name, holdingKeys) {
  const { investment, routes } = group;
  const verb = investment.type === "owner" ? "Owns" : "Invests";
  const back = routes.length > 1 ? `comes back ${routes.length} ways` : `comes back ${routeName(routes[0], name).replace(/^Back /, "")}`;
  const companies = new Set(routes.flatMap((r) => r.map((e) => e.source)));
  const held = holdingKeys.filter((k) => companies.has(k)).map(name);
  return [`${verb}${investment.amount_usd ? ` ${fmtUsd(investment.amount_usd)}` : ""}`, back, held.length && `★ ${held.join(", ")}`].filter(Boolean).join(" · ");
}

// The companies the money passes through on its way back to the investor.
function routeName(route, name) {
  if (route.length === 2) return "Back directly";
  return `Back via ${route.slice(1, -1).map((e) => name(e.target)).join(", ")}`;
}

function Deal({ edge, name, onSelect }) {
  return (
    <button
      className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-fill/[0.1]"
      onClick={(ev) => {
        ev.stopPropagation(); // the row itself toggles the group
        onSelect(edge.key);
      }}
    >
      <TypeDot type={edge.type} />
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {name(edge.source)} → {name(edge.target)}
        </span>
        <span className="text-label-2">: {edge.label}</span>
      </span>
      <span className={`shrink-0 tabular-nums ${edge.amount_usd ? "font-semibold" : "text-label-2"}`}>{edge.amount_usd ? fmtUsd(edge.amount_usd) : "undisclosed"}</span>
    </button>
  );
}
