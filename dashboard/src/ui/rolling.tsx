// Odometer-style number: each digit is a 0–9 column that rolls to its value, so live figures
// (requests/s, countdowns, counts) change smoothly instead of flickering. Separators and symbols
// stay put. Digits are keyed from the right, so 99 → 100 rolls the existing digits.

const ROW = "1.15em";

export function Rolling({ value, className = "" }: { value: string | number; className?: string }) {
  const s = typeof value === "number" ? value.toLocaleString("en-IN") : value;
  const chars = [...s];
  return (
    <span className={`inline-flex tabular ${className}`} aria-label={s} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <span key={`d${key}`} aria-hidden className="relative inline-block overflow-hidden" style={{ height: ROW, lineHeight: ROW }}>
            <span className="invisible">0</span>
            <span
              className="absolute inset-x-0 top-0 flex flex-col items-center transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{ transform: `translateY(calc(-${ch} * ${ROW}))` }}
            >
              {DIGITS.map((n) => (
                <span key={n} style={{ height: ROW }}>
                  {n}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`c${key}${ch}`} aria-hidden className="inline-block" style={{ height: ROW, lineHeight: ROW }}>
            {ch === " " ? " " : ch}
          </span>
        );
      })}
    </span>
  );
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
