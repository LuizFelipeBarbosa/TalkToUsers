import { Row, Section } from "@/components/ui/list";
import { EmptyState, shortName } from "./common";

// `activeId` is the id of the highlight currently drawn on the map; tapping that row again clears it.
// Money loops have their own tab (Loops.jsx).
export default function Risks({ shared, byKey, holdings, activeId, onShowShared, onClear }) {
  const name = (k) => shortName(byKey[k]?.name);
  return (
    <div className="space-y-5">
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
