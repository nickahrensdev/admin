import LocationPicker from '../../components/LocationPicker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fmtInZone } from '../../data/bookings';
import { bookingWho, paymentLabel, staffDay, staffLocations, setAttendance, type StaffBooking, type StaffDay, type StaffLocation } from '../../data/staff';
import { formatMoney } from '../../utils/time';
import { addDays, todayIn } from '../../utils/dates';
import BookingPanel from './BookingPanel';
import StaffBookingForm, { type FormPrefill } from './StaffBookingForm';

const LOCATION_KEY = 'yard.frontDesk.location';
const SLOT_MS = 30 * 60 * 1000;


function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

export default function FrontDesk() {
  const [locations, setLocations] = useState<StaffLocation[] | null>(null);
  const [locationId, setLocationId] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [day, setDay] = useState<StaffDay | null>(null);
  const [view, setView] = useState<'timeline' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches ? 'list' : 'timeline',
  );
  const [showCancelled, setShowCancelled] = useState(false);
  const [filter, setFilter] = useState<'next' | 'all' | 'waiting'>('next');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [params] = useSearchParams();
  const [form, setForm] = useState<FormPrefill | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const location = locations?.find((l) => l.id === locationId) ?? null;
  const tz = location?.timezone ?? 'America/Chicago';
  const today = todayIn(tz);

  useEffect(() => {
    staffLocations()
      .then((locs) => {
        setLocations(locs);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(LOCATION_KEY);
        } catch {
          /* storage unavailable */
        }
        const wanted = params.get('loc');
        const pick = locs.find((l) => l.id === wanted) ?? locs.find((l) => l.id === saved) ?? locs[0];
        if (pick) {
          setLocationId(pick.id);
          const d = params.get('date');
          setDate(d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayIn(pick.timezone));
          const b = params.get('booking');
          if (b) {
            setSelectedId(b);
            setFilter('all');
            setShowCancelled(true);
          }
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!locationId || !date) return;
    try {
      setDay(await staffDay(locationId, date, showCancelled));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [locationId, date, showCancelled]);

  useEffect(() => {
    load();
    // Keep the desk current: refresh every minute and when the tab comes back.
    const timer = window.setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const changeLocation = (id: string) => {
    setLocationId(id);
    setDay(null);
    try {
      localStorage.setItem(LOCATION_KEY, id);
    } catch {
      /* storage unavailable */
    }
    const loc = locations?.find((l) => l.id === id);
    if (loc) setDate(todayIn(loc.timezone));
  };

  const active = useMemo(() => (day?.bookings ?? []).filter((b) => b.status !== 'cancelled'), [day]);
  const stats = useMemo(() => {
    const people = active.filter((b) => b.kind !== 'block' && b.status === 'confirmed');
    return {
      bookings: people.length,
      checkedIn: people.filter((b) => b.checked_in_at).length,
      noShows: people.filter((b) => b.no_show).length,
      blocks: active.filter((b) => b.kind === 'block').length,
    };
  }, [active]);

  const checkIn = async (b: StaffBooking, state: 'checked_in' | 'no_show' | 'none') => {
    setBusyId(b.id);
    try {
      await setAttendance(b.id, state);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const selected = day?.bookings.find((b) => b.id === selectedId) ?? null;
  const effFilter = date !== today && filter === 'next' ? 'all' : filter;
  const listed = useMemo(() => {
    const base = showCancelled ? (day?.bookings ?? []) : active;
    const nowMs = Date.now();
    if (effFilter === 'next') return base.filter((b) => Date.parse(b.ends_at) > nowMs);
    if (effFilter === 'waiting') return base.filter((b) => b.kind !== 'block' && b.status === 'confirmed' && !b.checked_in_at && !b.no_show);
    return base;
  }, [effFilter, showCancelled, day, active]);
  const canManage = Boolean(day?.can_manage);

  if (locations && locations.length === 0) {
    return (
      <section>
        <h1>Front desk</h1>
        <p className="muted">You aren’t assigned to any locations yet. Ask an admin to give you the location manager role.</p>
      </section>
    );
  }

  return (
    <section className="front-desk">
      <div className="desk-head">
        <div className="desk-title">
          <h1>Front desk</h1>
          {locations && locations.length > 1 ? (
            <LocationPicker locations={locations} value={locationId} onChange={changeLocation} />
          ) : (
            <p className="muted">{location?.name}</p>
          )}
        </div>
        {canManage && (
          <div className="desk-actions">
            <Link to="/admin/bookings" className="btn btn-ghost desktop-only">All bookings</Link>
            <button className="btn btn-primary walkin-btn" onClick={() => setForm({ kind: 'walk_in', date })}>+ Walk-in</button>
            <button className="btn btn-ghost" onClick={() => setForm({ kind: 'block', date })}>Block time</button>
          </div>
        )}
      </div>

      <div className="day-nav">
        <button className="btn btn-ghost btn-sm" aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>‹</button>
        <label className="day-picker">
          <span>{date ? (date === today ? `Today · ${prettyDate(date)}` : prettyDate(date)) : ''}</span>
          <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button className="btn btn-ghost btn-sm" aria-label="Next day" onClick={() => setDate((d) => addDays(d, 1))}>›</button>
        {date !== today && (
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(today)}>Today</button>
        )}
        <Link to="/admin/bookings" className="day-nav-all small mobile-only-flex">All bookings →</Link>
      </div>

      {notice && (
        <p className="alert alert-success" role="status">
          {notice} <button className="link-button" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {day && (
        <>
          <div className="desk-toolbar">
            <div className="desk-stats">
              <span><strong>{stats.bookings}</strong> booked</span>
              <span><strong>{stats.checkedIn}</strong> checked in</span>
              {stats.noShows > 0 && <span><strong>{stats.noShows}</strong> no-show</span>}
              {stats.blocks > 0 && <span><strong>{stats.blocks}</strong> blocked</span>}
            </div>
            <div className="segmented" role="radiogroup" aria-label="View">
              <button role="radio" aria-checked={view === 'timeline'} className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>Timeline</button>
              <button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
            </div>
          </div>

          {!day.opens_at && (
            <p className="alert alert-info">Closed{day.closed_reason ? ` — ${day.closed_reason}` : ''}.</p>
          )}

          {date === today && view === 'list' && day.resources.length > 0 && <RightNow day={day} bookings={active} />}

          {view === 'timeline' ? (
            <Timeline day={day} bookings={active} canManage={canManage} onSelect={setSelectedId}
              onEmpty={(resourceId, startIso) => setForm({ kind: 'walk_in', date, resourceId, startIso })} />
          ) : (
            <>
              <div className="filter-chips" role="radiogroup" aria-label="Show">
                {([['next', date === today ? 'Now & next' : 'All day'], ['waiting', 'Not here yet'], ['all', 'Everything']] as const)
                  .filter(([k]) => date === today || k !== 'next')
                  .map(([k, label]) => (
                    <button key={k} role="radio" aria-checked={effFilter === k} className={`filter-chip${effFilter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>
                      {label}
                    </button>
                  ))}
              </div>
              <BookingList day={day} bookings={listed} canManage={canManage}
                busyId={busyId} onSelect={setSelectedId} onCheckIn={checkIn} />
              <label className="toggle-line">
                <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
                Show cancelled
              </label>
            </>
          )}
        </>
      )}
      {!day && !error && <div className="page-loading">Loading…</div>}

      {selected && day && (
        <BookingPanel
          booking={selected}
          day={day}
          onClose={() => setSelectedId(null)}
          onChanged={async (message) => {
            if (message) setNotice(message);
            await load();
          }}
        />
      )}
      {form && day && location && (
        <StaffBookingForm
          location={location}
          prefill={form}
          today={today}
          onClose={() => setForm(null)}
          onCreated={async (message, onDate) => {
            setForm(null);
            setNotice(message);
            if (onDate !== date) setDate(onDate);
            else await load();
          }}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Timeline: one column per cage/turf, one row per 30 minutes        */
/* ---------------------------------------------------------------- */

function dayRange(day: StaffDay, bookings: StaffBooking[]): [number, number] | null {
  let from = day.opens_at ? Date.parse(day.opens_at) : Infinity;
  let to = day.closes_at ? Date.parse(day.closes_at) : -Infinity;
  for (const b of bookings) {
    from = Math.min(from, Date.parse(b.starts_at));
    to = Math.max(to, Date.parse(b.ends_at));
  }
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? [from, to] : null;
}

function Timeline({
  day,
  bookings,
  canManage,
  onSelect,
  onEmpty,
}: {
  day: StaffDay;
  bookings: StaffBooking[];
  canManage: boolean;
  onSelect(id: string): void;
  onEmpty(resourceId: string, startIso: string): void;
}) {
  const range = dayRange(day, bookings);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  if (!range) return day.opens_at ? null : <p className="muted">Nothing booked.</p>;
  const [from, to] = range;
  const rows = Math.round((to - from) / SLOT_MS);
  const slots = Array.from({ length: rows }, (_, i) => from + i * SLOT_MS);
  const col = new Map(day.resources.map((r, i) => [r.id, i + 2]));
  const busy = new Set<string>();
  for (const b of bookings) {
    for (const rid of b.resource_ids) {
      for (let t = Date.parse(b.starts_at); t < Date.parse(b.ends_at); t += SLOT_MS) busy.add(`${rid}|${t}`);
    }
  }
  const nowRow = now >= from && now < to ? (now - from) / SLOT_MS : null;
  const open = (t: number) =>
    day.opens_at && day.closes_at && t >= Date.parse(day.opens_at) && t < Date.parse(day.closes_at);

  return (
    <div className="timeline-scroll">
      <div
        className="timeline"
        style={{
          gridTemplateColumns: `4.2rem repeat(${day.resources.length}, minmax(5.5rem, 1fr))`,
          gridTemplateRows: `auto repeat(${rows}, 2.1rem)`,
          minWidth: `calc(4.2rem + ${day.resources.length} * 5.5rem)`,
        }}
      >
        <div className="tl-corner" style={{ gridRow: 1, gridColumn: 1 }} />
        {day.resources.map((r) => (
          <div key={r.id} className={`tl-head${r.type === 'turf' ? ' is-turf' : ''}`} style={{ gridRow: 1, gridColumn: col.get(r.id) }}>
            {r.name}
          </div>
        ))}

        {slots.map((t, i) => (
          <div key={t} className={`tl-time${i % 2 ? ' half' : ''}`} style={{ gridRow: i + 2, gridColumn: 1 }}>
            {i % 2 === 0 || rows <= 12 ? fmtInZone(new Date(t).toISOString(), day.timezone, { hour: 'numeric', minute: '2-digit' }) : ''}
          </div>
        ))}

        {slots.map((t, i) =>
          day.resources.map((r) => {
            const free = !busy.has(`${r.id}|${t}`);
            const clickable = canManage && free && open(t) && t + SLOT_MS > now;
            return clickable ? (
              <button
                key={`${r.id}${t}`}
                className="tl-cell"
                style={{ gridRow: i + 2, gridColumn: col.get(r.id) }}
                aria-label={`Book ${r.name} at ${fmtInZone(new Date(t).toISOString(), day.timezone, { hour: 'numeric', minute: '2-digit' })}`}
                onClick={() => onEmpty(r.id, new Date(t).toISOString())}
              />
            ) : (
              <div key={`${r.id}${t}`} className={`tl-cell${open(t) ? '' : ' closed'}`} style={{ gridRow: i + 2, gridColumn: col.get(r.id) }} />
            );
          }),
        )}

        {bookings.flatMap((b) => {
          const start = Math.max(Date.parse(b.starts_at), from);
          const end = Math.min(Date.parse(b.ends_at), to);
          const rowStart = Math.round((start - from) / SLOT_MS) + 2;
          const rowEnd = Math.round((end - from) / SLOT_MS) + 2;
          return b.resource_ids
            .filter((rid) => col.has(rid))
            .map((rid) => (
              <button
                key={`${b.id}${rid}`}
                className={`tl-booking ${bookingClass(b)}`}
                style={{ gridRow: `${rowStart} / ${rowEnd}`, gridColumn: col.get(rid) }}
                onClick={() => onSelect(b.id)}
                title={`${bookingWho(b)} · ${paymentLabel(b)}`}
              >
                <span className="tl-who">{b.checked_in_at ? '✓ ' : ''}{bookingWho(b)}</span>
                {rowEnd - rowStart > 1 && <span className="tl-sub">{kindLabel(b)}</span>}
              </button>
            ));
        })}

        {nowRow !== null && (
          <div className="tl-now" style={{ gridRow: Math.floor(nowRow) + 2, gridColumn: `1 / -1`, marginTop: `${(nowRow % 1) * 2.1}rem` }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

export function bookingClass(b: StaffBooking): string {
  if (b.status === 'cancelled') return 'is-cancelled';
  if (b.kind === 'block') return 'is-block';
  if (b.status === 'pending') return 'is-pending';
  if (b.no_show) return 'is-noshow';
  if (b.checked_in_at) return 'is-in';
  return b.kind === 'walk_in' ? 'is-walkin' : 'is-online';
}

export function kindLabel(b: StaffBooking): string {
  if (b.status === 'cancelled') return 'Cancelled';
  if (b.kind === 'block') return 'Blocked';
  if (b.status === 'pending') return 'Paying…';
  if (b.no_show) return 'No-show';
  if (b.checked_in_at) return 'Checked in';
  return b.kind === 'walk_in' ? 'Walk-in' : b.member_tier ? `Member · ${b.member_tier}` : 'Online';
}

/* ---------------------------------------------------------------- */
/* Right now: which cages are in use, booked or open                 */
/* ---------------------------------------------------------------- */

function RightNow({ day, bookings }: { day: StaffDay; bookings: StaffBooking[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const live = bookings.filter((b) => b.status === 'confirmed' && Date.parse(b.starts_at) <= now && Date.parse(b.ends_at) > now);
  const state = (rid: string): 'in' | 'booked' | 'blocked' | 'open' => {
    const b = live.find((x) => x.resource_ids.includes(rid));
    if (!b) return 'open';
    if (b.kind === 'block') return 'blocked';
    return b.checked_in_at ? 'in' : 'booked';
  };
  const label = { in: 'in use', booked: 'booked, not here yet', blocked: 'blocked', open: 'open' };
  const open = day.resources.filter((r) => state(r.id) === 'open').length;
  return (
    <section className="right-now card" aria-label="Right now">
      <div className="right-now-head">
        <span className="eyebrow">Right now · {fmtInZone(new Date(now).toISOString(), day.timezone, { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="muted small">{open} open</span>
      </div>
      <div className="cage-map" style={{ gridTemplateColumns: `repeat(${Math.min(day.resources.length, 9)}, minmax(0, 1fr))` }}>
        {day.resources.map((r) => {
          const st = state(r.id);
          const short = r.type === 'turf' ? 'Turf' : (r.name.match(/\d+$/)?.[0] ?? r.name);
          return (
            <span key={r.id} className={`cage-cell is-${st}`} title={`${r.name}: ${label[st]}`} aria-label={`${r.name}: ${label[st]}`}>
              {short}
            </span>
          );
        })}
      </div>
      <div className="cage-legend muted small" aria-hidden="true">
        <span><i className="is-in" /> in use</span>
        <span><i className="is-booked" /> booked</span>
        <span><i className="is-open" /> open</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* List: easiest on a phone                                           */
/* ---------------------------------------------------------------- */

function BookingList({
  day,
  bookings,
  canManage,
  busyId,
  onSelect,
  onCheckIn,
}: {
  day: StaffDay;
  bookings: StaffBooking[];
  canManage: boolean;
  busyId: string | null;
  onSelect(id: string): void;
  onCheckIn(b: StaffBooking, state: 'checked_in' | 'no_show' | 'none'): void;
}) {
  if (bookings.length === 0) return <p className="muted empty-day">Nothing booked yet.</p>;
  const names = new Map(day.resources.map((r) => [r.id, r.name]));
  const time = (iso: string) => fmtInZone(iso, day.timezone, { hour: 'numeric', minute: '2-digit' });

  return (
    <ul className="desk-list">
      {bookings.map((b) => {
        const attendable = canManage && b.kind !== 'block' && b.status === 'confirmed';
        return (
          <li key={b.id} className={`card desk-item ${bookingClass(b)}`}>
            <button className="desk-item-main" onClick={() => onSelect(b.id)}>
              <span className="desk-time">{time(b.starts_at)}<span className="muted"> – {time(b.ends_at)}</span></span>
              <span className="desk-who">{bookingWho(b)}</span>
              <span className="muted small">
                {b.resource_ids.map((id) => names.get(id) ?? 'Removed').join(', ')}
                {b.kind !== 'block' && ` · ${paymentLabel(b)}`}
                {b.kind !== 'block' && b.total_cents > 0 && ` · ${formatMoney(b.total_cents)}`}
                {b.customer?.waiver_ok === false && <span className="waiver-warn-inline"> · No waiver</span>}
              </span>
              <span className={`chip desk-chip ${bookingClass(b)}`}>{kindLabel(b)}</span>
            </button>
            {attendable && (
              <div className="desk-item-actions">
                {b.checked_in_at || b.no_show ? (
                  <button className="btn btn-ghost btn-sm" disabled={busyId === b.id} onClick={() => onCheckIn(b, 'none')}>Undo</button>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={busyId === b.id} onClick={() => onCheckIn(b, 'checked_in')}>Check in</button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
