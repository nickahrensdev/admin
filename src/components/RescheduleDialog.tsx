import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import {
  fmtInZone,
  getAvailability,
  previewReschedule,
  rescheduleBooking,
  type Availability,
  type MyBooking,
  type ReschedulePlan,
} from '../data/bookings';
import { formatMoney } from '../utils/time';

const SLOT_MS = 30 * 60 * 1000;

function todayIn(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Customer: pick a new date and start time for a booking (same length). */
export default function RescheduleDialog({ booking: b, onClose, onDone }: { booking: MyBooking; onClose(): void; onDone(message: string): void }) {
  const tz = b.location.timezone;
  const today = todayIn(tz);
  const units = Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / SLOT_MS);
  const need = useMemo(() => {
    const n: Record<string, number> = {};
    for (const i of b.items ?? []) n[i.type] = (n[i.type] ?? 0) + 1;
    return n;
  }, [b.items]);

  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(b.starts_at)));
  const [avail, setAvail] = useState<Availability | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReschedulePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setAvail(null);
    setStart(null);
    setPlan(null);
    getAvailability(b.location.id, date)
      .then((a) => live && setAvail(a))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [b.location.id, date]);

  // Start times where enough cages/turf of the right kind are free for the whole session.
  const starts = useMemo(() => {
    if (!avail) return [];
    const typeOf = new Map(avail.resources.map((r) => [r.id, r.type as string]));
    return avail.slots
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => {
        if (Date.parse(s.starts_at) <= Date.now() || s.starts_at === b.starts_at) return false;
        const span = avail.slots.slice(i, i + units);
        if (span.length < units) return false;
        return Object.entries(need).every(([type, count]) => {
          const free = [...typeOf.entries()].filter(([id, t]) => t === type && span.every((x) => x.free.includes(id)));
          return free.length >= count;
        });
      })
      .map(({ s }) => s);
  }, [avail, units, need, b.starts_at]);

  const pick = async (iso: string) => {
    setStart(iso);
    setPlan(null);
    setError(null);
    try {
      setPlan(await previewReschedule(b.id, iso));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirm = async () => {
    if (!start) return;
    setSaving(true);
    setError(null);
    try {
      const done = await rescheduleBooking(b.id, start);
      const when = `${fmtInZone(done.starts_at, tz, { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtInZone(done.starts_at, tz, { hour: 'numeric', minute: '2-digit' })}`;
      onDone(
        done.refund_cents > 0
          ? `Moved to ${when} (${done.resources.join(', ')}). ${formatMoney(done.refund_cents)} is on its way back to your card.`
          : `Moved to ${when} (${done.resources.join(', ')}).`,
      );
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const t = (iso: string) => fmtInZone(iso, tz, { hour: 'numeric', minute: '2-digit' });
  const hrs = units / 2;

  return (
    <Modal title="Change date or time" onClose={onClose} wide>
      <p className="muted small">
        Same length ({hrs} hr{hrs === 1 ? '' : 's'}). Changes are allowed until 24 hours before your session.
      </p>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} min={today} max={addDays(today, 90)} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>

      <h3 className="form-section">Start time</h3>
      {!avail ? (
        <p className="muted">Loading…</p>
      ) : avail.closed ? (
        <p className="muted">Closed{avail.closed_reason ? `: ${avail.closed_reason}` : ''}.</p>
      ) : starts.length === 0 ? (
        <p className="muted">No open times that day. Try another date.</p>
      ) : (
        <div className="time-grid">
          {starts.map((s) => (
            <button key={s.starts_at} className={`time-chip${s.peak ? ' peak' : ''}${start === s.starts_at ? ' active' : ''}`} onClick={() => pick(s.starts_at)}>
              {t(s.starts_at)}
            </button>
          ))}
        </div>
      )}

      {plan && (
        <div className="switch-cost">
          <strong>
            {fmtInZone(plan.starts_at, tz, { weekday: 'short', month: 'short', day: 'numeric' })}, {t(plan.starts_at)} – {t(plan.ends_at)}
          </strong>
          <span className="small">{plan.resources.join(', ')}</span>
          <span className="muted small">
            {plan.refund_cents > 0 ? `This time costs less: ${formatMoney(plan.refund_cents)} back to your card.` : 'Same price.'}
          </span>
        </div>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Keep my time</button>
        <button className="btn btn-primary" onClick={confirm} disabled={!plan || saving}>{saving ? 'Saving…' : 'Confirm change'}</button>
      </div>
    </Modal>
  );
}
