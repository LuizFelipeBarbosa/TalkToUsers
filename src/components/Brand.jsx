// Orbit's mark: companies held together by the money that circles between them, with one
// (red) about to be hit. Same drawing as public/favicon.svg.
export function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="orbit-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6bff" />
          <stop offset="1" stopColor="#6d3df5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#orbit-logo)" />
      <ellipse cx="32" cy="32" rx="23" ry="10" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" transform="rotate(-28 32 32)" />
      <circle cx="32" cy="32" r="9" fill="#fff" />
      <circle cx="51.5" cy="21.6" r="5" fill="#ff5a4e" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

export default function Brand({ className = "" }) {
  return (
    <div className={`glass flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-4 ${className}`}>
      <Logo size={34} />
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-tight tracking-tight">Orbit</div>
        <div className="max-w-[190px] text-[11.5px] leading-snug text-label-2">See who funds whom, and what breaks if one falls</div>
      </div>
    </div>
  );
}
