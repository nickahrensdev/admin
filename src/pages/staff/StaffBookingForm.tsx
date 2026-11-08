import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { fmtInZone, getAvailability, type Availability, type Quote } from '../../data/bookings';
import {
  createStaffBooking,
  findCustomers,
  staffQuote,
  type SlotInput,
  type StaffCustomer,
  type StaffLocation,
} from '../../data/staff';
import { formatMoney } from '../../utils/time';
import { addDays } from './FrontDesk';
import { staffRecordWaiver } from '../../data/waiver';

export interface FormPrefill {
  kind: 'walk_in' | 'block';
  date: string;
  resourceId?: string;
  startIso?: string;
}

interface Props {
  location: StaffLocation;
  prefill: FormPrefill;
  today: string;
  onClose(): void;
  onCreated(message: string, date: string): Promise<void>;
}

const SLOT_MS = 30 * 60 * 1000;
const MAX_UNITS = 24; // 12 hours
const REASONS = ['Lesson', 'Team rental', 'Maintenance', 'Event', 'Other'];

export default function StaffBookingForm({ location, prefill, today, onClose, onCreated }: Props) {
  const tz = location.timezone;
  const [kind, setKind] = useState(prefill.kind);
  const [date, setDate] = useState(prefill.date < today ? today : prefill.date);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [start, setStart] = useState<string>(prefill.startIso ?? '');
  const [units, setUnits] = useState(2);
  const [weeks, setWeeks] = useState(1);
  const [resources, setResources] = useState<string[]>(prefill.resourceId ? [prefill.resourceId] : []);

  const [who, setWho] = useState<'customer' | 'guest'>('customer');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffCustomer[]>([]);
  const [customer, setCustomer] = useState<StaffCustomer | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [payment, setPayment] = useState<'cash' | 'card' | 'comp'>('cash');

  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Availability for the chosen date.
  useEffect(() => {
    let live = true;
    setAvail(null);
    getAvailability(location.id, date)
      .then((a) => live && setAvail(a))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [location.id, date]);

  const now = Date.now();
  const startable = useMemo(
    () => (avail?.slots ?? []).filter((s) => Date.parse(s.starts_at) + SLOT_MS > now),
    [avail, now],
  );

  // Keep the start time valid for the chosen date.
  useEffect(() => {
    if (!avail) return;
    if (!startable.some((s) => s.starts_at === start)) {
      const wanted = prefill.startIso && startable.find((s) => s.starts_at === prefill.startIso);
      setStart(wanted ? wanted.starts_at : (startable[0]?.starts_at ?? ''));
    }
  }, [avail, startable, start, prefill.startIso]);

  const startIdx = avail?.slots.findIndex((s) => s.starts_at === start) ?? -1;
  const maxUnits = startIdx < 0 || !avail ? 0 : Math.min(MAX_UNITS, avail.slots.length - startIdx);
  const effUnits = Math.min(units, Math.max(maxUnits, 1));
  const span = startIdx < 0 || !avail ? [] : avail.slots.slice(startIdx, startIdx + effUnits);

  const isFree = (rid: string) => span.length > 0 && span.every((s) => s.free.includes(rid));

  // Drop picks that aren't free for the new time.
  useEffect(() => {
    if (!avail) return;
    setResources((rs) => rs.filter((rid) => span.every((s) => s.free.includes(rid))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail, start, effUnits]);

  const firstSlot: SlotInput | null = start
    ? { starts_at: start, ends_at: new Date(Date.parse(start) + effUnits * SLOT_MS).toISOString() }
    : null;

  // Customer search (debounced).
  useEffect(() => {
    if (kind !== 'walk_in' || who !== 'customer' || customer || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      findCustomers(location.id, query).then(setResults).catch((e: Error) => setError(e.message));
    }, 250);
    return () => window.clearTimeout(t);
  }, [kind, who, customer, query, location.id]);

  // Price preview for walk-ins.
  useEffect(() => {
    setQuote(null);
    if (kind !== 'walk_in' || !firstSlot || resources.length === 0) return;
    let live = true;
    staffQuote(location.id, resources, [firstSlot], who === 'customer' ? (customer?.id ?? null) : null)
      .then((q) => live && setQuote(q))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, location.id, resources.join(','), firstSlot?.starts_at, firstSlot?.ends_at, who, customer?.id]);

  const time = (iso: string) => fmtInZone(iso, tz, { hour: 'numeric', minute: '2-digit' });
  const dur = (u: number) => (u % 2 ? `${Math.floor(u / 2) ? `${Math.floor(u / 2)} hr ` : ''}30 min` : `${u / 2} hr`);

  const toggle = (rid: string) => setResources((rs) => (rs.includes(rid) ? rs.filter((x) => x !== rid) : [...rs, rid]));

  const submit = async () => {
    setError(null);
    if (!firstSlot || !avail) return setError('Pick a start time.');
    if (resources.length === 0) return setError('Pick at least one cage or the turf.');
    if (kind === 'walk_in' && who === 'customer' && !customer) return setError('Pick a customer, or switch to Guest.');
    if (kind === 'walk_in' && who === 'guest' && !guestName.trim()) return setError('Enter the guest’s name.');
    if (kind === 'block' && reason === 'Other' && !details.trim()) return setError('Say what the time is blocked for.');

    setSaving(true);
    try {
      // Same time of day on each repeat week.
      const slots: SlotInput[] = [firstSlot];
      const time0 = avail.slots[startIdx].time;
      for (let k = 1; k < weeks; k++) {
        const d = addDays(date, 7 * k);
        const a = await getAvailability(location.id, d);
        const s = a.slots.find((x) => x.time === time0);
        const last = s && a.slots[a.slots.indexOf(s) + effUnits - 1];
        if (!s || !last) {
          throw new Error(`${new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })} is closed or has shorter hours. Use fewer weeks.`);
        }
        slots.push({ starts_at: s.starts_at, ends_at: new Date(Date.parse(s.starts_at) + effUnits * SLOT_MS).toISOString() });
      }

      const note = kind === 'block' ? (details.trim() ? `${reason}: ${details.trim()}` : reason) : details.trim() || undefined;
      const res = await createStaffBooking({
        locationId: location.id,
        kind,
        resourceIds: resources,
        slots,
        userId: kind === 'walk_in' && who === 'customer' ? customer?.id : null,
        guestName: kind === 'walk_in' && who === 'guest' ? guestName.trim() : undefined,
        guestPhone: kind === 'walk_in' && who === 'guest' ? guestPhone.trim() || undefined : undefined,
        note,
        paymentMethod: kind === 'walk_in' ? payment : undefined,
      });

      const names = avail.resources.filter((r) => resources.includes(r.id)).map((r) => r.name).join(', ');
      const weeksText = slots.length > 1 ? ` for ${slots.length} weeks` : '';
      let message: string;
      if (kind === 'block') {
        message = `Blocked ${names}${weeksText}.`;
      } else {
        const person = who === 'customer' ? customer!.display_name : guestName.trim();
        message =
          payment === 'comp' || res.total_cents === 0
            ? `Booked ${names} for ${person}${weeksText}. Nothing to collect.`
            : `Booked ${names} for ${person}${weeksText}. Collect ${formatMoney(res.total_cents)} by ${payment}.`;
      }
      await onCreated(message, date);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={kind === 'walk_in' ? 'Walk-in booking' : 'Block time'} onClose={onClose} wide>
      <div className="segmented" role="radiogroup" aria-label="Type">
        <button role="radio" aria-checked={kind === 'walk_in'} className={kind === 'walk_in' ? 'active' : ''} onClick={() => setKind('walk_in')}>Walk-in</button>
        <button role="radio" aria-checked={kind === 'block'} className={kind === 'block' ? 'active' : ''} onClick={() => setKind('block')}>Block time</button>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Start</span>
          <select value={start} onChange={(e) => setStart(e.target.value)} disabled={!startable.length}>
            {startable.length === 0 && <option value="">{avail ? (avail.closed ? 'Closed' : 'No times left') : 'Loading…'}</option>}
            {startable.map((s) => (
              <option key={s.starts_at} value={s.starts_at}>{time(s.starts_at)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Length</span>
          <select value={effUnits} onChange={(e) => setUnits(Number(e.target.value))} disabled={!maxUnits}>
            {Array.from({ length: Math.max(maxUnits, 1) }, (_, i) => i + 1).map((u) => (
              <option key={u} value={u}>{dur(u)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Repeat</span>
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={1}>Just this day</option>
            {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>Weekly × {n}</option>
            ))}
          </select>
        </label>
      </div>
      {firstSlot && (
        <p className="muted small">
          {time(firstSlot.starts_at)} – {time(firstSlot.ends_at)}
          {weeks > 1 && ` every ${new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long' })} for ${weeks} weeks`}
        </p>
      )}

      <h3 className="form-section">Cages / turf</h3>
      {avail ? (
        <div className="resource-grid">
          {avail.resources.map((r) => {
            const free = isFree(r.id);
            const num = r.name.match(/\d+$/)?.[0];
            return (
              <button
                key={r.id}
                type="button"
                className={`resource-tile${resources.includes(r.id) ? ' active' : ''}`}
                disabled={!free}
                aria-pressed={resources.includes(r.id)}
                onClick={() => toggle(r.id)}
              >
                {num ? <><span className="tile-label">Cage</span><strong>{num}</strong></> : <strong>{r.name}</strong>}
                <span>{free ? 'Free' : 'Taken'}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">Loading…</p>
      )}

      {kind === 'walk_in' ? (
        <>
          <h3 className="form-section">Customer</h3>
          <div className="segmented" role="radiogroup" aria-label="Customer type">
            <button role="radio" aria-checked={who === 'customer'} className={who === 'customer' ? 'active' : ''} onClick={() => setWho('customer')}>Has an account</button>
            <button role="radio" aria-checked={who === 'guest'} className={who === 'guest' ? 'active' : ''} onClick={() => setWho('guest')}>Guest</button>
          </div>
          {who === 'customer' ? (
            customer ? (
              <div className="picked-customer">
                <div>
                  <strong>{customer.display_name}</strong> <span className="muted">@{customer.username}</span>
                  {customer.member_tier && <span className="chip">{customer.member_tier} member</span>}
                  {customer.waiver_ok === false && (
                    <span className="waiver-warn">
                      No waiver on file.{' '}
                      <button
                        className="link-button"
                        onClick={() =>
                          staffRecordWaiver(customer.id, customer.display_name)
                            .then(() => setCustomer({ ...customer, waiver_ok: true }))
                            .catch((e: Error) => setError(e.message))
                        }
                      >
                        They signed a paper waiver
                      </button>
                    </span>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setCustomer(null); setQuery(''); }}>Change</button>
              </div>
            ) : (
              <div className="customer-search">
                <input
                  type="search"
                  placeholder="Search name, username or email"
                  aria-label="Search customers"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
                {results.length > 0 && (
                  <ul className="search-results">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => { setCustomer(c); setResults([]); }}>
                          <strong>{c.display_name}</strong> <span className="muted">@{c.username} · {c.email}</span>
                          {c.member_tier && <span className="chip">{c.member_tier}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && results.length === 0 && <p className="muted small">No matches yet. Not signed up? Use Guest.</p>}
              </div>
            )
          ) : (
            <div className="form-grid">
              <label className="field">
                <span>Name</span>
                <input value={guestName} maxLength={80} onChange={(e) => setGuestName(e.target.value)} autoComplete="off" />
              </label>
              <label className="field">
                <span>Phone (optional)</span>
                <input type="tel" value={guestPhone} maxLength={30} onChange={(e) => setGuestPhone(e.target.value)} autoComplete="off" />
              </label>
            </div>
          )}

          <h3 className="form-section">Payment</h3>
          <div className="segmented" role="radiogroup" aria-label="Payment">
            {(['cash', 'card', 'comp'] as const).map((p) => (
              <button key={p} role="radio" aria-checked={payment === p} className={payment === p ? 'active' : ''} onClick={() => setPayment(p)}>
                {p === 'cash' ? 'Cash' : p === 'card' ? 'Card' : 'Comp (free)'}
              </button>
            ))}
          </div>
          {quote && (
            <p className="quote-line">
              {payment === 'comp' ? (
                <>Total <strong>{formatMoney(0)}</strong> <span className="muted">(comped {formatMoney(quote.total_cents)})</span></>
              ) : (
                <>
                  Total <strong>{formatMoney(quote.total_cents)}</strong>
                  {weeks > 1 && <span className="muted"> per week · about {formatMoney(quote.total_cents * weeks)} for {weeks} weeks</span>}
                  {quote.member && quote.discount_cents > 0 && <span className="muted"> · member pricing saves {formatMoney(quote.discount_cents)}</span>}
                  {quote.dates[0]?.included_minutes > 0 && <span className="muted"> · {quote.dates[0].included_minutes / 60} hr included</span>}
                </>
              )}
            </p>
          )}
          <label className="field">
            <span>Note (optional)</span>
            <input value={details} maxLength={150} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. paid for 2 kids" />
          </label>
        </>
      ) : (
        <>
          <h3 className="form-section">Reason</h3>
          <div className="segmented" role="radiogroup" aria-label="Reason">
            {REASONS.map((r) => (
              <button key={r} role="radio" aria-checked={reason === r} className={reason === r ? 'active' : ''} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <label className="field">
            <span>Details {reason === 'Other' ? '' : '(optional)'}</span>
            <input value={details} maxLength={150} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Coach Mike, Tigers 12U, pitching machine repair" />
          </label>
          <p className="muted small">Customers can’t book blocked cages or turf. Remove the block any time from the schedule.</p>
        </>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving || !start}>
          {saving ? 'Saving…' : kind === 'walk_in' ? 'Book walk-in' : 'Block time'}
        </button>
      </div>
    </Modal>
  );
}
