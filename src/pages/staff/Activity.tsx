import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtInZone } from '../../data/bookings';
import { activity, staffLocations, type ActivityEvent, type StaffLocation } from '../../data/staff';
import { describeEvent } from '../../utils/desk';
import LocationPicker from '../../components/LocationPicker';
import { ChevronRight } from '../../components/Icons';

const PAGE = 100;
const ACTIONS = [
  ['', 'Everything'],
  ['cancelled', 'Cancellations'],
  ['refunded', 'Refunds'],
  ['moved', 'Cage moves'],
  ['rescheduled', 'Time changes'],
  ['paid', 'Payments collected'],
  ['no_show', 'No-shows'],
  ['created', 'New bookings'],
] as const;

/** Who did what to bookings, newest first. */
export default function Activity() {
  const [locations, setLocations] = useState<StaffLocation[]>([]);
  const [loc, setLoc] = useState('');
  const [action, setAction] = useState('');
  const [staffOnly, setStaffOnly] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    staffLocations().then(setLocations).catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    setEvents(null);
    activity({ location: loc, action, staffOnly }, PAGE, 0)
      .then((r) => {
        if (!live) return;
        setEvents(r.events);
        setTotal(r.total);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [loc, action, staffOnly]);

  const loadMore = async () => {
    setMore(true);
    try {
      const r = await activity({ location: loc, action, staffOnly }, PAGE, events?.length ?? 0);
      setEvents((e) => [...(e ?? []), ...r.events]);
    } finally {
      setMore(false);
    }
  };

  const groups: { day: string; items: ActivityEvent[] }[] = [];
  for (const e of events ?? []) {
    const day = new Date(e.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <section className="activity">
      <div className="page-header">
        <div>
          <h1>Activity</h1>
          <p className="muted">Every change to a booking, and who made it.</p>
        </div>
      </div>

      <div className="lb-filter-row activity-filters">
        {locations.length > 1 && (
          <LocationPicker locations={[{ id: '', name: 'All locations' }, ...locations]} value={loc} onChange={setLoc} />
        )}
        <select className="time-select" aria-label="Kind of change" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="check-line">
          <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} />
          Staff only
        </label>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!events ? (
        <div className="page-loading">Loading…</div>
      ) : events.length === 0 ? (
        <p className="card muted">Nothing yet.</p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.day}>
              <h2 className="list-title">{g.day}</h2>
              <div className="list-group">
                {g.items.map((e) => {
                  const tz = e.booking.location.timezone;
                  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(e.booking.starts_at));
                  return (
                    <Link key={e.id} to={`/front-desk?loc=${e.booking.location.id}&date=${date}&booking=${e.booking.id}`} className="list-row activity-row">
                      <span className="activity-time muted small">{new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="list-label">
                        <span><strong>{e.actor?.name ?? 'Automatic'}</strong> · {describeEvent(e, tz)}</span>
                        <span className="muted small">
                          {e.booking.who} · {fmtInZone(e.booking.starts_at, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {locations.length > 1 && ` · ${e.booking.location.name}`}
                        </span>
                      </span>
                      <ChevronRight />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {events.length < total && (
            <button className="btn btn-ghost btn-block lb-more" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Show more'}</button>
          )}
        </>
      )}
    </section>
  );
}
