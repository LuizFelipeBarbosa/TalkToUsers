export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-accent' : 'bg-fill/30'}`}
    >
      <span className={`absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-thumb transition-transform duration-200 ease-ios ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}
