import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cancelBooking, fmtInZone, myBookings, refundPreview, type MyBooking } from '../data/bookings';
import { formatMoney } from '../utils/time';
import RescheduleDialog from '../components/RescheduleDialog';
import Modal from '../components/Modal';
import { directionsUrl, downloadIcs } from '../utils/ics';
import { CalendarIcon, ChevronRight, PinIcon, PlusIcon, RepeatIcon } from '../components/Icons';

function when(b: MyBooking) {
  const tz = b.location.timezone;
  const day = fmtInZone(b.starts_at, tz, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (iso: string) => fmtInZone(iso, tz, { hour: 'numeric', minute: '2-digit' });
  return { day, time: `${t(b.starts_at)} – ${t(b.ends_at)}` };
}

export default function MyBookings() {
  const [params, setParams] = useSearchParams();
  const paidId = params.get('paid');
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await myBookings();
      setBookings(list);
      setError(null);
      return list;
    } catch (err) {
      setError((err as Error).message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Back from Stripe: the webhook confirms the booking a moment later, so poll briefly.
  useEffect(() => {
    let timer: number | undefined;
    const tick = async () => {
      const list = await load();
      const b = list.find((x) => x.id === paidId);
      if (!paidId) return;
      if (b?.status === 'confirmed') {
        setNotice("You're booked! See you at The Yard.");
        setParams({}, { replace: true });
        return;
      }
      if (polls.current++ < 15) timer = window.setTimeout(tick, 2000);
      else {
        setNotice('Payment received. Your booking will show as confirmed in a moment; refresh if it doesn’t.');
        setParams({}, { replace: true });
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [paidId, load, setParams]);

  const [changing, setChanging] = useState<MyBooking | null>(null);

  const cancel = async (b: MyBooking) => {
    setOpenId(null);
    setBusy(b.id);
    setError(null);
    try {
      const refunded = await cancelBooking(b.id);
      setNotice(refunded > 0 ? `Cancelled. ${formatMoney(refunded)} is on its way back to your card (5–10 business days).` : 'Cancelled.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  const upcoming = bookings
    .filter((b) => b.status === 'confirmed' && new Date(b.ends_at).getTime() > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const pending = bookings.filter((b) => b.status === 'pending' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() > now);
  const past = bookings.filter((b) => !upcoming.includes(b) && !pending.includes(b));

  const waiting = Boolean(paidId) && !notice;
  const open = bookings.find((b) => b.id === openId) ?? null;

  // Group by day (in each booking's location time).
  const groups: { day: string; rel: string; items: MyBooking[] }[] = [];
  for (const b of tab === 'upcoming' ? upcoming : past) {
    const { day } = when(b);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(b);
    else groups.push({ day, rel: tab === 'upcoming' ? relDay(b) : '', items: [b] });
  }

  return (
    <section className="my-bookings">
      <div className="page-header">
        <h1>My bookings</h1>
        <Link to="/book" className="btn btn-primary desktop-only">Book a cage</Link>
      </div>
      <div className="segmented segmented-fill" role="tablist" aria-label="Bookings">
        <button role="tab" aria-selected={tab === 'upcoming'} className={tab === 'upcoming' ? 'active' : ''} onClick={() => setTab('upcoming')}>
          Upcoming{upcoming.length ? ` · ${upcoming.length}` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'past'} className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>
          Past & cancelled
        </button>
      </div>

      {waiting && <p className="alert alert-success" role="status">Payment received. Confirming your booking…</p>}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <div className="booking-groups">
          {tab === 'upcoming' && pending.map((b) => (
            <div key={b.id} className="booking-row is-pending">
              <span className="booking-bar" aria-hidden="true" />
              <span className="booking-row-text">
                <strong>{when(b).day} · {when(b).time}</strong>
                <span className="muted small">Payment not finished · this hold expires soon. Book again to pay.</span>
              </span>
            </div>
          ))}

          {groups.length === 0 && (
            <div className="card muted empty-bookings">
              {tab === 'upcoming' ? <>No upcoming bookings. <Link to="/book">Book a cage or the turf</Link>.</> : 'Nothing here yet.'}
            </div>
          )}

          {groups.map((g) => (
            <div key={g.day} className="booking-group">
              <h2 className="list-title">{g.day}{g.rel && <span className="muted"> · {g.rel}</span>}</h2>
              <div className="list-group">
                {g.items.map((b) => {
                  const muted = tab === 'past';
                  const status = b.status === 'cancelled' ? 'Cancelled' : b.status === 'expired' ? 'Not paid' : muted ? 'Completed' : null;
                  const included = (b.items ?? []).some((i) => (i.included_minutes ?? 0) > 0);
                  return (
                    <button key={b.id} className={`booking-row${muted ? ' is-muted' : ''}`} onClick={() => setOpenId(b.id)} disabled={busy === b.id}>
                      <span className="booking-bar" aria-hidden="true" />
                      <span className="booking-row-text">
                        <strong className="booking-time">{when(b).time}</strong>
                        <span className="muted small">
                          {(b.items ?? []).map((i) => i.name).join(', ')} · {b.location.name} ·{' '}
                          {busy === b.id ? 'Cancelling…' : included && b.total_cents === 0 ? 'Included' : formatMoney(b.total_cents)}
                          {status && ` · ${status}`}
                          {b.status === 'cancelled' && b.refund_cents > 0 && ` · refunded ${formatMoney(b.refund_cents)}`}
                        </span>
                      </span>
                      <ChevronRight />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {tab === 'upcoming' && upcoming.length > 0 && <p className="muted small center">Tap a session to change, add to your calendar or cancel it.</p>}
        </div>
      )}

      <Link to="/book" className="fab mobile-only-flex" aria-label="Book a cage">
        <PlusIcon size={26} />
      </Link>

      {open && (
        <BookingSheet
          b={open}
          onClose={() => setOpenId(null)}
          onChange={() => {
            setOpenId(null);
            setChanging(open);
          }}
          onCancel={() => cancel(open)}
        />
      )}
      {changing && (
        <RescheduleDialog
          booking={changing}
          onClose={() => setChanging(null)}
          onDone={async (msg) => {
            setChanging(null);
            setNotice(msg);
            await load();
          }}
        />
      )}
    </section>
  );
}

function relDay(b: MyBooking): string {
  const tz = b.location.timezone;
  const day = (d: Date) => Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)}T00:00:00Z`);
  const diff = Math.round((day(new Date(b.starts_at)) - day(new Date())) / 86_400_000);
  return diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`;
}

/** Bottom sheet with everything you can do to one booking. */
function BookingSheet({ b, onClose, onChange, onCancel }: { b: MyBooking; onClose(): void; onChange(): void; onCancel(): void }) {
  const [confirming, setConfirming] = useState(false);
  const { day, time } = when(b);
  const now = Date.now();
  const started = Date.parse(b.starts_at) <= now;
  const upcoming = b.status === 'confirmed' && Date.parse(b.ends_at) > now;
  const own = b.kind !== 'walk_in';
  const canChange = upcoming && own && Date.parse(b.starts_at) - now > 24 * 3_600_000;
  const canCancel = upcoming && own && !started;
  const refund = refundPreview(b);
  const full = Date.parse(b.starts_at) - now >= 24 * 3_600_000;
  const usedIncluded = (b.items ?? []).some((i) => (i.included_minutes ?? 0) > 0);
  const changeBy = new Date(Date.parse(b.starts_at) - 24 * 3_600_000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <Modal title={`${day}, ${time}`} onClose={onClose}>
      <p className="sheet-sub muted">
        {(b.items ?? []).map((i) => i.name).join(', ')} · {b.location.name} · {b.total_cents ? `Paid ${formatMoney(b.total_cents)}` : 'Included'}
      </p>
      <div className="list-group sheet-actions">
        {canChange && (
          <button className="list-row" onClick={onChange}>
            <CalendarIcon />
            <span className="list-label">Change date or time<span className="muted small">Same price or less · until {changeBy}</span></span>
            <ChevronRight />
          </button>
        )}
        {upcoming && (
          <button className="list-row" onClick={() => downloadIcs(b)}>
            <CalendarIcon />
            <span className="list-label">Add to calendar<span className="muted small">Apple, Google or Outlook</span></span>
            <ChevronRight />
          </button>
        )}
        <a className="list-row" href={directionsUrl(b.location)} target="_blank" rel="noreferrer">
          <PinIcon />
          <span className="list-label">Directions<span className="muted small">{b.location.address || b.location.name}</span></span>
          <ChevronRight />
        </a>
        {!upcoming && b.items?.every((i) => i.resource_id) && (
          <Link className="list-row" to="/book">
            <RepeatIcon />
            <span className="list-label">Book another session</span>
            <ChevronRight />
          </Link>
        )}
      </div>
      {upcoming && !own && <p className="muted small">Booked at the front desk. Ask the desk to change or cancel it.</p>}
      {canCancel &&
        (confirming ? (
          <div className="cancel-confirm">
            <p>
              {refund > 0 ? (
                full
                  ? <>You’ll get a full refund of <strong>{formatMoney(refund)}</strong>.</>
                  : <>It’s less than 24 hours away, so you’ll get a 50% refund of <strong>{formatMoney(refund)}</strong>.</>
              ) : usedIncluded ? (
                <>The included time goes back to this month’s balance.</>
              ) : (
                <>Nothing was paid, so there’s nothing to refund.</>
              )}
              {refund > 0 && usedIncluded && ' Included time goes back to this month’s balance.'}
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep it</button>
              <button className="btn btn-danger" onClick={onCancel}>Yes, cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-danger-ghost btn-block cancel-btn" onClick={() => setConfirming(true)}>
            <span>Cancel booking</span>
            <span className="small">{refund > 0 ? `${full ? 'Full' : '50%'} refund of ${formatMoney(refund)}` : usedIncluded ? 'Included time comes back' : 'Nothing to refund'}</span>
          </button>
        ))}
    </Modal>
  );
}
