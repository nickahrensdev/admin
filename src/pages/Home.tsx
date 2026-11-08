import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCanOpen } from '../auth/useCanOpen';
import { PRIVILEGES } from '../auth/rbac';
import { fmtInZone, myBookings, myBookingTerms, type BookingTerms, type MyBooking } from '../data/bookings';
import { listTiers, myMembership, type MyMembership, type Tier } from '../data/memberships';
import { staffDay, staffLocations } from '../data/staff';
import { APP_ROUTES } from '../routes';
import { dismissAnnouncement, myAnnouncements, type Announcement } from '../data/announcements';
import { formatMoney } from '../utils/time';
import { todayIn } from '../utils/dates';
import { bookAgainLink, lastRegular } from '../utils/rebook';
import { downloadIcs } from '../utils/ics';
import { BookIcon, ChevronRight, MegaphoneIcon, RepeatIcon } from '../components/Icons';

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

  const [all, setAll] = useState<MyBooking[] | null>(null);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [terms, setTerms] = useState<BookingTerms | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [desk, setDesk] = useState<DeskSummary | null>(null);
  const [messages, setMessages] = useState<Announcement[] | null>(null);
  const [openMsg, setOpenMsg] = useState<string | null>(null);

  useEffect(() => {
    myAnnouncements().then(setMessages).catch(() => setMessages([]));
  }, []);

  const dismiss = async (id: string) => {
    setMessages((list) => (list ?? []).filter((m) => m.id !== id));
    await dismissAnnouncement(id).catch(() => myAnnouncements().then(setMessages));
  };

  useEffect(() => {
    if (!canBook) return;
    // Each panel loads on its own; a failure just hides that panel.
    myBookings().then(setAll).catch(() => setAll([]));
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

  const now = Date.now();
  const upcoming = all
    ? all.filter((b) => b.status === 'confirmed' && Date.parse(b.ends_at) > now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    : null;
  const next = upcoming?.[0];
  const sameDay = next ? upcoming!.filter((b) => b !== next && fmtInZone(b.starts_at, b.location.timezone, { dateStyle: 'short' }) === fmtInZone(next.starts_at, next.location.timezone, { dateStyle: 'short' })).length : 0;
  const regular = all ? lastRegular(all) : null;
  const cheapest = tiers.length ? tiers.reduce((a, b) => (b.monthly_price_cents < a.monthly_price_cents ? b : a)) : null;
  const admin = APP_ROUTES.filter((r) => r.launcher && canOpen(r) && r.nav?.group === 'admin');
  const time = (b: MyBooking, iso: string) => fmtInZone(iso, b.location.timezone, { hour: 'numeric', minute: '2-digit' });

  return (
    <section className="home">
      <header className="home-head">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1>{user?.displayName}</h1>
        </div>
        {canBook && (
          <Link to="/book" className="btn btn-primary btn-lg desktop-only">Book a cage</Link>
        )}
      </header>
      {passwordChanged && <p className="alert alert-success" role="status">Your password has been changed.</p>}

      {canBook && (
        <div className="card next-card">
          <div className="next-top">
            <span className="eyebrow">Next session</span>
            {next && <span className="next-rel">{Date.parse(next.starts_at) <= Date.now() ? 'Happening now' : relativeDay(next.starts_at, next.location.timezone)}</span>}
          </div>
          {upcoming === null ? (
            <p className="muted">Loading…</p>
          ) : next ? (
            <>
              <div className="next-main">
                <div className="date-block" aria-hidden="true">
                  <span>{fmtInZone(next.starts_at, next.location.timezone, { weekday: 'short' })}</span>
                  <strong>{fmtInZone(next.starts_at, next.location.timezone, { day: 'numeric' })}</strong>
                </div>
                <div>
                  <p className="next-time">
                    <span className="sr-only">{fmtInZone(next.starts_at, next.location.timezone, { weekday: 'long', month: 'long', day: 'numeric' })}, </span>
                    {time(next, next.starts_at)} – {time(next, next.ends_at)}
                  </p>
                  <p className="muted">{(next.items ?? []).map((i) => i.name).join(', ')} · {next.location.name}</p>
                </div>
              </div>
              <div className="next-actions">
                <Link to={`/bookings?open=${next.id}`} className="btn btn-ghost">Manage</Link>
                <button className="btn btn-ghost" onClick={() => downloadIcs(next)}>Add to calendar</button>
              </div>
              {upcoming!.length > 1 && (
                <Link to="/bookings" className="next-more">
                  {sameDay > 0 ? `+ ${sameDay} more that day` : `All ${upcoming!.length} upcoming`} →
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="next-empty">Nothing on the calendar.</p>
              <p className="muted">Grab a cage or the turf in 30-minute blocks.</p>
            </>
          )}
        </div>
      )}

      {canBook && (
        <div className="home-actions">
          <Link to="/book" className="btn btn-primary btn-xl">
            <BookIcon /> Book a cage
          </Link>
          {regular && (
            <Link to={bookAgainLink(regular)} className="book-again">
              <RepeatIcon size={18} />
              <span>
                <span className="muted">Book again:</span> {regular.label}
              </span>
              <ChevronRight />
            </Link>
          )}
        </div>
      )}

      <section className="messages" aria-label="Messages">
        <h2 className="section-title sr-only">Messages</h2>
        {messages === null ? null : messages.length === 0 ? (
          <p className="no-messages muted small">No new messages</p>
        ) : (
          <ul className="message-list">
            {messages.map((m) => {
              const open = openMsg === m.id;
              const long = (m.body?.length ?? 0) > 90;
              return (
                <li key={m.id} className="message">
                  <MegaphoneIcon size={20} />
                  <div className="message-text">
                    <strong>{m.title}</strong>
                    {m.body && <p className={`message-body${long && !open ? ' clamp' : ''}`}>{m.body}</p>}
                    {long && (
                      <button className="link-button small" onClick={() => setOpenMsg(open ? null : m.id)}>{open ? 'Show less' : 'Read more'}</button>
                    )}
                    <span className="muted small">{m.location_name ?? 'All locations'}</span>
                  </div>
                  {m.dismissible && (
                    <button className="message-dismiss" onClick={() => dismiss(m.id)} aria-label={`Dismiss “${m.title}”`}>✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="home-panels">
        {canBook && (membership ? (
          <Link to="/memberships" className="card member-mini">
            <div className="member-mini-top">
              <span><strong className="tier-name">{membership.tier.name}</strong> · membership</span>
              {terms?.member && (terms.included_cage_minutes ?? 0) > 0 && (
                <span className="muted">
                  {hrs(Math.max(0, terms.included_cage_minutes! - (terms.included_used_this_month ?? 0)))} of {hrs(terms.included_cage_minutes!)} left
                </span>
              )}
            </div>
            {terms?.member && (terms.included_cage_minutes ?? 0) > 0 && (
              <div className="usage-bar" role="img" aria-label="Included cage time left this month">
                <span style={{ width: `${Math.max(0, 100 - (100 * (terms.included_used_this_month ?? 0)) / terms.included_cage_minutes!)}%` }} />
              </div>
            )}
            {membership.status === 'past_due' && <p className="alert alert-error small">Your last payment didn’t go through. Update your card to keep your benefits.</p>}
            {membership.cancel_at_period_end && membership.current_period_end && (
              <span className="muted small">Ends {new Date(membership.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            )}
          </Link>
        ) : cheapest ? (
          <Link to="/memberships" className="card member-mini is-pitch">
            <strong>Train more, pay less</strong>
            <span className="muted small">
              Cage time included every month, member pricing and a 90-day booking window, from {formatMoney(cheapest.monthly_price_cents)}/month.
            </span>
          </Link>
        ) : null)}

        {desk && (
          <Link to="/front-desk" className="card desk-mini">
            <div>
              <span className="eyebrow">Front desk · today</span>
              <strong>{desk.location}</strong>
            </div>
            <div className="desk-stats">
              <span><strong>{desk.booked}</strong> booked</span>
              <span><strong>{desk.checkedIn}</strong> in</span>
              {desk.blocks > 0 && <span><strong>{desk.blocks}</strong> blocked</span>}
            </div>
          </Link>
        )}
      </div>

      {admin.length > 0 && (
        <div className="desktop-only">
          <h2 className="section-title">Admin</h2>
          <div className="shortcut-grid">
            {admin.map((r) => (
              <Link key={r.path} to={r.path} className="shortcut is-admin">
                <strong>{r.launcher!.title}</strong>
                <span>{r.launcher!.description}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!canBook && admin.length === 0 && !desk && (
        <div className="card">
          <h2>Nothing here yet</h2>
          <p className="muted">You don't have access to any apps yet. Ask an administrator for access.</p>
        </div>
      )}
    </section>
  );
}
