import { useState } from "react";

// Companies whose name matches the query: prefix matches first, then substring matches.
export function matchCompanies(companies, query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const c of companies) {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) starts.push(c);
    else if (n.includes(q)) contains.push(c);
  }
  // Within each group, the biggest company first ("Nvidia" before "NVIDIA Ventures").
  const byValue = (a, b) => (b.value_usd || 0) - (a.value_usd || 0);
  return [...starts.sort(byValue), ...contains.sort(byValue)].slice(0, limit);
}

// Arrow-key navigation over a suggestion list. Returns the active index and a keydown
// handler for the input; Enter picks the active item, or calls onSubmit when none is active.
export function useListNav(items, { onPick, onSubmit, initial = 0 }) {
  const [active, setActive] = useState(initial);
  const current = Math.min(active, items.length - 1);
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setActive((current + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive(current <= 0 ? items.length - 1 : current - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current >= 0) onPick(items[current]);
      else onSubmit?.();
    }
  };
  return { active: current, setActive, reset: () => setActive(initial), onKeyDown };
}

// items: [{ id, label, detail?, icon? }]
export function SuggestionList({ items, active, onHover, onPick }) {
  if (!items.length) return null;
  return (
    <ul role="listbox" className="py-1">
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <li
            key={item.id}
            role="option"
            aria-selected={i === active}
            // mousedown, not click, so the input keeps focus until the pick is handled
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover(i)}
            className={`mx-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] ${i === active ? "bg-accent text-white" : ""}`}
          >
            {Icon && <Icon className={`h-4 w-4 shrink-0 ${i === active ? "text-white" : "text-label-2"}`} />}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.detail && <span className={`shrink-0 truncate text-[12px] ${i === active ? "text-white/80" : "text-label-2"}`}>{item.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}
