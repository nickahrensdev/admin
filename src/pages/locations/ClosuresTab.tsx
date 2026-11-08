import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { addClosures, deleteClosure, listClosures, type Closure } from '../../data/locations';
import { closureImpact, staffCancel, type AffectedBooking } from '../../data/staff';
import { formatMoney } from '../../utils/time';
import TimeSelect from '../../components/TimeSelect';
import { formatDate, formatTime, isoDate, upcomingHolidays } from '../../utils/time';

export default function ClosuresTab({ locationId }: { locationId: string }) {
  const today = isoDate(new Date());
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClosures(await listClosures(locationId, today));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [locationId, today]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (c: Closure) => {
    if (!window.confirm(`Remove the closure on ${formatDate(c.date)}?`)) return;
    try {
      await deleteClosure(c.id);
      setNotice(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const added = (msg: string) => {
    setNotice(msg);
    load();
  };

  return (
    <div className="stack">
      <AddClosureForm locationId={locationId} today={today} onAdded={added} />
      <HolidayPicker locationId={locationId} existing={closures} onAdded={added} />

      <div className="card stack">
        <h2>Upcoming closures</h2>
        {notice && <p className="alert alert-success" role="status">{notice}</p>}
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : closures.length === 0 ? (
          <p className="muted">No upcoming closures. The location follows its weekly hours every day.</p>
        ) : (
          <ul className="closure-list">
            {closures.map((c) => (
              <li key={c.id} className="closure-row">
                <div>
                  <span className="list-title">{formatDate(c.date)}</span>
                  <span className="muted small">
                    {c.all_day ? 'Closed all day' : `Open ${formatTime(c.opens_at!)} – ${formatTime(c.closes_at!)} only`}
                    {c.reason && ` · ${c.reason}`}
                  </span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(c)} aria-label={`Remove closure on ${formatDate(c.date)}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddClosureForm({ locationId, today, onAdded }: { locationId: string; today: string; onAdded(msg: string): void }) {
  const [date, setDate] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [opensAt, setOpensAt] = useState('10:00');
  const [closesAt, setClosesAt] = useState('14:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<AffectedBooking[] | null>(null);
  const [cancelThem, setCancelThem] = useState(true);

  // Who already booked into the hours being closed.
  useEffect(() => {
    setAffected(null);
    if (!date || (!allDay && closesAt <= opensAt)) return;
    let live = true;
    closureImpact(locationId, [date], allDay, opensAt, closesAt).then((a) => live && setAffected(a)).catch(() => live && setAffected([]));
    return () => {
      live = false;
    };
  }, [locationId, date, allDay, opensAt, closesAt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const hit = affected ?? [];
    if (hit.length && cancelThem && !window.confirm(`Add the closure and cancel ${hit.length} ${hit.length === 1 ? 'booking' : 'bookings'} with a full refund?`)) return;
    setSaving(true);
    setError(null);
    try {
      await addClosures(locationId, [{ date, all_day: allDay, opens_at: opensAt, closes_at: closesAt, reason }]);
      let msg = `Added ${formatDate(date)}.`;
      if (hit.length && cancelThem) {
        let done = 0;
        let refunded = 0;
        const failed: string[] = [];
        for (const b of hit) {
          try {
            const r = await staffCancel(b.id, 'full');
            done++;
            refunded += r.refund_cents;
          } catch {
            failed.push(b.who);
          }
        }
        msg += ` Cancelled ${done} ${done === 1 ? 'booking' : 'bookings'} and refunded ${formatMoney(refunded)}.`;
        if (failed.length) msg += ` Couldn’t cancel: ${failed.join(', ')}. Do these from the front desk.`;
      } else if (hit.length) {
        msg += ` ${hit.length} ${hit.length === 1 ? 'booking is' : 'bookings are'} still on the schedule; sort them out at the front desk.`;
      }
      onAdded(msg);
      setDate('');
      setReason('');
      setAllDay(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div>
        <h2>Add a closure</h2>
        <p className="muted small">Close for a day, or open with special hours, without changing the weekly schedule.</p>
      </div>
      <div className="closure-form">
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Reason</span>
          <input type="text" maxLength={80} placeholder="e.g. Staff training" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Closure type">
        <button type="button" role="radio" aria-checked={allDay} className={allDay ? 'active' : ''} onClick={() => setAllDay(true)}>
          Closed all day
        </button>
        <button type="button" role="radio" aria-checked={!allDay} className={!allDay ? 'active' : ''} onClick={() => setAllDay(false)}>
          Special hours
        </button>
      </div>
      {!allDay && (
        <div className="time-range">
          <span className="muted">Open</span>
          <TimeSelect label="Opens" value={opensAt} onChange={setOpensAt} />
          <span className="muted">to</span>
          <TimeSelect label="Closes" value={closesAt} onChange={setClosesAt} />
        </div>
      )}
      {affected && affected.length > 0 && (
        <div className="closure-impact">
          <p>
            <strong>{affected.length} {affected.length === 1 ? 'booking' : 'bookings'}</strong> {allDay ? 'that day' : 'outside those hours'}:
          </p>
          <ul>
            {affected.map((b) => (
              <li key={b.id}>
                {new Date(b.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {b.who}
                <span className="muted"> · {(b.resources ?? []).join(', ')}{b.total_cents ? ` · ${formatMoney(b.total_cents)}` : ''}</span>
              </li>
            ))}
          </ul>
          <label className="check-line">
            <input type="checkbox" checked={cancelThem} onChange={(e) => setCancelThem(e.target.checked)} />
            Cancel them and refund in full (they get a cancellation email)
          </label>
        </div>
      )}
      {affected && affected.length === 0 && date && <p className="muted small">No bookings are affected.</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving || !date}>
          {saving ? 'Adding…' : 'Add closure'}
        </button>
      </div>
    </form>
  );
}

function HolidayPicker({ locationId, existing, onAdded }: { locationId: string; existing: Closure[]; onAdded(msg: string): void }) {
  const [open, setOpen] = useState(false);
  const holidays = useMemo(() => upcomingHolidays(), []);
  const taken = useMemo(() => new Set(existing.map((c) => c.date)), [existing]);
  const available = holidays.filter((h) => !taken.has(h.date));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setSelected(new Set(available.filter((h) => !/Eve/.test(h.name)).map((h) => h.date)));
    setError(null);
    setOpen(true);
  };

  const toggle = (date: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const picks = available.filter((h) => selected.has(h.date));
      await addClosures(locationId, picks.map((h) => ({ date: h.date, all_day: true, reason: h.name })));
      setOpen(false);
      onAdded(`Added ${picks.length} holiday${picks.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="card holiday-cta">
        <div>
          <h2>Holidays</h2>
          <p className="muted small">Close for common US holidays in the next 12 months in one step.</p>
        </div>
        <button className="btn btn-ghost" onClick={start} disabled={available.length === 0}>
          {available.length === 0 ? 'All added' : 'Add holidays'}
        </button>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h2>Close on these holidays</h2>
      <ul className="check-list">
        {available.map((h) => (
          <li key={h.date}>
            <label className="role-option">
              <input type="checkbox" checked={selected.has(h.date)} onChange={() => toggle(h.date)} />
              <span>
                <strong>{h.name}</strong>
                <span className="muted"> — {formatDate(h.date)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving || selected.size === 0}>
          {saving ? 'Adding…' : `Add ${selected.size} closure${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
