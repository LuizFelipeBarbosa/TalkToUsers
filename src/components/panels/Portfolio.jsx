import { useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { api } from "@/api/backend";
import { fmtUsd } from "@/lib/graph";
import { Row, Section } from "@/components/ui/list";
import { SuggestionList, matchCompanies, useListNav } from "@/components/Suggestions";

const DEFAULT_STAKE = 2.5e7;

export default function Portfolio({ holdings, byKey, companies, total, onChange, onSelect }) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Fund I</h2>
        <span className="text-[12.5px] text-label-2">
          {holdings.length} holdings · {fmtUsd(total)} invested
        </span>
      </div>
      <Section footer="To add a company that isn't on the map yet, search for it first.">
        {holdings.map((h) => (
          <Row
            key={h.id}
            leading={<Star className="h-3.5 w-3.5 shrink-0 fill-warn text-warn" />}
            title={byKey[h.company]?.name || h.name}
            onClick={() => onSelect(h.company)}
            trailing={
              <>
                <StakeField holding={h} onCommit={(stake) => onChange(() => api.updateHolding(h.id, { stake_usd: stake }))} />
                <button
                  aria-label={`Remove ${h.name}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-label-3 hover:bg-risk/10 hover:text-risk"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(() => api.removeHolding(h.id));
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            }
          />
        ))}
        <AddHolding
          options={companies.filter((c) => !holdings.some((h) => h.company === c.key) && c.kind !== "investor")}
          onAdd={(c) => onChange(() => api.addHolding(c.key, c.name, DEFAULT_STAKE))}
        />
      </Section>
    </div>
  );
}

// Stake in $M, edited in place and saved on blur or Enter.
function StakeField({ holding, onCommit }) {
  return (
    <label className="flex h-7 items-center rounded-md bg-fill/[0.12] px-2 text-[13px] tabular-nums" onClick={(e) => e.stopPropagation()}>
      <span className="text-label-2">$</span>
      <input
        type="number"
        min={0}
        step={1}
        defaultValue={(holding.stake_usd || 0) / 1e6}
        aria-label={`Stake in ${holding.name}, millions of dollars`}
        onBlur={(e) => onCommit(+e.target.value * 1e6)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-9 bg-transparent text-right outline-none"
      />
      <span className="text-label-2">M</span>
    </label>
  );
}

function AddHolding({ options, onAdd }) {
  const [query, setQuery] = useState("");
  const items = matchCompanies(options, query, 5).map((c) => ({ id: c.key, label: c.name, detail: c.sector, company: c }));
  const pick = (item) => {
    onAdd(item.company);
    setQuery("");
  };
  const nav = useListNav(items, { onPick: pick });
  return (
    <div>
      <label className="flex min-h-[44px] items-center gap-2.5 px-3">
        <Plus className="h-4 w-4 shrink-0 text-accent" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            nav.reset();
          }}
          onKeyDown={nav.onKeyDown}
          placeholder="Add a company on the map"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-label-3"
        />
      </label>
      <SuggestionList items={items} active={nav.active} onHover={nav.setActive} onPick={pick} />
    </div>
  );
}
