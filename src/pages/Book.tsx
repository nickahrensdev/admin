import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Calendar from '../components/Calendar';
import {
  createHolds,
  getAvailability,
  releaseGroup,
  releaseHold,
  startCheckout,
  type Availability,
} from '../data/bookings';
import { listLocations, type Location } from '../data/locations';
import { formatDate, formatMoney, formatTime, isoDate } from '../utils/time';

const LENGTHS = [
  { slots: 1, label: '30 min' },
  { slots: 2, label: '1 hr' },
  { slots: 3, label: '1.5 hr' },
  { slots: 4, label: '2 hr' },
  { slots: 6, label: '3 hr' },
];
const DAYS_AHEAD = 90;
const MAX_DATES = 12;

type Mode = 'dates' | 'weekly';

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Per date: the slot index where the chosen start time falls, or null. */
type Plan = { date: string; avail: Availability; index: number | null };

export default function Book() {
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => isoDate(new Date()), []);
  const lastDay = useMemo(() => addDays(today, DAYS_AHEAD), [today]);

  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [mode, setMode] = useState<Mode>('dates');
  const [picked, setPicked] = useState<string[]>([today]); // "dates" mode
  const [repeatStart, setRepeatStart] = useState(today); // "weekly" mode
  const [weeks, setWeeks] = useState(4);
  const [length, setLength] = useState(2);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [availByDate, setAvailByDate] = useState<Record<string, Availability>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const weeklyDates = useMemo(
    () => Array.from({ length: weeks }, (_, k) => addDays(repeatStart, 7 * k)).filter((d) => d <= lastDay),
    [repeatStart, weeks, lastDay],
  );
  const dates = useMemo(
    () => (mode === 'weekly' ? weeklyDates : [...picked].sort()),
    [mode, weeklyDates, picked],
  );

  // Coming back from Stripe without paying: release the held slots straight away.
  useEffect(() => {
    const group = params.get('cancelled_group');
    const single = params.get('cancelled');
    if (group || single) {
      (group ? releaseGroup(group) : releaseHold(single!)).catch(() => undefined);
      setNotice('Payment cancelled. Nothing was booked or charged.');
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

  // Load availability for any selected date we don't have yet.
  const reload = async (force = false) => {
    if (!locationId) return;
    const missing = force ? dates : dates.filter((d) => !availByDate[d]);
    if (missing.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(missing.map((d) => getAvailability(locationId, d)));
      setAvailByDate((prev) => {
        const next = { ...prev };
        results.forEach((a) => (next[a.date] = a));
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAvailByDate({});
  }, [locationId]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, dates.join(','), Object.keys(availByDate).length === 0]);

  const ready = dates.length > 0 && dates.every((d) => availByDate[d]);
  const closedDates = ready ? dates.filter((d) => availByDate[d].closed) : [];
  const openDates = ready ? dates.filter((d) => !availByDate[d].closed) : [];

  /** Resources free on every open date for the window starting at `time`, or null if the time doesn't work everywhere. */
  const freeFor = (time: string, len: number): { free: string[]; peak: boolean; plans: Plan[] } | null => {
    if (!ready || openDates.length === 0) return null;
    let free: string[] | null = null;
    let peak = false;
    const plans: Plan[] = [];
    for (const d of openDates) {
      const a = availByDate[d];
      const i = a.slots.findIndex((s) => s.time === time);
      if (i < 0 || i + len > a.slots.length) return null;
      for (let k = i; k < i + len; k++) {
        if (a.slots[k].past) return null;
        const here = a.slots[k].free;
        free = free === null ? [...here] : free.filter((id) => here.includes(id));
        if (a.slots[k].peak) peak = true;
      }
      plans.push({ date: d, avail: a, index: i });
    }
    return { free: free ?? [], peak, plans };
  };

  // Every start time that appears on all open dates, in order.
  const allTimes = useMemo(() => {
    if (!ready || openDates.length === 0) return [];
    const sets = openDates.map((d) => availByDate[d].slots.map((s) => s.time));
    return sets[0].filter((t) => sets.every((s) => s.includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, openDates.join(','), availByDate]);

  const startOptions = allTimes
    .map((time) => ({ time, r: freeFor(time, length) }))
    .filter((o) => o.r && o.r.free.length > 0);

  const current = startTime ? freeFor(startTime, length) : null;
  const freeNow = new Set(current?.free ?? []);

  // Drop choices that stop being valid when dates, length or availability change.
  useEffect(() => {
    if (startTime && !startOptions.some((o) => o.time === startTime)) setStartTime(null);
    setSelected((sel) => sel.filter((id) => freeNow.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, startTime, dates.join(','), availByDate]);

  const resources = ready && openDates[0] ? availByDate[openDates[0]].resources : [];
  const prices = ready && openDates[0] ? availByDate[openDates[0]].prices : [];

  const priceFor = (type: string, plan: Plan): number => {
    const p = prices.find((x) => x.type === type);
    if (!p || plan.index === null) return 0;
    let total = 0;
    for (let k = plan.index; k < plan.index + length; k++) {
      total += plan.avail.slots[k].peak && p.peak_cents !== null ? p.peak_cents : p.base_cents;
    }
    return total;
  };
  const totalFor = (resourceIds: string[]) =>
    (current?.plans ?? []).reduce(
      (sum, plan) => sum + resourceIds.reduce((s, id) => s + priceFor(resources.find((r) => r.id === id)?.type ?? '', plan), 0),
      0,
    );
  const total = totalFor(selected);
  const sessions = (current?.plans.length ?? 0);

  const endTime = (() => {
    if (!startTime) return null;
    const [h, m] = startTime.split(':').map(Number);
    const mins = h * 60 + m + length * 30;
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  })();

  const toggleDate = (date: string) => {
    if (mode === 'weekly') {
      setRepeatStart(date);
      return;
    }
    setPicked((p) => {
      if (p.includes(date)) return p.length > 1 ? p.filter((d) => d !== date) : p;
      if (p.length >= MAX_DATES) {
        setError(`You can book up to ${MAX_DATES} dates at once.`);
        return p;
      }
      setError(null);
      return [...p, date];
    });
  };

  const removeDate = (date: string) => {
    if (mode === 'weekly') {
      // Switch to a custom list without that week.
      setPicked(weeklyDates.filter((d) => d !== date));
      setMode('dates');
    } else {
      setPicked((p) => (p.length > 1 ? p.filter((d) => d !== date) : p));
    }
  };

  const toggleResource = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const pay = async () => {
    if (!current || selected.length === 0) return;
    setPaying(true);
    setError(null);
    try {
      const slots = current.plans.map((p) => {
        const start = p.avail.slots[p.index!].starts_at;
        return { starts_at: start, ends_at: new Date(new Date(start).getTime() + length * 30 * 60_000).toISOString() };
      });
      const hold = await createHolds(locationId, selected, slots);
      try {
        window.location.href = await startCheckout(hold.group_id);
      } catch (err) {
        await releaseGroup(hold.group_id).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      setError((err as Error).message);
      setPaying(false);
      reload(true);
    }
  };

  const cages = resources.filter((r) => r.type === 'batting_cage');
  const turf = resources.filter((r) => r.type === 'turf');
  const lengthLabel = LENGTHS.find((l) => l.slots === length)?.label;

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
        <h2 className="step-title"><span className="step-num">1</span> Dates</h2>
        <div className="segmented" role="radiogroup" aria-label="How to pick dates">
          <button role="radio" aria-checked={mode === 'dates'} className={mode === 'dates' ? 'active' : ''} onClick={() => setMode('dates')}>
            Pick dates
          </button>
          <button
            role="radio"
            aria-checked={mode === 'weekly'}
            className={mode === 'weekly' ? 'active' : ''}
            onClick={() => {
              setRepeatStart([...picked].sort()[0] ?? today);
              setMode('weekly');
            }}
          >
            Repeat weekly
          </button>
        </div>

        <div className="date-picker">
          <Calendar
            selected={mode === 'weekly' ? [repeatStart] : picked}
            marked={mode === 'weekly' ? weeklyDates : []}
            onSelect={toggleDate}
            min={today}
            max={lastDay}
          />
          <div className="date-side">
            {mode === 'weekly' ? (
              <div className="stack">
                <p className="muted small">
                  Every <strong>{new Date(`${repeatStart}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}</strong>{' '}
                  starting {shortDate(repeatStart)}. Tap the calendar to change the first day.
                </p>
                <div className="stepper" aria-label="Number of weeks">
                  <button className="icon-btn" aria-label="Fewer weeks" disabled={weeks <= 2} onClick={() => setWeeks((w) => w - 1)}>−</button>
                  <span><strong>{weeks}</strong> weeks</span>
                  <button className="icon-btn" aria-label="More weeks" disabled={weeks >= MAX_DATES} onClick={() => setWeeks((w) => w + 1)}>+</button>
                </div>
                {weeklyDates.length < weeks && (
                  <p className="muted small">Bookings open {DAYS_AHEAD} days ahead, so this stops at {shortDate(weeklyDates[weeklyDates.length - 1])}.</p>
                )}
              </div>
            ) : (
              <p className="muted small">Tap as many days as you like (up to {MAX_DATES}). Same time and cages on each.</p>
            )}
            <div className="date-chips">
              {dates.map((d) => (
                <span key={d} className={`chip date-chip${closedDates.includes(d) ? ' chip-warn' : ''}`}>
                  {shortDate(d)}
                  {dates.length > 1 && (
                    <button aria-label={`Remove ${shortDate(d)}`} onClick={() => removeDate(d)}>×</button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
        {closedDates.length > 0 && (
          <p className="alert alert-error small">
            Closed on {closedDates.map((d) => `${shortDate(d)}${availByDate[d].closed_reason && availByDate[d].closed_reason !== 'Closed' ? ` (${availByDate[d].closed_reason})` : ''}`).join(', ')}.
            {openDates.length > 0 ? ' Those dates will be skipped.' : ' Pick another day.'}
          </p>
        )}
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
        {!ready || loading ? (
          <div className="page-loading">Loading times…</div>
        ) : openDates.length === 0 ? (
          <p className="muted">Closed on {dates.length > 1 ? 'those days' : 'that day'}. Pick another day.</p>
        ) : startOptions.length === 0 ? (
          <p className="muted">
            No {lengthLabel} time works on {openDates.length > 1 ? `all ${openDates.length} dates` : 'that day'}. Try a shorter length
            {openDates.length > 1 ? ', fewer dates' : ''} or another day.
          </p>
        ) : (
          <>
            <div className="time-grid">
              {startOptions.map((o) => (
                <button
                  key={o.time}
                  className={`time-chip${startTime === o.time ? ' active' : ''}${o.r!.peak ? ' peak' : ''}`}
                  onClick={() => setStartTime(o.time)}
                >
                  {formatTime(o.time)}
                  <span className="time-chip-sub">{o.r!.free.length} open</span>
                </button>
              ))}
            </div>
            <p className="muted small">
              {startOptions.some((o) => o.r!.peak) && <><span className="peak-dot" /> Peak pricing · </>}
              {openDates.length > 1 ? `Showing times open on all ${openDates.length} dates.` : ''}
            </p>
          </>
        )}
      </div>

      {startTime && current && (
        <div className="book-step">
          <h2 className="step-title">
            <span className="step-num">4</span> Pick cages{turf.length ? ' or turf' : ''}
          </h2>
          <p className="muted small">
            {formatTime(startTime)} – {formatTime(endTime!)}
            {sessions > 1 ? ` on ${sessions} dates · price shown is for all ${sessions}` : ''} · choose one or more
          </p>
          {cages.length > 0 && (
            <div className="resource-grid">
              {cages.map((r) => {
                const free = freeNow.has(r.id);
                const on = selected.includes(r.id);
                return (
                  <button key={r.id} className={`resource-tile${on ? ' active' : ''}`} disabled={!free} aria-pressed={on} onClick={() => toggleResource(r.id)}>
                    <strong>{r.name.replace(/^Cage\s*/i, '') || r.name}</strong>
                    <span>{free ? formatMoney(totalFor([r.id])) : 'Taken'}</span>
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
              <button key={r.id} className={`resource-tile wide${on ? ' active' : ''}`} disabled={!free} aria-pressed={on} onClick={() => toggleResource(r.id)}>
                <strong>{r.name}</strong>
                <span>{free ? `${formatMoney(totalFor([r.id]))} · whole turf area` : 'Taken'}</span>
              </button>
            );
          })}
          {sessions > 1 && selected.length > 0 && (
            <ul className="session-list">
              {current.plans.map((p) => (
                <li key={p.date}>
                  <span>{formatDate(p.date)}</span>
                  <span className="muted">{formatMoney(selected.reduce((s, id) => s + priceFor(resources.find((r) => r.id === id)?.type ?? '', p), 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className={`book-bar${selected.length ? ' show' : ''}`}>
        <div>
          <strong>{formatMoney(total)}</strong>
          <span className="muted small">
            {sessions > 1 ? `${sessions} dates · ` : ''}
            {selected.length} {selected.length === 1 ? 'spot' : 'spots'}
            {startTime && ` · ${formatTime(startTime)}–${formatTime(endTime!)}`}
          </span>
        </div>
        <button className="btn btn-primary" disabled={!selected.length || paying} onClick={pay}>
          {paying ? 'Opening payment…' : 'Continue to payment'}
        </button>
      </div>

      <p className="muted small book-policy">
        Each date can be cancelled on its own from <Link to="/bookings">My bookings</Link>: 24+ hours ahead for a full
        refund, or less than 24 hours ahead for 50%.
      </p>
    </section>
  );
}
