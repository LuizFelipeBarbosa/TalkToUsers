// iOS-style segmented control. Segments are equal width so the thumb can slide by index.
// options: [{ value, label, badge? }]
export function SegmentedControl({ options, value, onChange, size = 'md', ariaLabel, className = '' }) {
  const index = options.findIndex((o) => o.value === value);
  const height = size === 'sm' ? 'h-[26px] text-[12px]' : 'h-8 text-[13px]';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative grid rounded-[9px] bg-fill/[0.14] p-[2px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {index >= 0 && (
        <div
          aria-hidden
          className="absolute bottom-[2px] left-[2px] top-[2px] rounded-[7px] bg-surface shadow-thumb transition-transform duration-300 ease-ios dark:bg-label-3"
          style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`relative z-10 flex min-w-0 items-center justify-center gap-1 px-1.5 font-medium transition-colors duration-200 ${height} ${active ? 'text-label' : 'text-label-2 hover:text-label'}`}
          >
            <span className="truncate">{o.label}</span>
            {o.badge > 0 && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title={`${o.badge} found`}>
                <span className="sr-only">({o.badge})</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
