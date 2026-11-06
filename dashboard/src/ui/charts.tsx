import { useMemo, useRef, useState } from "react";

// Small SVG charts: one y-axis, 2px lines, recessive grid, crosshair + tooltip on hover,
// a legend that always shows each series' current value (text in ink, not series color).

export interface Series {
  name: string;
  color: string;
  values: number[];
}

const W = 640;
const PAD = { l: 44, r: 12, t: 10, b: 22 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

function useHover(n: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setI(Math.max(0, Math.min(n - 1, idx)));
  };
  return { ref, i, onMove, onLeave: () => setI(null) };
}

export function Legend({ series, format }: { series: Series[]; format: (v: number) => string }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5 text-gray-700">
          <span className="h-2 w-3 rounded-sm" style={{ background: s.color }} />
          {s.name}
          <span className="font-semibold tabular text-gray-900">{format(s.values.at(-1) ?? 0)}</span>
        </span>
      ))}
    </div>
  );
}

export function LineChart({
  series,
  height = 180,
  format = (v) => Math.round(v).toLocaleString("en-IN"),
  max,
  times,
}: {
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  max?: number;
  times: number[];
}) {
  const n = Math.max(2, times.length);
  const top = max ?? niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - Math.min(v, top) / top) * (height - PAD.t - PAD.b);
  const h = useHover(n);
  return (
    <div className="relative">
      <svg ref={h.ref} viewBox={`0 0 ${W} ${height}`} className="w-full" onMouseMove={h.onMove} onMouseLeave={h.onLeave} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(top * f)} y2={y(top * f)} stroke="rgb(var(--gray-200))" strokeDasharray={f === 0 ? "" : "2 4"} />
            <text x={PAD.l - 6} y={y(top * f) + 4} textAnchor="end" className="fill-gray-400 text-[10px]">
              {format(top * f)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <path
            key={s.name}
            d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i + n - s.values.length).toFixed(1)},${y(v).toFixed(1)}`).join("")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {h.i !== null && <Crosshair x={x(h.i)} height={height} series={series} y={y} i={h.i} n={n} />}
      </svg>
      {h.i !== null && <Tooltip i={h.i} n={n} series={series} format={format} times={times} />}
    </div>
  );
}

export function StackedArea({ series, height = 200, times, format = (v) => Math.round(v).toLocaleString("en-IN") }: { series: Series[]; height?: number; times: number[]; format?: (v: number) => string }) {
  const n = Math.max(2, times.length);
  const stacks = useMemo(() => {
    const acc = new Array(n).fill(0);
    return series.map((s) => {
      const lo = [...acc];
      s.values.forEach((v, i) => (acc[i + n - s.values.length] += v));
      return { s, lo, hi: [...acc] };
    });
  }, [series, n]);
  const top = niceMax(Math.max(1, ...(stacks.at(-1)?.hi ?? [1])));
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / top) * (height - PAD.t - PAD.b);
  const h = useHover(n);
  return (
    <div className="relative">
      <svg ref={h.ref} viewBox={`0 0 ${W} ${height}`} className="w-full" onMouseMove={h.onMove} onMouseLeave={h.onLeave} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(top * f)} y2={y(top * f)} stroke="rgb(var(--gray-200))" strokeDasharray={f === 0 ? "" : "2 4"} />
            <text x={PAD.l - 6} y={y(top * f) + 4} textAnchor="end" className="fill-gray-400 text-[10px]">
              {format(top * f)}
            </text>
          </g>
        ))}
        {stacks.map(({ s, lo, hi }) => (
          <path
            key={s.name}
            d={
              hi.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") +
              lo.map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(lo[n - 1 - i]!).toFixed(1)}`).join("") +
              "Z"
            }
            fill={s.color}
            fillOpacity={0.85}
            stroke="white"
            strokeWidth={2}
          />
        ))}
        {h.i !== null && <line x1={x(h.i)} x2={x(h.i)} y1={PAD.t} y2={height - PAD.b} stroke="rgb(var(--gray-900))" strokeWidth={1} />}
      </svg>
      {h.i !== null && <Tooltip i={h.i} n={n} series={series} format={format} times={times} />}
    </div>
  );
}

function Crosshair({ x, height, series, y, i, n }: { x: number; height: number; series: Series[]; y: (v: number) => number; i: number; n: number }) {
  return (
    <g>
      <line x1={x} x2={x} y1={PAD.t} y2={height - PAD.b} stroke="rgb(var(--gray-900))" strokeWidth={1} />
      {series.map((s) => {
        const v = s.values[i - (n - s.values.length)];
        return v === undefined ? null : <circle key={s.name} cx={x} cy={y(v)} r={4.5} fill={s.color} stroke="white" strokeWidth={2} />;
      })}
    </g>
  );
}

function Tooltip({ i, n, series, format, times }: { i: number; n: number; series: Series[]; format: (v: number) => string; times: number[] }) {
  const left = `${Math.min(80, Math.max(2, (i / (n - 1)) * 100))}%`;
  const t = times[i];
  return (
    <div className="pointer-events-none absolute top-1 z-10 min-w-36 -translate-x-1/2 rounded-xl bg-gray-900 px-3 py-2 text-xs text-gray-0 shadow-lifted" style={{ left }}>
      {t && <div className="mb-1 text-gray-400">{new Date(t).toLocaleTimeString("en-IN", { hour12: false })}</div>}
      {series.map((s) => (
        <div key={s.name} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
          <span className="font-semibold tabular">{format(s.values[i - (n - s.values.length)] ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

export function Spark({ values, color = "rgb(var(--gray-900))", height = 28 }: { values: number[]; color?: string; height?: number }) {
  const n = Math.max(2, values.length);
  const top = Math.max(1, ...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (n - 1)) * 100).toFixed(2)},${(height - 2 - (v / top) * (height - 4)).toFixed(2)}`).join("");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-7 w-full">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
