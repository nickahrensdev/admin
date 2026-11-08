import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminDashboard, type Dashboard } from '../data/dashboard';
import { formatMoney } from '../utils/time';
import { ChevronRight } from './Icons';

const dateOf = (iso: string) => new Intl.DateTimeFormat('en-CA').format(new Date(iso));
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The owner's Home: today's numbers and anything that needs a look. */
export default function OwnerDashboard() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = () => adminDashboard().then(setD).catch(() => setFailed(true));
    load();
    const t = window.setInterval(load, 120_000);
    return () => window.clearInterval(t);
  }, []);

  if (failed) return null;
  if (!d) return <div className="card owner-dash"><p className="muted">Loading today…</p></div>;

  const a = d.attention;
  const items: { key: string; to: string; text: string; tone: 'warn' | 'info' }[] = [
    ...a.unpaid_walk_ins.map((w) => ({
      key: `pay${w.id}`, to: `/front-desk?loc=${w.location_id}&date=${dateOf(w.starts_at)}&booking=${w.id}`,
      text: `Collect ${formatMoney(w.cents)} from ${w.who ?? 'a walk-in'} (${clock(w.starts_at)})`, tone: 'warn' as const,
    })),
    ...a.possible_no_shows.map((n) => ({
      key: `ns${n.id}`, to: `/front-desk?loc=${n.location_id}&date=${dateOf(n.starts_at)}&booking=${n.id}`,
      text: `${n.who ?? 'Someone'} didn’t check in (${clock(n.starts_at)})`, tone: 'warn' as const,
    })),
    ...a.unsigned_waivers.map((w) => ({
      key: `w${w.user_id}`, to: `/admin/bookings?user=${w.user_id}`, text: `${w.name} is booked today without a waiver`, tone: 'warn' as const,
    })),
    ...(a.past_due_members ? [{ key: 'pd', to: '/admin/memberships?tab=members', text: `${a.past_due_members} membership payment${a.past_due_members === 1 ? '' : 's'} failed`, tone: 'warn' as const }] : []),
    ...(d.open_todos ? [{ key: 'todo', to: '/admin/todos', text: `${d.open_todos} open to-do${d.open_todos === 1 ? '' : 's'}`, tone: 'info' as const }] : []),
  ];

  return (
    <section className="owner-dash" aria-label="Today at The Yard">
      <div className="owner-tiles">
        <Link to="/admin/reports" className="card owner-tile">
          <span className="muted small">Today’s revenue</span>
          <strong>{formatMoney(d.today.revenue_cents)}</strong>
          <span className="muted small">{+d.today.hours.toFixed(1)} hr booked</span>
        </Link>
        <Link to="/front-desk" className="card owner-tile">
          <span className="muted small">Sessions today</span>
          <strong>{d.today.bookings}</strong>
          <span className="muted small">{d.today.checked_in} in · {d.today.still_to_come} to come</span>
        </Link>
        <Link to="/admin/bookings" className="card owner-tile">
          <span className="muted small">Next 7 days</span>
          <strong>{d.next_7_days}</strong>
          <span className="muted small">sessions booked</span>
        </Link>
        <Link to="/admin/memberships?tab=members" className="card owner-tile">
          <span className="muted small">Members</span>
          <strong>{d.members.active}</strong>
          <span className="muted small">+{d.members.new_7_days} this week · {d.signups_7_days} sign-up{d.signups_7_days === 1 ? '' : 's'}</span>
        </Link>
      </div>

      <h2 className="list-title">Needs attention</h2>
      {items.length === 0 ? (
        <p className="card muted owner-clear">All clear.</p>
      ) : (
        <div className="list-group">
          {items.map((i) => (
            <Link key={i.key} to={i.to} className={`list-row attention is-${i.tone}`}>
              <span className="attention-dot" aria-hidden="true" />
              <span className="list-label">{i.text}</span>
              <ChevronRight />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
