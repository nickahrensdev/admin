import { useEffect, useMemo, useRef, useState } from 'react';

export interface ColumnDatum {
  /** Short label under the axis (shown selectively when crowded). */
  label: string;
  value: number;
  /** Full text for the tooltip and table. */
  title: string;
}

interface Props {
  data: ColumnDatum[];
  /** Formats axis ticks and tooltips. */
  format(value: number): string;
  /** Column header for the value in the table view. */
  valueLabel: string;
  height?: number;
  /** Fixed top of the axis (e.g. 100 for percentages). */
  max?: number;
}

/** "Nice" tick step: 1, 2 or 5 × 10^n. */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Single-series column chart: one hue, thin columns with rounded tops from a
 * shared baseline, hairline grid, hover tooltip, and a table view.
 */
export default function ColumnChart({ data, format, valueLabel, height = 220, max }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real width so text stays readable instead of scaling with the SVG.
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const pad = { top: 12, right: 8, bottom: 26, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const { ticks, top } = useMemo(() => {
    const peak = max ?? Math.max(0, ...data.map((d) => d.value));
    const step = niceStep(peak || 1, 4);
    const t = max ?? Math.max(step, Math.ceil(peak / step) * step);
    const list: number[] = [];
    for (let v = 0; v <= t + 1e-9; v += step) list.push(v);
    return { ticks: list, top: t };
  }, [data, max]);

  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => pad.top + plotH - (Math.max(0, v) / (top || 1)) * plotH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(plotW / 48))));

  const bar = (i: number, v: number) => {
    const x = pad.left + i * band + (band - barW) / 2;
    const y0 = pad.top + plotH;
    const y1 = y(v);
    const h = y0 - y1;
    if (h <= 0) return null;
    const r = Math.min(4, barW / 2, h);
    return `M${x},${y0} L${x},${y1 + r} Q${x},${y1} ${x + r},${y1} L${x + barW - r},${y1} Q${x + barW},${y1} ${x + barW},${y1 + r} L${x + barW},${y0} Z`;
  };

  const hovered = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? ((pad.left + hover * band + band / 2) / W) * 100 : 0;

  return (
    <div className="column-chart" ref={wrap}>
 <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${valueLabel} chart`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="cc-grid" />
            <text x={pad.left - 8} y={y(t)} className="cc-tick" textAnchor="end" dominantBaseline="middle">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const path = bar(i, d.value);
          return (
            <g key={i}>
              {path && <path d={path} className={`cc-bar${hover === i ? ' is-hover' : ''}`} />}
              {i % labelEvery === 0 && (
                <text x={pad.left + i * band + band / 2} y={H - 8} className="cc-tick" textAnchor="middle">{d.label}</text>
              )}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.title}: ${format(d.value)}`}
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="cc-tip" style={{ left: `${Math.min(85, Math.max(15, tipLeft))}%` }} role="status">
          <span className="muted">{hovered.title}</span>
          <strong>{format(hovered.value)}</strong>
        </div>
      )}
      <details className="cc-table">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th></th><th className="num">{valueLabel}</th></tr></thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}><td>{d.title}</td><td className="num">{format(d.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
