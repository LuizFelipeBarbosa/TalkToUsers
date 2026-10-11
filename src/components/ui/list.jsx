import { ChevronRight } from 'lucide-react';

// Grouped inset list, as in iOS Settings: a quiet header, rows on a filled card, an optional footnote.
export function Section({ title, trailing, footer, children, className = '' }) {
  return (
    <section className={className}>
      {(title || trailing) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
          {title && <h3 className="text-[13px] font-semibold text-label-2">{title}</h3>}
          {trailing}
        </div>
      )}
      <div className="overflow-hidden rounded-xl bg-fill/[0.08]">{children}</div>
      {footer && <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-label-2">{footer}</p>}
    </section>
  );
}

// One row of a Section. Rows separate with an inset hairline; `children` render below the
// main line (used for expanded content).
export function Row({ leading, title, subtitle, trailing, chevron, active, onClick, children, className = '' }) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              onClick(e);
            }
          : undefined
      }
      className={`relative after:absolute after:bottom-0 after:left-3 after:right-0 after:h-px after:bg-separator/[0.12] last:after:hidden ${interactive ? 'cursor-pointer transition-colors hover:bg-fill/[0.08]' : ''} ${active ? 'bg-accent/[0.08]' : ''} ${className}`}
    >
      <div className="flex min-h-[44px] items-center gap-2.5 px-3 py-2">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{title}</div>
          {subtitle && <div className="truncate text-[12px] text-label-2">{subtitle}</div>}
        </div>
        {trailing}
        {chevron && <ChevronRight className={`h-4 w-4 shrink-0 text-label-3 transition-transform duration-200 ${chevron === 'open' ? 'rotate-90' : ''}`} />}
      </div>
      {children}
    </div>
  );
}
