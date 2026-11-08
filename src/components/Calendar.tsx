import { useState } from 'react';
import { isoDate } from '../utils/time';

interface Props {
  /** Selected dates as YYYY-MM-DD. */
  selected: string[];
  onSelect(date: string): void;
  /** Earliest and latest selectable dates (YYYY-MM-DD). */
  min: string;
  max: string;
  /** Dates to show a subtle "repeat" marker on (e.g. generated weekly dates). */
  marked?: string[];
}

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Month calendar; tap days to select. Keyboard: arrows move between days. */
export default function Calendar({ selected, onSelect, min, max, marked = [] }: Props) {
  const first = parse(selected[0] ?? min);
  const [view, setView] = useState(new Date(first.getFullYear(), first.getMonth(), 1));
  const today = isoDate(new Date());

  const minD = parse(min);
  const maxD = parse(max);
  const canPrev = new Date(view.getFullYear(), view.getMonth(), 0) >= minD;
  const canNext = new Date(view.getFullYear(), view.getMonth() + 1, 1) <= maxD;

  const lead = view.getDay();
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => isoDate(new Date(view.getFullYear(), view.getMonth(), i + 1))),
  ];

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, date: string) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const d = parse(date);
    d.setDate(d.getDate() + delta);
    if (d < minD || d > maxD) return;
    if (d.getMonth() !== view.getMonth()) setView(new Date(d.getFullYear(), d.getMonth(), 1));
    requestAnimationFrame(() =>
      (document.querySelector(`[data-date="${isoDate(d)}"]`) as HTMLButtonElement | null)?.focus(),
    );
  };

  return (
    <div className="calendar">
      <div className="cal-head">
        <button type="button" className="icon-btn cal-nav" aria-label="Previous month" disabled={!canPrev}
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
        <span className="cal-title">{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="icon-btn cal-nav" aria-label="Next month" disabled={!canNext}
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="cal-grid" role="grid">
        {WEEK.map((w, i) => (
          <span key={i} className="cal-dow" aria-hidden="true">{w}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`x${i}`} />;
          const d = parse(date);
          const disabled = d < minD || d > maxD;
          const on = selected.includes(date);
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              className={`cal-day${on ? ' on' : ''}${date === today ? ' today' : ''}${marked.includes(date) && !on ? ' marked' : ''}`}
              disabled={disabled}
              aria-pressed={on}
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              onClick={() => onSelect(date)}
              onKeyDown={(e) => onKey(e, date)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
