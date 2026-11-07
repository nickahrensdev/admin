import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { addClosures, deleteClosure, listClosures, type Closure } from '../../data/locations';
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addClosures(locationId, [{ date, all_day: allDay, opens_at: opensAt, closes_at: closesAt, reason }]);
      onAdded(`Added ${formatDate(date)}.`);
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
