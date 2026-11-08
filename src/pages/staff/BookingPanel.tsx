import { useState } from 'react';
import Modal from '../../components/Modal';
import { fmtInZone, refundPreview } from '../../data/bookings';
import { bookingWho, paymentLabel, setAttendance, staffCancel, type RefundChoice, type StaffBooking, type StaffDay } from '../../data/staff';
import { formatMoney } from '../../utils/time';
import { kindLabel } from './FrontDesk';

interface Props {
  booking: StaffBooking;
  day: StaffDay;
  onClose(): void;
  /** Reloads the day; an optional message is shown at the top of the page. */
  onChanged(message?: string): Promise<void>;
}

export default function BookingPanel({ booking: b, day, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState<RefundChoice>(b.kind === 'block' ? 'none' : 'full');

  const tz = day.timezone;
  const names = new Map(day.resources.map((r) => [r.id, r.name]));
  const when = `${fmtInZone(b.starts_at, tz, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtInZone(b.starts_at, tz, {
    hour: 'numeric',
    minute: '2-digit',
  })} – ${fmtInZone(b.ends_at, tz, { hour: 'numeric', minute: '2-digit' })}`;
  const isPerson = b.kind !== 'block';
  const canAct = day.can_manage && b.status !== 'cancelled';
  const policy = refundPreview(b);
  const refundAmount = refund === 'full' ? b.total_cents : refund === 'policy' ? policy : 0;
  const paidAtDesk = b.payment_method === 'cash' || b.payment_method === 'card';

  const run = async (fn: () => Promise<string | undefined>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await fn();
      await onChanged(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const attendance = (state: 'checked_in' | 'no_show' | 'none') =>
    run(async () => {
      await setAttendance(b.id, state);
      return undefined;
    });

  const cancel = async () => {
    const ok = await run(async () => {
      const res = await staffCancel(b.id, refund);
      if (b.kind === 'block') return 'Blocked time removed.';
      if (res.refund_cents === 0) return 'Booking cancelled. No refund.';
      return res.refunded_online
        ? `Booking cancelled. ${formatMoney(res.refund_cents)} refunded to their card (shows in 5–10 days).`
        : `Booking cancelled. Give back ${formatMoney(res.refund_cents)} at the desk.`;
    });
    if (ok) onClose();
  };

  return (
    <Modal title={b.kind === 'block' ? 'Blocked time' : bookingWho(b)} onClose={onClose}>
      <dl className="detail-list">
        <div><dt>When</dt><dd>{when}</dd></div>
        <div><dt>{b.resource_ids.length > 1 ? 'Cages / turf' : 'Cage / turf'}</dt><dd>{b.resource_ids.map((id) => names.get(id) ?? 'Removed').join(', ')}</dd></div>
        {b.kind === 'block' ? (
          <div><dt>Reason</dt><dd>{b.note}</dd></div>
        ) : (
          <>
            {b.customer ? (
              <div>
                <dt>Customer</dt>
                <dd>
                  {b.customer.display_name} <span className="muted">@{b.customer.username}</span>
                  <br />
                  <a href={`mailto:${b.customer.email}`}>{b.customer.email}</a>
                  {b.member_tier && <><br /><span className="chip">{b.member_tier} member</span></>}
                </dd>
              </div>
            ) : (
              <div>
                <dt>Guest</dt>
                <dd>
                  {b.guest_name}
                  {b.guest_phone && <><br /><a href={`tel:${b.guest_phone}`}>{b.guest_phone}</a></>}
                </dd>
              </div>
            )}
            <div>
              <dt>Payment</dt>
              <dd>
                {formatMoney(b.total_cents)} · {paymentLabel(b)}
                {b.included_minutes > 0 && <span className="muted"> · {b.included_minutes / 60} hr included</span>}
                {b.refund_cents > 0 && <><br /><span className="muted">Refunded {formatMoney(b.refund_cents)}</span></>}
              </dd>
            </div>
            <div><dt>Status</dt><dd>{kindLabel(b)}</dd></div>
          </>
        )}
        {b.created_by && <div><dt>Added by</dt><dd>{b.created_by}</dd></div>}
      </dl>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {canAct && isPerson && b.status === 'confirmed' && !cancelling && (
        <div className="panel-actions">
          {b.checked_in_at || b.no_show ? (
            <button className="btn btn-ghost" disabled={busy} onClick={() => attendance('none')}>
              {b.no_show ? 'Undo no-show' : 'Undo check-in'}
            </button>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => attendance('checked_in')}>Check in</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => attendance('no_show')}>No-show</button>
            </>
          )}
        </div>
      )}

      {canAct && !cancelling && (
        <button className="btn btn-danger-ghost" disabled={busy} onClick={() => setCancelling(true)}>
          {b.kind === 'block' ? 'Remove blocked time' : b.status === 'pending' ? 'Release this hold' : 'Cancel booking'}
        </button>
      )}

      {cancelling && (
        <div className="cancel-box">
          {b.kind !== 'block' && b.status === 'confirmed' && b.total_cents > 0 && (
            <fieldset className="refund-options">
              <legend>Refund</legend>
              <label>
                <input type="radio" name="refund" checked={refund === 'full'} onChange={() => setRefund('full')} />
                Full refund · {formatMoney(b.total_cents)}
              </label>
              <label>
                <input type="radio" name="refund" checked={refund === 'policy'} onChange={() => setRefund('policy')} />
                Cancellation policy · {formatMoney(policy)} <span className="muted">(full 24h+ ahead, else half)</span>
              </label>
              <label>
                <input type="radio" name="refund" checked={refund === 'none'} onChange={() => setRefund('none')} />
                No refund
              </label>
              {refundAmount > 0 && (
                <p className="muted small">
                  {b.paid_online
                    ? 'Refunded to the card they paid with.'
                    : paidAtDesk
                      ? `Paid at the desk: give ${formatMoney(refundAmount)} back by cash or card.`
                      : ''}
                </p>
              )}
            </fieldset>
          )}
          <p className="small">
            {b.kind === 'block'
              ? 'These cages / turf become bookable again.'
              : b.status === 'pending'
                ? 'They’re in the middle of paying. Releasing frees the time; if they still pay, they’re refunded automatically.'
                : 'The time becomes bookable again.'}
          </p>
          <div className="form-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setCancelling(false)}>Keep it</button>
            <button className="btn btn-danger" disabled={busy} onClick={cancel}>
              {busy ? 'Working…' : b.kind === 'block' ? 'Remove' : 'Cancel booking'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
