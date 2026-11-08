import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCanOpen } from '../auth/useCanOpen';
import { PRIVILEGES } from '../auth/rbac';
import { fmtInZone, myBookings, myBookingTerms, type BookingTerms, type MyBooking } from '../data/bookings';
import { listTiers, myMembership, type MyMembership, type Tier } from '../data/memberships';
import { staffDay, staffLocations } from '../data/staff';
import { APP_ROUTES } from '../routes';
import { formatMoney } from '../utils/time';
import { todayIn } from './staff/FrontDesk';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Today", "Tomorrow", "In 5 days", in the location's time zone. */
function relativeDay(iso: string, tz: string): string {
  const day = (d: Date) => Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)}T00:00:00Z`);
  const diff = Math.round((day(new Date(iso)) - day(new Date())) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

const hrs = (min: number) => `${+(min / 60).toFixed(1)} hr`;

interface DeskSummary {
  location: string;
  booked: number;
  checkedIn: number;
  blocks: number;
}

export default function Home() {
  const { user, hasPrivilege } = useAuth();
  const canOpen = useCanOpen();
  const passwordChanged = Boolean((useLocation().state as { passwordChanged?: boolean } | null)?.passwordChanged);

  const canBook = hasPrivilege(PRIVILEGES.BOOKINGS_CREATE);
  const isStaff = canOpen({ privileges: [PRIVILEGES.BOOKINGS_VIEW_ALL], anyLocation: true });

  const [upcoming, setUpcoming] = useState<MyBooking[] | null>(null);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [terms, setTerms] = useState<BookingTerms | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [desk, setDesk] = useState<DeskSummary | null>(null);

  useEffect(() => {
    if (!canBook) return;
    // Each panel loads on its own; a failure just hides that panel.
    myBookings()
      .then((list) => {
        const now = Date.now();
        setUpcoming(
          list
            .filter((b) => b.status === 'confirmed' && Date.parse(b.ends_at) > now)
            .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
        );
      })
      .catch(() => setUpcoming([]));
    Promise.all([listTiers(), myMembership()])
      .then(async ([t, m]) => {
        setTiers(t);
        const active = m && (m.status === 'active' || m.status === 'past_due') ? m : null;
        setMembership(active);
        const loc = active && t.find((x) => x.id === active.tier.id)?.benefits[0]?.location_id;
        if (loc) setTerms(await myBookingTerms(loc));
      })
      .catch(() => undefined);
  }, [canBook]);

  useEffect(() => {
    if (!isStaff) return;
    staffLocations()
      .then(async (locs) => {
        const loc = locs[0];
        if (!loc) return;
        const day = await staffDay(loc.id, todayIn(loc.timezone));
        const live = day.bookings.filter((b) => b.status === 'confirmed');
        const people = live.filter((b) => b.kind !== 'block');
        setDesk({
          location: loc.name,
          booked: people.length,
          checkedIn: people.filter((b) => b.checked_in_at).length,
          blocks: live.length - people.length,
        });
      })
      .catch(() => undefined);
  }, [isStaff]);

  const next = upcoming?.[0];
  const cheapest = tiers.length ? tiers.reduce((a, b) => (b.monthly_price_cents < a.monthly_price_cents ? b : a)) : null;
  const shortcuts = APP_ROUTES.filter((r) => r.launcher && canOpen(r) && r.path !== '/home');
  const everyday = shortcuts.filter((r) => r.nav?.group !== 'admin');
  const admin = shortcuts.filter((r) => r.nav?.group === 'admin');

  return (
    <section className="home">
      <header className="home-head">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1>{user?.displayName}</h1>
        </div>
        {canBook && (
          <Link to="/book" className="btn btn-primary btn-lg">Book a cage</Link>
        )}
      </header>
      {passwordChanged && <p className="alert alert-success" role="status">Your password has been changed.</p>}

      <div className="home-panels">
        {canBook && (
          <div className="card next-card">
            <p className="eyebrow">Next session</p>
            {upcoming === null ? (
              <p className="muted">Loading…</p>
            ) : next ? (
              <>
                <p className="next-when">
                  <span className="next-rel">{relativeDay(next.starts_at, next.location.timezone)}</span>
                  {fmtInZone(next.starts_at, next.location.timezone, { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
                <p className="next-time">
                  {fmtInZone(next.starts_at, next.location.timezone, { hour: 'numeric', minute: '2-digit' })} –{' '}
                  {fmtInZone(next.ends_at, next.location.timezone, { hour: 'numeric', minute: '2-digit' })}
                </p>
                <p className="muted">
                  {(next.items ?? []).map((i) => i.name).join(', ')} · {next.location.name}
                </p>
                <div className="card-actions">
                  <Link to="/bookings" className="btn btn-ghost btn-sm">
                    {upcoming.length > 1 ? `All ${upcoming.length} upcoming` : 'View booking'}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="next-empty">Nothing on the calendar.</p>
                <p className="muted">Grab a cage or the turf in 30-minute blocks.</p>
                <div className="card-actions">
                  <Link to="/book" className="btn btn-primary btn-sm">Book a session</Link>
                </div>
              </>
            )}
          </div>
        )}

        {canBook && (membership ? (
          <div className="card member-panel">
            <p className="eyebrow">Membership</p>
            <h2>{membership.tier.name}</h2>
            {membership.status === 'past_due' ? (
              <p className="alert alert-error small">Your last payment didn’t go through. Update your card to keep your benefits.</p>
            ) : membership.cancel_at_period_end && membership.current_period_end ? (
              <p className="muted small">Ends {new Date(membership.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
            ) : null}
            {terms?.member && (terms.included_cage_minutes ?? 0) > 0 && (
              <div className="usage">
                <div className="usage-bar">
                  <span style={{ width: `${Math.min(100, (100 * (terms.included_used_this_month ?? 0)) / terms.included_cage_minutes!)}%` }} />
                </div>
                <span className="small">
                  <strong>{hrs(Math.max(0, terms.included_cage_minutes! - (terms.included_used_this_month ?? 0)))}</strong> of{' '}
                  {hrs(terms.included_cage_minutes!)} cage time left this month
                </span>
              </div>
            )}
            <div className="card-actions">
              <Link to="/memberships" className="btn btn-ghost btn-sm">Manage membership</Link>
            </div>
          </div>
        ) : cheapest ? (
          <div className="card member-panel is-pitch">
            <p className="eyebrow">Membership</p>
            <h2>Train more, pay less</h2>
            <p className="muted">
              Cage time included every month, member pricing and a 90-day booking window, from{' '}
              <strong>{formatMoney(cheapest.monthly_price_cents)}/month</strong>.
            </p>
            <div className="card-actions">
              <Link to="/memberships" className="btn btn-primary btn-sm">See memberships</Link>
            </div>
          </div>
        ) : null)}

        {desk && (
          <div className="card desk-panel">
            <p className="eyebrow">Front desk · today</p>
            <h2>{desk.location}</h2>
            <div className="desk-stats">
              <span><strong>{desk.booked}</strong> booked</span>
              <span><strong>{desk.checkedIn}</strong> checked in</span>
              {desk.blocks > 0 && <span><strong>{desk.blocks}</strong> blocked</span>}
            </div>
            <div className="card-actions">
              <Link to="/front-desk" className="btn btn-ghost btn-sm">Open front desk</Link>
            </div>
          </div>
        )}
      </div>

      {everyday.length > 0 && (
        <>
          <h2 className="section-title">Shortcuts</h2>
          <div className="shortcut-grid">
            {everyday.map((r) => (
              <Link key={r.path} to={r.path} className="shortcut">
                <strong>{r.launcher!.title}</strong>
                <span>{r.launcher!.description}</span>
              </Link>
            ))}
            <Link to="/about" className="shortcut">
              <strong>About The Yard</strong>
              <span>Hours, prices, how booking works and the cancellation policy.</span>
            </Link>
          </div>
        </>
      )}

      {admin.length > 0 && (
        <>
          <h2 className="section-title">Admin</h2>
          <div className="shortcut-grid">
            {admin.map((r) => (
              <Link key={r.path} to={r.path} className="shortcut is-admin">
                <strong>{r.launcher!.title}</strong>
                <span>{r.launcher!.description}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {shortcuts.length === 0 && !canBook && (
        <div className="card">
          <h2>Nothing here yet</h2>
          <p className="muted">You don't have access to any apps yet. Ask an administrator for access.</p>
        </div>
      )}
    </section>
  );
}
