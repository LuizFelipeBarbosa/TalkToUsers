import { forwardRef, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDot, Globe, Loader2, Repeat, Search, X, Zap } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SuggestionList, matchCompanies, useListNav } from "@/components/Suggestions";

const MODES = [
  { value: "map", label: "Map" },
  { value: "whatif", label: "What if" },
];

const PLACEHOLDER = {
  map: "Search companies",
  whatif: "Describe an event…",
};

/**
 * Floating search capsule. In Map mode it finds companies (instantly if already on the map,
 * otherwise through a web lookup); in What-if mode it runs a scenario. Lookup progress and
 * the active scenario or highlight show underneath instead of in banners across the page.
 * `chipAction` labels the button that clears a highlight; scenarios clear with a plain ✕.
 */
const CommandBar = forwardRef(function CommandBar(
  { companies, examples, lookup, onDismissLookup, scenarioBusy, chip, chipAction, onClearChip, onPickCompany, onLookup, onRunScenario, className = "", style },
  inputRef,
) {
  const [mode, setMode] = useState("map");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const q = query.trim();

  const items =
    mode === "map"
      ? q
        ? [
            ...matchCompanies(companies, q).map((c) => ({ id: c.key, label: c.name, detail: c.sector, icon: CircleDot })),
            { id: "__web", label: `Search the web for “${q}”`, icon: Globe },
          ]
        : []
      : q
        ? []
        : examples.map((ex) => ({ id: ex, label: ex, icon: Zap, event: ex }));

  const finish = () => {
    setQuery("");
    inputRef.current?.blur();
  };
  const pick = (item) => {
    if (item.event) onRunScenario(item.event);
    else if (item.id === "__web") onLookup(q);
    else onPickCompany(item.id);
    finish();
  };
  const submit = () => {
    if (!q) return;
    if (mode === "whatif") onRunScenario(q);
    else onLookup(q);
    finish();
  };
  // Map mode preselects the best match so Enter jumps to it; What-if mode runs the typed text.
  const nav = useListNav(items, { onPick: pick, onSubmit: submit, initial: mode === "map" ? 0 : -1 });

  // A finished lookup reports briefly, then gets out of the way. Errors stay until dismissed.
  useEffect(() => {
    if (!lookup?.done) return;
    const t = setTimeout(onDismissLookup, 4000);
    return () => clearTimeout(t);
  }, [lookup, onDismissLookup]);

  const lookupBusy = !!lookup && !lookup.done && !lookup.error;
  const busy = lookupBusy || scenarioBusy;
  const showList = focused && items.length > 0;

  return (
    <div className={className} style={style}>
      <div className="glass overflow-hidden rounded-2xl">
        <div className="flex h-12 items-center gap-2 pl-2 pr-2">
          <SegmentedControl
            size="sm"
            ariaLabel="Search mode"
            options={MODES}
            value={mode}
            onChange={(m) => {
              setMode(m);
              nav.setActive(m === "map" ? 0 : -1);
              inputRef.current?.focus();
            }}
            className="w-[124px] shrink-0"
          />
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {mode === "map" ? <Search className="h-4 w-4 shrink-0 text-label-2" /> : <Zap className="h-4 w-4 shrink-0 text-risk" />}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                nav.reset();
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  query ? setQuery("") : inputRef.current?.blur();
                  return;
                }
                nav.onKeyDown(e);
              }}
              placeholder={PLACEHOLDER[mode]}
              aria-label={mode === "map" ? "Search companies" : "Describe a what-if event"}
              className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-label-3"
            />
          </div>
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-label-2" />
          ) : query ? (
            <button aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery("")} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-label-3/60 text-surface">
              <X className="h-3 w-3" strokeWidth={3} />
            </button>
          ) : (
            !focused && <kbd className="hidden shrink-0 rounded-md border border-separator/20 px-1.5 py-0.5 font-sans text-[11px] text-label-3 md:block [@media(pointer:coarse)]:hidden">⌘K</kbd>
          )}
        </div>

        {showList && (
          <div className="border-t border-separator/[0.12]">
            <SuggestionList items={items} active={nav.active} onHover={nav.setActive} onPick={pick} />
          </div>
        )}

        {lookup && !showList && <LookupStatus lookup={lookup} onDismiss={onDismissLookup} />}
      </div>

      {chip && (
        <div className="glass fade-in mt-2 inline-flex h-8 max-w-full items-center gap-2 rounded-full pl-3 pr-1 text-[12.5px]">
          {chipAction ? <Repeat className="h-3.5 w-3.5 shrink-0 text-risk" /> : <Zap className="h-3.5 w-3.5 shrink-0 text-risk" />}
          <span className="truncate font-medium">{chip}</span>
          {chipAction ? (
            <button onClick={onClearChip} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-fill/[0.14] px-2.5 font-medium text-accent hover:bg-fill/[0.22]">
              {chipAction}
            </button>
          ) : (
            <button aria-label="Clear scenario" onClick={onClearChip} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill/20 hover:text-label">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function LookupStatus({ lookup, onDismiss }) {
  const { name, step, done, error, result, count } = lookup;
  let icon, text;
  if (error) {
    icon = <AlertCircle className="h-4 w-4 shrink-0 text-risk" />;
    text = `Couldn't map ${name}: ${error}`;
  } else if (done) {
    const extra = result?.cached ? " (earlier lookup)" : result?.added != null ? `, ${result.added} new from the web` : "";
    icon = <CheckCircle2 className="h-4 w-4 shrink-0 text-gain" />;
    text = `Mapped ${name} · ${count} relationships${extra}`;
  } else {
    icon = <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />;
    text = `Mapping ${name} · ${step}…`;
  }
  return (
    <div className="fade-in flex items-start gap-2 border-t border-separator/[0.12] px-3 py-2.5 text-[12.5px] leading-snug">
      {icon}
      <span className={`min-w-0 flex-1 ${error ? "text-risk" : "text-label-2"}`}>{text}</span>
      {(done || error) && (
        <button aria-label="Dismiss" onClick={onDismiss} className="-my-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-label-3 hover:text-label">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export default CommandBar;
