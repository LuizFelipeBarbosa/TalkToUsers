import { fmtUsd } from "@/lib/graph";
import { Row, Section } from "@/components/ui/list";
import { EmptyState, TypeDot, loopPath, shortName } from "./common";

// `activeId` is the id of the highlight currently drawn on the map; tapping that row again clears it.
export default function Risks({ cycles, shared, byKey, holdings, activeId, onShowCycle, onShowShared, onSelectEdge, onClear }) {
  const name = (k) => shortName(byKey[k]?.name);
  const total = (c) => c.reduce((s, e) => s + (e.amount_usd || 0), 0);
  return (
    <div className="space-y-5">
      <Section title={`Circular financing · ${cycles.length}`} footer="Money invested in a company that comes back as that company's purchases. Revenue in these loops is less independent than it looks.">
        {cycles.length === 0 && <EmptyState>No loops found on the map.</EmptyState>}
        {cycles.map((c, i) => {
          const id = `cycle-${i}`;
          const active = activeId === id;
          const disclosed = total(c);
          return (
            <Row
              key={id}
              title={loopPath(c, byKey)}
              subtitle={`${c.length} companies${disclosed ? ` · ${fmtUsd(disclosed)} disclosed` : ""}`}
              chevron={active ? "open" : true}
              active={active}
              onClick={() => (active ? onClear() : onShowCycle(c, i))}
            >
              {active && (
                <ol className="fade-in px-1.5 pb-1.5 text-[12px] leading-snug">
                  {c.map((e) => (
                    <li key={e.key}>
                      <button
                        className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-fill/[0.1]"
                        onClick={(ev) => {
                          ev.stopPropagation(); // the row itself toggles the loop
                          onSelectEdge(e.key);
                        }}
                      >
                        <TypeDot type={e.type} />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">
                            {name(e.source)} → {name(e.target)}
                          </span>
                          <span className="text-label-2">: {e.label}</span>
                        </span>
                        <span className={`shrink-0 tabular-nums ${e.amount_usd ? "font-semibold" : "text-label-2"}`}>{e.amount_usd ? fmtUsd(e.amount_usd) : "undisclosed"}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Row>
          );
        })}
      </Section>

      <Section title={`Concentration · ${shared.length}`} footer="Companies several of your holdings depend on, directly or one step removed. A risk you can't see in a spreadsheet.">
        {shared.length === 0 && <EmptyState>No shared dependencies across your portfolio.</EmptyState>}
        {shared.map((s) => {
          const id = `shared-${s.company}`;
          const active = activeId === id;
          const direct = s.holdings.filter((h) => h.hops === 1).map((h) => name(h.company));
          const indirect = s.holdings.filter((h) => h.hops === 2).map((h) => name(h.company));
          return (
            <Row
              key={id}
              title={`${s.holdings.length} of ${holdings.length} holdings depend on ${name(s.company)}`}
              subtitle={!active && [...direct, ...indirect].join(", ")}
              chevron={active ? "open" : true}
              active={active}
              onClick={() => (active ? onClear() : onShowShared(s, id))}
            >
              {active && (
                <div className="fade-in space-y-0.5 px-3 pb-2.5 text-[12px] leading-snug">
                  {direct.length > 0 && (
                    <p>
                      <span className="font-medium text-warn">Directly:</span> {direct.join(", ")}
                    </p>
                  )}
                  {indirect.length > 0 && (
                    <p className="text-label-2">
                      <span className="font-medium">Via another company:</span> {indirect.join(", ")}
                    </p>
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
