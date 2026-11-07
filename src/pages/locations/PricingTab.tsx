import { useEffect, useRef, useState } from 'react';
import {
  RESOURCE_TYPES,
  getPeak,
  getPrices,
  savePeak,
  savePrices,
  type PeakDay,
  type Price,
} from '../../data/locations';
import SaveBar from '../../components/SaveBar';
import TimeSelect from '../../components/TimeSelect';
import Toggle from '../../components/Toggle';
import { WEEKDAYS, formatMoney } from '../../utils/time';
import { useEditable } from '../../utils/useEditable';

export default function PricingTab({ locationId }: { locationId: string }) {
  return (
    <div className="stack">
      <PricesSection locationId={locationId} />
      <PeakSection locationId={locationId} />
    </div>
  );
}

/** Dollar input that keeps what the user types until it's a valid amount. */
function MoneyInput({ cents, onChange, label, optional }: { cents: number | null; onChange(c: number | null): void; label: string; optional?: boolean }) {
  const fmt = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2));
  const [text, setText] = useState(fmt(cents));
  const ref = useRef<HTMLInputElement>(null);
  // Pick up outside changes (Discard, reload) unless the user is typing here.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(fmt(cents));
  }, [cents]);
  return (
    <span className="money-input">
      <span aria-hidden="true">$</span>
      <input
        ref={ref}
        inputMode="decimal"
        aria-label={label}
        value={text}
        placeholder={optional ? 'Same' : '0.00'}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, '');
          setText(v);
          if (v === '' && optional) onChange(null);
          else if (/^\d+(\.\d{0,2})?$/.test(v)) onChange(Math.round(parseFloat(v) * 100));
        }}
        onBlur={() => setText(fmt(cents))}
      />
    </span>
  );
}

function PricesSection({ locationId }: { locationId: string }) {
  const ed = useEditable<Price[]>(() => getPrices(locationId), (v) => savePrices(locationId, v), [locationId]);
  if (ed.loading || !ed.value) return <div className="page-loading">Loading…</div>;

  const setPrice = (type: Price['resource_type'], patch: Partial<Price>) =>
    ed.setValue((prev) => prev.map((p) => (p.resource_type === type ? { ...p, ...patch } : p)));

  return (
    <div className="card stack">
      <div>
        <h2>Prices</h2>
        <p className="muted small">Per 30 minutes, per cage or turf. Leave peak empty to charge the regular price all day.</p>
      </div>
      <div className="price-table">
        <div className="price-row price-head">
          <span />
          <span>Regular</span>
          <span>Peak</span>
        </div>
        {ed.value.map((p) => {
          const label = RESOURCE_TYPES.find((t) => t.value === p.resource_type)?.label ?? p.resource_type;
          return (
            <div key={p.resource_type} className="price-row">
              <span className="price-name">
                {label}
                <span className="muted small">
                  {formatMoney(p.base_cents * 2)}/hr{p.peak_cents !== null && ` · ${formatMoney(p.peak_cents * 2)}/hr peak`}
                </span>
              </span>
              <MoneyInput label={`${label} regular price per 30 minutes`} cents={p.base_cents} onChange={(c) => setPrice(p.resource_type, { base_cents: c ?? 0 })} />
              <MoneyInput label={`${label} peak price per 30 minutes`} cents={p.peak_cents} optional onChange={(c) => setPrice(p.resource_type, { peak_cents: c })} />
            </div>
          );
        })}
      </div>
      <SaveBar dirty={ed.dirty} saving={ed.saving} onSave={ed.save} onReset={ed.reset} error={ed.error} saved={ed.saved} />
    </div>
  );
}

function PeakSection({ locationId }: { locationId: string }) {
  const ed = useEditable<PeakDay[]>(() => getPeak(locationId), (v) => savePeak(locationId, v), [locationId]);
  if (ed.loading || !ed.value) return <div className="page-loading">Loading…</div>;
  const days = ed.value;

  const setDay = (weekday: number, patch: Partial<PeakDay>) =>
    ed.setValue((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));

  const applyToAll = () => {
    const mon = days.find((d) => d.weekday === 1)!;
    ed.setValue((prev) => prev.map((d) => ({ ...d, enabled: mon.enabled, starts_at: mon.starts_at, ends_at: mon.ends_at })));
  };

  return (
    <div className="card stack">
      <div className="section-head">
        <div>
          <h2>Peak hours</h2>
          <p className="muted small">Slots that start in these hours use the peak price.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={applyToAll}>
          Copy Monday to every day
        </button>
      </div>
      <div className="week">
        {WEEKDAYS.map(({ value, long, short }) => {
          const d = days.find((x) => x.weekday === value)!;
          const invalid = d.enabled && d.ends_at <= d.starts_at;
          return (
            <div key={value} className={`day-row${!d.enabled ? ' is-closed' : ''}${invalid ? ' invalid' : ''}`}>
              <span className="day-name">
                <span className="long">{long}</span>
                <span className="short">{short}</span>
              </span>
              <Toggle checked={d.enabled} onChange={(on) => setDay(value, { enabled: on })} label={`${long} peak pricing`} text={d.enabled ? 'Peak' : 'None'} />
              <div className="time-range">
                <TimeSelect label={`${long} peak starts`} value={d.starts_at} disabled={!d.enabled} onChange={(v) => setDay(value, { starts_at: v })} />
                <span className="muted">to</span>
                <TimeSelect label={`${long} peak ends`} value={d.ends_at} disabled={!d.enabled} onChange={(v) => setDay(value, { ends_at: v })} />
              </div>
            </div>
          );
        })}
      </div>
      <SaveBar dirty={ed.dirty} saving={ed.saving} onSave={ed.save} onReset={ed.reset} error={ed.error} saved={ed.saved} />
    </div>
  );
}
