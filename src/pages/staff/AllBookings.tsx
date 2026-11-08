import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fmtInZone } from '../../data/bookings';
import {
  listBookings, staffLocations,
  type BookingKind, type BookingList, type BookingListStatus, type ListedBooking, type StaffLocation,
} from '../../data/staff';
import LocationPicker from '../../components/LocationPicker';
import { ChevronLeft, ChevronRight } from '../../components/Icons';
import { formatMoney } from '../../utils/time';
import { initials } from '../../utils/initials';

const PAGE = 50;
const STATUSES: { value: BookingListStatus; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No-shows' },
  { value: 'all', label: 'All' },
];
const KINDS: { value: '' | BookingKind; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'online', label: 'Booked online' },
  { value: 'walk_in', label: 'Walk-ins' },
  { value: 'block', label: 'Blocked time' },
];

const localDate = (b: ListedBooking) => new Intl.DateTimeFormat('en-CA', { timeZone: b.location.timezone }).format(new Date(b.starts_at));
const time = (b: ListedBooking, iso: string) => fmtInZone(iso, b.location.timezone, { hour: 'numeric', minute: '2-digit' });
const hrs = (h: number) => `${+h.toFixed(1)} hr`;

function who(b: ListedBooking): string {
  if (b.kind === 'block') return b.note || 'Blocked time';
  return b.customer?.display_name || b.guest_name || 'Guest';
}

function badges(b: ListedBooking): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  if (b.status === 'cancelled') out.push({ text: 'Cancelled', tone: 'bad' });
  else if (b.no_show) out.push({ text: 'No-show', tone: 'bad' });
  else if (b.checked_in_at) out.push({ text: 'Checked in', tone: 'good' });
  else if (b.status === 'pending') out.push({ text: 'Awaiting payment', tone: 'warn' });
  if (b.kind === 'walk_in') out.push({ text: 'Walk-in', tone: 'walkin' });
  if (b.kind === 'block') out.push({ text: 'Blocked', tone: 'muted' });
  if (b.included_minutes > 0) out.push({ text: 'Included', tone: 'info' });
  return out;
}

function money(b: ListedBooking): string {
  if (b.kind === 'block') return '';
  const paid = b.total_cents - b.refund_cents;
  if (b.refund_cents > 0) return `${formatMoney(paid)} (refunded ${formatMoney(b.refund_cents)})`;
  return b.total_cents ? formatMoney(b.total_cents) : b.included_minutes ? 'Included' : 'Free';
}

function csv(rows: ListedBooking[]): string {
  const head = ['Date', 'Start', 'End', 'Location', 'Customer', 'Username', 'Email', 'Phone', 'Type', 'Status', 'Cages/turf', 'Paid', 'Refunded', 'Payment', 'Checked in', 'No-show', 'Note'];
  const q = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((b) => [
    localDate(b), time(b, b.starts_at), time(b, b.ends_at), b.location.name, who(b), b.customer?.username ?? '', b.customer?.email ?? '', b.guest_phone ?? '',
    b.kind === 'walk_in' ? 'Walk-in' : b.kind === 'block' ? 'Blocked' : 'Online', b.no_show ? 'No-show' : b.status,
    (b.resources ?? []).join(' + '), (b.total_cents / 100).toFixed(2), (b.refund_cents / 100).toFixed(2),
    b.paid_online ? 'online' : b.payment_method ?? '', b.checked_in_at ? 'yes' : '', b.no_show ? 'yes' : '', b.note ?? '',
  ].map(q).join(','));
  return [head.join(','), ...lines].join('\r\n');
}

/** Every booking across days and locations, filterable, or one customer's history (?user=). */
export default function AllBookings() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('user');
  const status = (params.get('status') as BookingListStatus) || (userId ? 'all' : 'upcoming');
  const kind = (params.get('kind') as BookingKind) || '';
  const loc = params.get('loc') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const q = params.get('q') || '';

  const [locations, setLocations] = useState<StaffLocation[]>([]);
  const [search, setSearch] = useState(q);
  const [data, setData] = useState<BookingList | null>(null);
  const [rows, setRows] = useState<ListedBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    staffLocations().then(setLocations).catch(() => undefined);
  }, []);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    if (search === q) return;
    const t = window.setTimeout(() => set({ q: search || null }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filters = useMemo(
    () => ({ location: loc, user: userId, status, kind: kind || null, from, to, search: userId ? null : q }),
    [loc, userId, status, kind, from, to, q],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    listBookings(filters, PAGE, 0)
      .then((d) => {
        if (!live) return;
        setData(d);
        setRows(d.bookings);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filters]);

  const loadMore = async () => {
    setMore(true);
    try {
      const d = await listBookings(filters, PAGE, rows.length);
      setRows((r) => [...r, ...d.bookings]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMore(false);
    }
  };

  const download = async () => {
    setExporting(true);
    try {
      const d = await listBookings(filters, 2000, 0);
      const url = URL.createObjectURL(new Blob([csv(d.bookings)], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookings-${data?.user?.username ?? status}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // Group by day in each booking's own time zone.
  const groups: { day: string; label: string; items: ListedBooking[] }[] = [];
  for (const b of rows) {
    const day = localDate(b);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(b);
    else groups.push({ day, label: fmtInZone(b.starts_at, b.location.timezone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), items: [b] });
  }
  const u = data?.user;
  const multiLoc = locations.length > 1;

  return (
    <section className="all-bookings">
      {userId ? (
        <>
          <Link to="/admin/bookings" className="back-link"><ChevronLeft size={18} /> All bookings</Link>
          {u && (
            <div className="card customer-card">
              <div className="customer-head">
                <span className="avatar avatar-lg" aria-hidden="true">{initials(u.display_name)}</span>
                <div className="customer-who">
                  <h1>{u.display_name}</h1>
                  <span className="muted small">@{u.username} · <a href={`mailto:${u.email}`}>{u.email}</a></span>
                  <span className="customer-chips">
                    {u.membership ? (
                      <span className="chip chip-super">{u.membership.tier}{u.membership.status === 'past_due' ? ' · past due' : u.membership.cancel_at_period_end ? ' · ending' : ''}</span>
                    ) : (
                      <span className="chip">Not a member</span>
                    )}
                    {u.waiver_signed !== null && (
                      <span className={`chip ${u.waiver_signed ? 'chip-ok' : 'chip-warn'}`}>{u.waiver_signed ? 'Waiver signed' : 'No waiver'}</span>
                    )}
                  </span>
                </div>
              </div>
              <div className="customer-stats">
                <Stat label="Upcoming" value={String(u.stats.upcoming)} />
                <Stat label="Completed" value={String(u.stats.completed)} />
                <Stat label="Hours" value={hrs(u.stats.hours)} />
                <Stat label="Spent" value={formatMoney(u.stats.spent_cents)} />
                <Stat label="No-shows" value={String(u.stats.no_shows)} />
                <Stat label="Cancelled" value={String(u.stats.cancelled)} />
              </div>
              <p className="muted small customer-foot">
                Customer since {new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                {u.stats.last_visit && ` · last checked in ${new Date(u.stats.last_visit).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="page-header">
          <div>
            <h1>All bookings</h1>
            <p className="muted">Every booking across days{multiLoc ? ' and locations' : ''}. Tap a name to see that customer’s history.</p>
          </div>
        </div>
      )}

      <div className="lb-filters">
        {!userId && (
          <input
            className="search"
            type="search"
            placeholder="Search name, email, phone or note"
            aria-label="Search bookings"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <div className="filter-chips" role="radiogroup" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s.value} role="radio" aria-checked={status === s.value} className={`filter-chip${status === s.value ? ' active' : ''}`}
              onClick={() => set({ status: s.value === (userId ? 'all' : 'upcoming') ? null : s.value })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="lb-filter-row">
          {multiLoc && (
            <LocationPicker locations={[{ id: '', name: 'All locations' }, ...locations]} value={loc} onChange={(v) => set({ loc: v || null })} />
          )}
          <select className="time-select" aria-label="Type" value={kind} onChange={(e) => set({ kind: e.target.value || null })}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <label className="lb-date">
            <span className="muted small">From</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => set({ from: e.target.value || null })} />
          </label>
          <label className="lb-date">
            <span className="muted small">To</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value || null })} />
          </label>
          {(from || to || kind || loc || q) && (
            <button className="link-button small" onClick={() => { setSearch(''); set({ from: null, to: null, kind: null, loc: null, q: null }); }}>Clear filters</button>
          )}
        </div>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {data && (
        <div className="lb-summary">
          <span>
            <strong>{data.total.toLocaleString()}</strong> {data.total === 1 ? 'booking' : 'bookings'}
            {data.summary.hours > 0 && <> · {hrs(data.summary.hours)}</>}
            {data.summary.paid_cents > 0 && <> · {formatMoney(data.summary.paid_cents - data.summary.refund_cents)} paid</>}
            {data.summary.refund_cents > 0 && <> · {formatMoney(data.summary.refund_cents)} refunded</>}
          </span>
          {data.total > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={download} disabled={exporting}>{exporting ? 'Preparing…' : 'Download CSV'}</button>
          )}
        </div>
      )}

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card muted">No bookings match.</div>
      ) : (
        <div className="booking-groups">
          {groups.map((g) => (
            <div key={g.day} className="booking-group">
              <h2 className="list-title">{g.label}</h2>
              <div className="list-group">
                {g.items.map((b) => (
                  <div key={b.id} className={`lb-row${b.status === 'cancelled' || b.no_show ? ' is-muted' : ''} kind-${b.kind}`}>
                    <span className="booking-bar" aria-hidden="true" />
                    <div className="lb-body">
                      <div className="lb-line1">
                        <strong className="lb-time">{time(b, b.starts_at)} – {time(b, b.ends_at)}</strong>
                        {b.customer && !userId ? (
                          <Link to={`/admin/bookings?user=${b.customer.id}`} className="lb-who">{who(b)}</Link>
                        ) : userId ? null : (
                          <span className="lb-who">{who(b)}</span>
                        )}
                      </div>
                      <span className="muted small">
                        {(b.resources ?? []).join(', ')}
                        {multiLoc && ` · ${b.location.name}`}
                        {money(b) && ` · ${money(b)}`}
                        {b.kind === 'walk_in' && b.guest_phone && ` · ${b.guest_phone}`}
                      </span>
                      {badges(b).length > 0 && (
                        <span className="lb-badges">
                          {badges(b).map((x) => <span key={x.text} className={`lb-badge is-${x.tone}`}>{x.text}</span>)}
                        </span>
                      )}
                    </div>
                    <Link
                      to={`/front-desk?loc=${b.location.id}&date=${localDate(b)}&booking=${b.id}`}
                      className="lb-open"
                      aria-label={`Open ${who(b)}, ${g.label} ${time(b, b.starts_at)} in the front desk`}
                    >
                      <ChevronRight />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data && rows.length < data.total && (
            <button className="btn btn-ghost btn-block lb-more" onClick={loadMore} disabled={more}>
              {more ? 'Loading…' : `Show more (${(data.total - rows.length).toLocaleString()} left)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="customer-stat">
      <strong>{value}</strong>
      <span className="muted small">{label}</span>
    </div>
  );
}
