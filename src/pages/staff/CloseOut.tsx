import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { fmtInZone } from '../../data/bookings';
import { bookingWho, markPaid, setAttendance, staffDay, type StaffBooking, type StaffDay } from '../../data/staff';
import { toCollect } from '../../utils/desk';
import { formatMoney } from '../../utils/time';
import { addDays } from '../../utils/dates';

interface Props {
  day: StaffDay;
  locationName: string;
  onClose(): void;
  /** Open a booking in the front desk panel. */
  onOpen(id: string): void;
  /** Reload the front desk after a change here. */
  onChanged(): Promise<void>;
}

/** End of day: money in, money still to collect, who didn't show, and tomorrow's start. */
export default function CloseOut({ day, locationName, onClose, onOpen, onChanged }: Props) {
  const [tomorrow, setTomorrow] = useState<StaffDay | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tz = day.timezone;
  const time = (iso: string) => fmtInZone(iso, tz, { hour: 'numeric', minute: '2-digit' });

  useEffect(() => {
    staffDay(day.location_id, addDays(day.date, 1)).then(setTomorrow).catch(() => setTomorrow(null));
  }, [day.location_id, day.date]);

  const live = day.bookings.filter((b) => b.status === 'confirmed' && b.kind !== 'block');
  const sum = (xs: StaffBooking[]) => xs.reduce((s, b) => s + b.total_cents - b.refund_cents, 0);
  const cash = live.filter((b) => b.kind === 'walk_in' && b.payment_method === 'cash' && b.paid_at);
  const card = live.filter((b) => b.kind === 'walk_in' && b.payment_method === 'card' && b.paid_at);
  const online = day.bookings.filter((b) => b.kind === 'online' && (b.status === 'confirmed' || b.status === 'cancelled'));
  const comps = live.filter((b) => b.payment_method === 'comp');
  const collect = live.filter(toCollect);
  const now = Date.now();
  const unmarked = live.filter((b) => Date.parse(b.ends_at) <= now && !b.checked_in_at && !b.no_show);
  const tomorrowLive = (tomorrow?.bookings ?? []).filter((b) => b.status === 'confirmed' && b.kind !== 'block');

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Close out" onClose={onClose}>
      <p className="muted small close-sub">
        {locationName} · {new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })}
      </p>

      <div className="close-grid">
        <div className="close-tile"><span className="muted small">Cash collected</span><strong>{formatMoney(sum(cash))}</strong><span className="muted small">{cash.length} walk-in{cash.length === 1 ? '' : 's'}</span></div>
        <div className="close-tile"><span className="muted small">Card at desk</span><strong>{formatMoney(sum(card))}</strong><span className="muted small">{card.length} walk-in{card.length === 1 ? '' : 's'}</span></div>
        <div className="close-tile"><span className="muted small">Paid online</span><strong>{formatMoney(sum(online))}</strong><span className="muted small">after refunds</span></div>
        <div className="close-tile"><span className="muted small">Sessions</span><strong>{live.length}</strong><span className="muted small">{live.filter((b) => b.checked_in_at).length} checked in{comps.length ? ` · ${comps.length} comp` : ''}</span></div>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <h3 className="list-title">Still to collect{collect.length ? ` · ${formatMoney(collect.reduce((s, b) => s + b.total_cents, 0))}` : ''}</h3>
      {collect.length === 0 ? (
        <p className="muted small">Nothing. Every walk-in is paid.</p>
      ) : (
        <div className="list-group">
          {collect.map((b) => (
            <div key={b.id} className="close-row">
              <button className="close-who" onClick={() => onOpen(b.id)}>
                <strong>{bookingWho(b)}</strong>
                <span className="muted small">{time(b.starts_at)} · {formatMoney(b.total_cents)} · {b.payment_method === 'card' ? 'card' : 'cash'}</span>
              </button>
              <div className="close-actions">
                <button className="btn btn-primary btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => markPaid(b.id, true, 'cash'))}>Paid cash</button>
                <button className="btn btn-ghost btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => markPaid(b.id, true, 'card'))}>Card</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="list-title">Didn’t check in</h3>
      {unmarked.length === 0 ? (
        <p className="muted small">Everyone who’s finished was checked in or marked.</p>
      ) : (
        <div className="list-group">
          {unmarked.map((b) => (
            <div key={b.id} className="close-row">
              <button className="close-who" onClick={() => onOpen(b.id)}>
                <strong>{bookingWho(b)}</strong>
                <span className="muted small">{time(b.starts_at)} – {time(b.ends_at)}</span>
              </button>
              <div className="close-actions">
                <button className="btn btn-ghost btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => setAttendance(b.id, 'no_show'))}>No-show</button>
                <button className="btn btn-ghost btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => setAttendance(b.id, 'checked_in'))}>They came</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="list-title">Tomorrow</h3>
      {!tomorrow ? (
        <p className="muted small">Loading…</p>
      ) : !tomorrow.opens_at ? (
        <p className="muted small">Closed{tomorrow.closed_reason ? ` · ${tomorrow.closed_reason}` : ''}.</p>
      ) : (
        <>
          <p className="small">
            Opens {time(tomorrow.opens_at)} · <strong>{tomorrowLive.length}</strong> {tomorrowLive.length === 1 ? 'session' : 'sessions'} booked
          </p>
          {tomorrowLive.length > 0 && (
            <ul className="close-next">
              {tomorrowLive.slice(0, 3).map((b) => (
                <li key={b.id}>
                  <strong>{time(b.starts_at)}</strong> {bookingWho(b)}
                  <span className="muted"> · {b.resource_ids.map((id) => tomorrow.resources.find((r) => r.id === id)?.name).join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-ghost" onClick={() => window.print()}>Print</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
