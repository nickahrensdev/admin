import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createHold,
  getAvailability,
  releaseHold,
  startCheckout,
  type Availability,
} from '../data/bookings';
import { listLocations, type Location } from '../data/locations';
import { formatMoney, formatTime, isoDate } from '../utils/time';

const LENGTHS = [
  { slots: 1, label: '30 min' },
  { slots: 2, label: '1 hr' },
  { slots: 3, label: '1.5 hr' },
  { slots: 4, label: '2 hr' },
  { slots: 6, label: '3 hr' },
];
const DAYS_AHEAD = 30;

function dayChips() {
  const out: { date: string; top: string; bottom: string }[] = [];
  const now = new Date();
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push({
      date: isoDate(d),
      top: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString(undefined, { weekday: 'short' }),
      bottom: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }
  return out;
}

export default function Book() {
  const [params, setParams] = useSearchParams();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string>('');
  const days = useMemo(dayChips, []);
  const [date, setDate] = useState(days[0].date);
  const [length, setLength] = useState(2);
  const [startIdx, setStartIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Coming back from Stripe without paying: let the slots go straight away.
  useEffect(() => {
    const cancelled = params.get('cancelled');
    if (cancelled) {
      releaseHold(cancelled).catch(() => undefined);
      setNotice("Payment cancelled. Nothing was booked or charged.");
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    listLocations()
      .then((all) => {
        const active = all.filter((l) => l.is_active);
        setLocations(active);
        setLocationId((id) => id || active[0]?.id || '');
        if (active.length === 0) setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, []);

  const load = async () => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    try {
      setAvail(await getAvailability(locationId, date));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setStartIdx(null);
    setSelected([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, date]);

  const slots = avail?.slots ?? [];
  const resources = avail?.resources ?? [];

  /** Resource ids free for every 30 minutes from slot i for `length` slots. */
  const freeFor = (i: number, len: number): Set<string> | null => {
    if (i + len > slots.length) return null;
    let free: string[] | null = null;
    for (let k = i; k < i + len; k++) {
      if (slots[k].past) return null;
      const here = slots[k].free;
      free = free === null ? [...here] : free.filter((id) => here.includes(id));
    }
    return new Set(free ?? []);
  };

  const startOptions = slots
    .map((s, i) => ({ i, time: s.time, peak: s.peak, free: freeFor(i, length) }))
    .filter((o) => o.free && o.free.size > 0);

  const freeNow = startIdx !== null ? freeFor(startIdx, length) ?? new Set<string>() : new Set<string>();

  // Keep the chosen start valid when the length changes.
  useEffect(() => {
    if (startIdx !== null && !startOptions.some((o) => o.i === startIdx)) setStartIdx(null);
    setSelected((sel) => sel.filter((id) => freeNow.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, avail, startIdx]);

  const priceFor = (type: string): number => {
    if (startIdx === null || !avail) return 0;
    const p = avail.prices.find((x) => x.type === type);
    if (!p) return 0;
    let total = 0;
    for (let k = startIdx; k < startIdx + length; k++) {
      total += slots[k].peak && p.peak_cents !== null ? p.peak_cents : p.base_cents;
    }
    return total;
  };

  const total = selected.reduce((sum, id) => sum + priceFor(resources.find((r) => r.id === id)?.type ?? ''), 0);
  const startTime = startIdx !== null ? slots[startIdx]?.time : null;
  const endTime =
    startIdx !== null
      ? startIdx + length < slots.length
        ? slots[startIdx + length].time
        : (() => {
            const [h, m] = slots[slots.length - 1].time.split(':').map(Number);
            const mins = h * 60 + m + 30;
            return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
          })()
      : null;

  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const pay = async () => {
    if (startIdx === null || selected.length === 0) return;
    setPaying(true);
    setError(null);
    try {
      const start = slots[startIdx].starts_at;
      const end = new Date(new Date(start).getTime() + length * 30 * 60_000).toISOString();
      const hold = await createHold(locationId, selected, start, end);
      try {
        window.location.href = await startCheckout(hold.booking_id);
      } catch (err) {
        await releaseHold(hold.booking_id).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      setError((err as Error).message);
      setPaying(false);
      load();
    }
  };

  const cages = resources.filter((r) => r.type === 'batting_cage');
  const turf = resources.filter((r) => r.type === 'turf');

  return (
    <section className="book">
      <h1>Book</h1>
      {notice && <p className="alert alert-success" role="status">{notice}</p>}

      {locations.length > 1 && (
        <div className="book-step">
          <h2 className="step-title">Location</h2>
          <select className="time-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}
      {locations.length === 0 && !loading && <p className="muted">No locations are open for booking yet.</p>}

      <div className="book-step">
        <h2 className="step-title"><span className="step-num">1</span> Day</h2>
        <div className="chip-row" role="listbox" aria-label="Day">
          {days.map((d) => (
            <button
              key={d.date}
              role="option"
              aria-selected={date === d.date}
              className={`day-chip${date === d.date ? ' active' : ''}`}
              onClick={() => setDate(d.date)}
            >
              <span>{d.top}</span>
              <strong>{d.bottom}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="book-step">
        <h2 className="step-title"><span className="step-num">2</span> How long</h2>
        <div className="segmented">
          {LENGTHS.map((l) => (
            <button key={l.slots} className={length === l.slots ? 'active' : ''} onClick={() => setLength(l.slots)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="book-step">
        <h2 className="step-title"><span className="step-num">3</span> Start time</h2>
        {loading ? (
          <div className="page-loading">Loading times…</div>
        ) : avail?.closed ? (
          <p className="muted">Closed that day{avail.closed_reason && avail.closed_reason !== 'Closed' ? ` (${avail.closed_reason})` : ''}. Pick another day.</p>
        ) : startOptions.length === 0 ? (
          <p className="muted">Nothing left for {LENGTHS.find((l) => l.slots === length)?.label} that day. Try a shorter length or another day.</p>
        ) : (
          <>
            <div className="time-grid">
              {startOptions.map((o) => (
                <button
                  key={o.i}
                  className={`time-chip${startIdx === o.i ? ' active' : ''}${o.peak ? ' peak' : ''}`}
                  onClick={() => setStartIdx(o.i)}
                >
                  {formatTime(o.time)}
                  <span className="time-chip-sub">{o.free!.size} open</span>
                </button>
              ))}
            </div>
            {startOptions.some((o) => o.peak) && <p className="muted small"><span className="peak-dot" /> Peak pricing</p>}
          </>
        )}
      </div>

      {startIdx !== null && (
        <div className="book-step">
          <h2 className="step-title">
            <span className="step-num">4</span> Pick cages{turf.length ? ' or turf' : ''}
          </h2>
          <p className="muted small">
            {formatTime(startTime!)} – {formatTime(endTime!)} · choose one or more
          </p>
          {cages.length > 0 && (
            <div className="resource-grid">
              {cages.map((r) => {
                const free = freeNow.has(r.id);
                const on = selected.includes(r.id);
                return (
                  <button
                    key={r.id}
                    className={`resource-tile${on ? ' active' : ''}`}
                    disabled={!free}
                    aria-pressed={on}
                    onClick={() => toggle(r.id)}
                  >
                    <strong>{r.name.replace(/^Cage\s*/i, '') || r.name}</strong>
                    <span>{free ? formatMoney(priceFor(r.type)) : 'Taken'}</span>
                    <span className="tile-label">{/^Cage/i.test(r.name) ? 'Cage' : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
          {turf.map((r) => {
            const free = freeNow.has(r.id);
            const on = selected.includes(r.id);
            return (
              <button
                key={r.id}
                className={`resource-tile wide${on ? ' active' : ''}`}
                disabled={!free}
                aria-pressed={on}
                onClick={() => toggle(r.id)}
              >
                <strong>{r.name}</strong>
                <span>{free ? `${formatMoney(priceFor(r.type))} · whole turf area` : 'Taken'}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className={`book-bar${selected.length ? ' show' : ''}`}>
        <div>
          <strong>{formatMoney(total)}</strong>
          <span className="muted small">
            {selected.length} {selected.length === 1 ? 'spot' : 'spots'}
            {startTime && ` · ${formatTime(startTime)}–${formatTime(endTime!)}`}
          </span>
        </div>
        <button className="btn btn-primary" disabled={!selected.length || paying} onClick={pay}>
          {paying ? 'Opening payment…' : 'Continue to payment'}
        </button>
      </div>

      <p className="muted small book-policy">
        Cancel 24+ hours ahead for a full refund, or less than 24 hours ahead for a 50% refund, from{' '}
        <Link to="/bookings">My bookings</Link>.
      </p>
    </section>
  );
}
