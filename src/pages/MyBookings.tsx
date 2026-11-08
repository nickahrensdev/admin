import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cancelBooking, fmtInZone, myBookings, refundPreview, type MyBooking } from '../data/bookings';
import { formatMoney } from '../utils/time';

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
  const [showPast, setShowPast] = useState(false);
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

  const cancel = async (b: MyBooking) => {
    const refund = refundPreview(b);
    const { day, time } = when(b);
    const msg =
      refund === b.total_cents
        ? `Cancel ${day}, ${time}?\n\nYou'll get a full refund of ${formatMoney(refund)}.`
        : `Cancel ${day}, ${time}?\n\nIt's less than 24 hours away, so you'll get a 50% refund of ${formatMoney(refund)}.`;
    if (!window.confirm(msg)) return;
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

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>My bookings</h1>
        </div>
        <Link to="/book" className="btn btn-primary">Book a cage</Link>
      </div>

      {waiting && <p className="alert alert-success" role="status">Payment received. Confirming your booking…</p>}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <div className="stack">
          {pending.map((b) => (
            <BookingCard key={b.id} b={b} badge="Payment not finished">
              <span className="muted small">This hold expires soon. Book again to pay.</span>
            </BookingCard>
          ))}

          <h2 className="section-title">Upcoming</h2>
          {upcoming.length === 0 && (
            <div className="card muted">
              No upcoming bookings. <Link to="/book">Book a cage or the turf</Link>.
            </div>
          )}
          {upcoming.map((b) => {
            const started = new Date(b.starts_at).getTime() <= now;
            return (
              <BookingCard key={b.id} b={b}>
                {!started && (
                  <button className="btn btn-ghost btn-sm" disabled={busy === b.id} onClick={() => cancel(b)}>
                    {busy === b.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </BookingCard>
            );
          })}

          {past.length > 0 && (
            <>
              <button className="btn btn-ghost btn-sm past-toggle" onClick={() => setShowPast((s) => !s)}>
                {showPast ? 'Hide' : 'Show'} past & cancelled ({past.length})
              </button>
              {showPast &&
                past.map((b) => (
                  <BookingCard
                    key={b.id}
                    b={b}
                    badge={b.status === 'cancelled' ? 'Cancelled' : b.status === 'expired' ? 'Not paid' : 'Completed'}
                    muted
                  >
                    {b.status === 'cancelled' && b.refund_cents > 0 && (
                      <span className="muted small">Refunded {formatMoney(b.refund_cents)}</span>
                    )}
                  </BookingCard>
                ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function BookingCard({ b, badge, muted, children }: { b: MyBooking; badge?: string; muted?: boolean; children?: React.ReactNode }) {
  const { day, time } = when(b);
  return (
    <div className={`card booking-card${muted ? ' is-muted' : ''}`}>
      <div className="booking-when">
        <span className="booking-day">{day}</span>
        <span className="booking-time">{time}</span>
      </div>
      <div className="booking-what">
        <span className="chips">
          {(b.items ?? []).map((i) => (
            <span key={i.name} className="chip">{i.name}</span>
          ))}
          {(b.items ?? []).some((i) => (i.included_minutes ?? 0) > 0) && <span className="chip chip-super">Included</span>}
        </span>
        <span className="muted small">
          {b.location.name} · {formatMoney(b.total_cents)}
          {badge && ` · ${badge}`}
        </span>
      </div>
      {children && <div className="booking-actions">{children}</div>}
    </div>
  );
}
