import { useEffect, useRef, useState } from 'react';

interface Props {
  points: { x: number; y: number }[];
  /** Today's x (dashed marker) and the best x (dot). */
  current: number;
  best: number;
  formatX(x: number): string;
  formatY(y: number): string;
  xLabel: string;
  height?: number;
}

function niceStep(span: number, ticks: number): number {
  const raw = span / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Single-series line: profit across price levels. 2px line, hairline grid with
 * a stronger zero line, crosshair + tooltip on hover/touch, table view.
 */
export default function SweepChart({ points, current, best, formatX, formatY, xLabel, height = 200 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const pad = { top: 14, right: 12, bottom: 30, left: 64 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const step = niceStep(hi - lo || 1, 4);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step || step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);

  const X = (x: number) => pad.left + ((x - x0) / (x1 - x0 || 1)) * plotW;
  const Y = (y: number) => pad.top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const bestPt = points.find((p) => p.x === best);
  const xTicks = [x0, (x0 + x1) / 2 < 1 ? 1 : (x0 + x1) / 2, x1].filter((v, i, a) => a.indexOf(v) === i);

  const pick = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    const x = x0 + ((px - pad.left) / plotW) * (x1 - x0);
    let idx = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(points[idx].x - x)) idx = i;
    });
    setHover(idx);
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="sweep-chart column-chart" ref={wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Monthly profit by ${xLabel.toLowerCase()}. Best at ${formatX(best)}.`}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => pick(e.touches[0].clientX)}
        onTouchMove={(e) => pick(e.touches[0].clientX)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'cc-zero' : 'cc-grid'} />
            <text x={pad.left - 8} y={Y(t)} className="cc-tick" textAnchor="end" dominantBaseline="middle">{formatY(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={X(t)} y={H - 10} className="cc-tick" textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{formatX(t)}</text>
        ))}
        <line x1={X(current)} x2={X(current)} y1={pad.top} y2={pad.top + plotH} className="sweep-now" />
        <text x={X(current) + 4} y={pad.top + 10} className="cc-tick">now</text>
        <path d={path} className="sweep-line" />
        {bestPt && <circle cx={X(bestPt.x)} cy={Y(bestPt.y)} r={5} className="sweep-best" />}
        {h && (
          <>
            <line x1={X(h.x)} x2={X(h.x)} y1={pad.top} y2={pad.top + plotH} className="sweep-cross" />
            <circle cx={X(h.x)} cy={Y(h.y)} r={4} className="sweep-dot" />
          </>
        )}
      </svg>
      {h && (
        <div className="cc-tip" style={{ left: `${Math.min(80, Math.max(20, (X(h.x) / W) * 100))}%` }} role="status">
          <span className="muted">{formatX(h.x)}</span>
          <strong>{formatY(h.y)}</strong>
        </div>
      )}
      <details className="cc-table">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>{xLabel}</th><th className="num">Monthly profit</th></tr></thead>
            <tbody>
              {points.filter((_, i) => i % 2 === 0 || points[i].x === best).map((p) => (
                <tr key={p.x}><td>{formatX(p.x)}{p.x === best ? ' (best)' : ''}</td><td className="num">{formatY(p.y)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
