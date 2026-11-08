import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Calendar from '../components/Calendar';
import {
  confirmFreeCheckout,
  createHolds,
  getAvailability,
  myBookingTerms,
  quoteBooking,
  type BookingTerms,
  type Quote,
  releaseGroup,
  releaseHold,
  startCheckout,
  type Availability,
} from '../data/bookings';
import { listLocations, type Location } from '../data/locations';
import { WaiverModal } from '../components/WaiverSign';
import { currentWaiver, isWaiverRequired, myWaiverStatus, type Waiver } from '../data/waiver';
import { useAuth } from '../auth/AuthContext';
import { formatDate, formatMoney, formatTime, isoDate } from '../utils/time';
import { CheckIcon, ChevronLeft } from '../components/Icons';
import LocationPicker from '../components/LocationPicker';

const LENGTHS = [
  { slots: 1, label: '30 min' },
  { slots: 2, label: '1 hr' },
  { slots: 3, label: '1.5 hr' },
  { slots: 4, label: '2 hr' },
  { slots: 6, label: '3 hr' },
];
const MAX_DATES = 12;

type Mode = 'dates' | 'weekly';

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Per date: the slot index where the chosen start time falls, or null. */
type Plan = { date: string; avail: Availability; index: number | null };

export default function Book() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = useMemo(() => isoDate(new Date()), []);
  const [terms, setTerms] = useState<BookingTerms | null>(null);
  const windowDays = terms?.booking_window_days ?? 30;
  const lastDay = useMemo(() => addDays(today, windowDays), [today, windowDays]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [mode, setMode] = useState<Mode>('dates');
  const [picked, setPicked] = useState<string[]>([today]); // "dates" mode
  const [pickedTouched, setPickedTouched] = useState(false); // first tap replaces the default "today"
  const [repeatStart, setRepeatStart] = useState(today); // "weekly" mode
  const [weeks, setWeeks] = useState(4);
  const [length, setLength] = useState(2);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [availByDate, setAvailByDate] = useState<Record<string, Availability>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [several, setSeveral] = useState(false); // show the calendar / repeat-weekly options
  const [anyCage, setAnyCage] = useState(true); // "Any open cage" picks one for you
  const prefill = useRef<{ date: string; time: string; len: number; res: string[] } | null>(null);

  const weeklyDates = useMemo(
    () => Array.from({ length: weeks }, (_, k) => addDays(repeatStart, 7 * k)).filter((d) => d <= lastDay),
    [repeatStart, weeks, lastDay],
  );
  const dates = useMemo(
    () => (mode === 'weekly' ? weeklyDates : [...picked].sort()),
    [mode, weeklyDates, picked],
  );

  // Coming back from Stripe without paying: release the held slots straight away.
  useEffect(() => {
    const group = params.get('cancelled_group');
    const single = params.get('cancelled');
    if (group || single) {
      (group ? releaseGroup(group) : releaseHold(single!)).catch(() => undefined);
      setNotice('Payment cancelled. Nothing was booked or charged.');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  // "Book again" links fill everything in: ?loc=&date=&time=&len=&res=
  useEffect(() => {
    const date = params.get('date');
    const time = params.get('time');
    if (!date || !time) return;
    const len = Number(params.get('len')) || 2;
    const res = (params.get('res') ?? '').split(',').filter(Boolean);
    prefill.current = { date, time, len, res };
    if (date >= today) {
      setPicked([date]);
      setPickedTouched(true);
    }
    setLength(len);
    setStartTime(time);
    if (res.length) {
      setSelected(res);
      setAnyCage(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listLocations()
      .then((all) => {
        const active = all.filter((l) => l.is_active);
        setLocations(active);
        const wanted = params.get('loc');
        setLocationId((id) => id || active.find((l) => l.id === wanted)?.id || active[0]?.id || '');
        if (active.length === 0) setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, []);

  // Load availability for any selected date we don't have yet.
  const reload = async (force = false) => {
    if (!locationId) return;
    const missing = force ? dates : dates.filter((d) => !availByDate[d]);
    if (missing.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(missing.map((d) => getAvailability(locationId, d)));
      setAvailByDate((prev) => {
        const next = { ...prev };
        results.forEach((a) => (next[a.date] = a));
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAvailByDate({});
    if (locationId) myBookingTerms(locationId).then(setTerms).catch(() => setTerms(null));
  }, [locationId]);

  // Keep picked dates inside the booking window.
  useEffect(() => {
    setPicked((p) => (p.some((d) => d > lastDay) ? (p.filter((d) => d <= lastDay).length ? p.filter((d) => d <= lastDay) : [today]) : p));
    if (repeatStart > lastDay) setRepeatStart(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDay]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, dates.join(','), Object.keys(availByDate).length === 0]);

  const ready = dates.length > 0 && dates.every((d) => availByDate[d]);
  const closedDates = ready ? dates.filter((d) => availByDate[d].closed) : [];
  const openDates = ready ? dates.filter((d) => !availByDate[d].closed) : [];

  /** Resources free on every open date for the window starting at `time`, or null if the time doesn't work everywhere. */
  const freeFor = (time: string, len: number): { free: string[]; peak: boolean; plans: Plan[] } | null => {
    if (!ready || openDates.length === 0) return null;
    let free: string[] | null = null;
    let peak = false;
    const plans: Plan[] = [];
    for (const d of openDates) {
      const a = availByDate[d];
      const i = a.slots.findIndex((s) => s.time === time);
      if (i < 0 || i + len > a.slots.length) return null;
      for (let k = i; k < i + len; k++) {
        if (a.slots[k].past) return null;
        const here = a.slots[k].free;
        free = free === null ? [...here] : free.filter((id) => here.includes(id));
        if (a.slots[k].peak) peak = true;
      }
      plans.push({ date: d, avail: a, index: i });
    }
    return { free: free ?? [], peak, plans };
  };

  // Every start time that appears on all open dates, in order.
  const allTimes = useMemo(() => {
    if (!ready || openDates.length === 0) return [];
    const sets = openDates.map((d) => availByDate[d].slots.map((s) => s.time));
    return sets[0].filter((t) => sets.every((s) => s.includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, openDates.join(','), availByDate]);

  const startOptions = allTimes
    .map((time) => ({ time, r: freeFor(time, length) }))
    .filter((o) => o.r && o.r.free.length > 0);

  const current = startTime ? freeFor(startTime, length) : null;
  const freeNow = new Set(current?.free ?? []);

  // Drop choices that stop being valid when dates, length or availability change.
  useEffect(() => {
    if (!ready) return;
    if (startTime && !startOptions.some((o) => o.time === startTime)) setStartTime(null);
    setSelected((sel) => sel.filter((id) => freeNow.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, length, startTime, dates.join(','), availByDate]);

  const resources = ready && openDates[0] ? availByDate[openDates[0]].resources : [];
  const prices = ready && openDates[0] ? availByDate[openDates[0]].prices : [];

  /** Estimated price for one resource on one date (member discount applied; included time shown by the quote). */
  const priceFor = (type: string, plan: Plan): number => {
    const p = prices.find((x) => x.type === type);
    if (!p || plan.index === null) return 0;
    let total = 0;
    for (let k = plan.index; k < plan.index + length; k++) {
      total += plan.avail.slots[k].peak && p.peak_cents !== null ? p.peak_cents : p.base_cents;
    }
    const pct = terms?.member ? (type === 'turf' ? terms.turf_discount_pct ?? 0 : terms.cage_discount_pct ?? 0) : 0;
    return Math.round((total * (100 - pct)) / 100);
  };
  const totalFor = (resourceIds: string[]) =>
    (current?.plans ?? []).reduce(
      (sum, plan) => sum + resourceIds.reduce((s, id) => s + priceFor(resources.find((r) => r.id === id)?.type ?? '', plan), 0),
      0,
    );
  const sessions = current?.plans.length ?? 0;
  const slotsFor = (plans: Plan[]) =>
    plans.map((p) => {
      const start = p.avail.slots[p.index!].starts_at;
      return { starts_at: start, ends_at: new Date(new Date(start).getTime() + length * 30 * 60_000).toISOString() };
    });

  // Ask the server for the exact price (included cage time, discounts).
  const quoteKey = current && selected.length ? `${locationId}|${selected.join(',')}|${current.plans.map((p) => p.date).join(',')}|${startTime}|${length}` : '';
  useEffect(() => {
    if (!quoteKey || !current) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = window.setTimeout(async () => {
      try {
        const q = await quoteBooking(locationId, selected, slotsFor(current.plans));
        if (!cancelled) setQuote(q);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const total = quote ? quote.total_cents : totalFor(selected);
  const includedLeft = terms?.member ? Math.max(0, (terms.included_cage_minutes ?? 0) - (terms.included_used_this_month ?? 0)) : 0;

  const endTime = (() => {
    if (!startTime) return null;
    const [h, m] = startTime.split(':').map(Number);
    const mins = h * 60 + m + length * 30;
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  })();

  const toggleDate = (date: string) => {
    if (mode === 'weekly') {
      setRepeatStart(date);
      return;
    }
    if (!pickedTouched) {
      setPickedTouched(true);
      setPicked([date]);
      return;
    }
    setPicked((p) => {
      if (p.includes(date)) return p.length > 1 ? p.filter((d) => d !== date) : p;
      if (p.length >= MAX_DATES) {
        setError(`You can book up to ${MAX_DATES} dates at once.`);
        return p;
      }
      setError(null);
      return [...p, date];
    });
  };

  const removeDate = (date: string) => {
    if (mode === 'weekly') {
      // Switch to a custom list without that week.
      setPicked(weeklyDates.filter((d) => d !== date));
      setMode('dates');
    } else {
      setPicked((p) => (p.length > 1 ? p.filter((d) => d !== date) : p));
    }
  };

  const toggleResource = (id: string) => {
    if (anyCage) {
      setAnyCage(false);
      setSelected([id]);
      return;
    }
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  };

  // Nothing left today (late at night, or closed)? Start on the next day that has times.
  useEffect(() => {
    if (pickedTouched || mode !== 'dates' || !ready || loading || picked.length !== 1) return;
    if (startOptions.length === 0 && picked[0] < addDays(today, 7) && addDays(picked[0], 1) <= lastDay) setPicked([addDays(picked[0], 1)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loading, startOptions.length, picked.join(','), pickedTouched, mode]);

  // "Book again": once times load, go straight to step 2 if the slot is still open.
  useEffect(() => {
    if (!prefill.current || !ready) return;
    if (startTime && startOptions.some((o) => o.time === startTime)) setStep(2);
    prefill.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, startTime, startOptions.length]);

  // "Any open cage": keep one free cage picked.
  const firstFreeCage = resources.find((r) => r.type === 'batting_cage' && freeNow.has(r.id))?.id ?? null;
  useEffect(() => {
    if (step !== 2 || !anyCage) return;
    setSelected(firstFreeCage ? [firstFreeCage] : []);
  }, [step, anyCage, firstFreeCage]);

  const goStep = (n: 1 | 2) => {
    setStep(n);
    window.scrollTo({ top: 0 });
  };


  // Liability waiver: signed once before the first booking (and again when it changes).
  const { user } = useAuth();
  const [waiver, setWaiver] = useState<Waiver | null>(null);
  const [waiverSigned, setWaiverSigned] = useState(true);
  const [askWaiver, setAskWaiver] = useState(false);
  useEffect(() => {
    Promise.all([myWaiverStatus(), currentWaiver()])
      .then(([s, w]) => {
        setWaiver(w);
        setWaiverSigned(!s.required || s.signed);
      })
      .catch(() => undefined);
  }, []);

  const pay = async (justSigned = false) => {
    if (!current || selected.length === 0) return;
    if (!justSigned && !waiverSigned && waiver) {
      setAskWaiver(true);
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const hold = await createHolds(locationId, selected, slotsFor(current.plans));
      if (hold.total_cents === 0) {
        // Fully covered by included cage time: no payment needed.
        await confirmFreeCheckout(hold.group_id);
        navigate(`/bookings?paid=${hold.bookings[0].booking_id}`);
        return;
      }
      try {
        window.location.href = await startCheckout(hold.group_id);
      } catch (err) {
        await releaseGroup(hold.group_id).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      setPaying(false);
      if (isWaiverRequired(err)) {
        // The waiver changed since the page loaded.
        const w = await currentWaiver().catch(() => null);
        if (w) {
          setWaiver(w);
          setWaiverSigned(false);
          setAskWaiver(true);
          return;
        }
      }
      setError((err as Error).message);
      reload(true);
    }
  };

  const cages = resources.filter((r) => r.type === 'batting_cage');
  const turf = resources.filter((r) => r.type === 'turf');
  const lengthLabel = LENGTHS.find((l) => l.slots === length)?.label;
  const stripDays = Array.from({ length: Math.min(windowDays, 30) + 1 }, (_, i) => addDays(today, i));
  const dayLabel = dates.length === 1 ? shortDate(dates[0]) : `${openDates.length || dates.length} dates`;
  const whenLabel = startTime ? `${dayLabel} · ${formatTime(startTime)}–${formatTime(endTime!)}` : dayLabel;
  const firstStart = current?.plans[0] ? current.plans[0].avail.slots[current.plans[0].index!].starts_at : null;
  const freeCancelUntil = firstStart ? new Date(Date.parse(firstStart) - 24 * 3_600_000) : null;
  const included = quote?.total_cents === 0 && selected.length > 0;

  return (
    <section className={`book step-${step}`}>
      {askWaiver && waiver && (
        <WaiverModal
          waiver={waiver}
          defaultName={user?.displayName ?? ''}
          onClose={() => setAskWaiver(false)}
          onSigned={() => {
            setWaiverSigned(true);
            setAskWaiver(false);
            pay(true);
          }}
        />
      )}

      <div className="book-head">
        {step === 2 && (
          <button className="icon-btn back-btn" aria-label="Back to times" onClick={() => goStep(1)}>
            <ChevronLeft />
          </button>
        )}
        <h1>{step === 1 ? 'Book' : 'Pick a cage'}</h1>
        <span className="muted small book-stepnum">Step {step} of 2</span>
      </div>
      {notice && <p className="alert alert-success" role="status">{notice}</p>}

      {step === 1 && (
        <>
          {terms?.member ? (
            <p className="member-banner">
              <span className="chip chip-super">{terms.tier_name}</span>
              {terms.included_cage_minutes ? (
                <span>
                  <strong>{(includedLeft / 60).toString().replace(/\.5$/, '½').replace(/\.0$/, '')} hr</strong> included left this month
                </span>
              ) : terms.cage_discount_pct ? (
                <span>{terms.cage_discount_pct}% off cages</span>
              ) : null}
            </p>
          ) : terms ? (
            <p className="member-banner muted small">
              Members get cage time included and book 90 days out. <Link to="/memberships">See memberships</Link>
            </p>
          ) : null}

          {locations.length > 1 && (
            <LocationPicker className="location-pick" locations={locations} value={locationId} onChange={setLocationId} />
          )}
          {locations.length === 0 && !loading && <p className="muted">No locations are open for booking yet.</p>}

          <div className="book-step">
            <div className="step-row">
              <h2 className="step-title">Day</h2>
              <button className="link-button small" aria-expanded={several} onClick={() => setSeveral((v) => !v)}>
                {several ? 'Just one day' : 'Several days or weekly'}
              </button>
            </div>
            {!several ? (
              <DateStrip days={stripDays} selected={dates} onPick={(d) => {
                setMode('dates');
                setPickedTouched(true);
                setPicked([d]);
              }} />
            ) : (
              <>
                <div className="segmented" role="radiogroup" aria-label="How to pick dates">
                  <button role="radio" aria-checked={mode === 'dates'} className={mode === 'dates' ? 'active' : ''} onClick={() => setMode('dates')}>
                    Pick dates
                  </button>
                  <button
                    role="radio"
                    aria-checked={mode === 'weekly'}
                    className={mode === 'weekly' ? 'active' : ''}
                    onClick={() => {
                      setRepeatStart([...picked].sort()[0] ?? today);
                      setMode('weekly');
                    }}
                  >
                    Repeat weekly
                  </button>
                </div>
                <div className="date-picker">
                  <Calendar
                    selected={mode === 'weekly' ? [repeatStart] : picked}
                    marked={mode === 'weekly' ? weeklyDates : []}
                    onSelect={toggleDate}
                    min={today}
                    max={lastDay}
                  />
                  <div className="date-side">
                    {mode === 'weekly' ? (
                      <div className="stack">
                        <p className="muted small">
                          Every <strong>{new Date(`${repeatStart}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}</strong>{' '}
                          starting {shortDate(repeatStart)}. Tap the calendar to change the first day.
                        </p>
                        <div className="stepper" aria-label="Number of weeks">
                          <button className="icon-btn" aria-label="Fewer weeks" disabled={weeks <= 2} onClick={() => setWeeks((w) => w - 1)}>−</button>
                          <span><strong>{weeks}</strong> weeks</span>
                          <button className="icon-btn" aria-label="More weeks" disabled={weeks >= MAX_DATES} onClick={() => setWeeks((w) => w + 1)}>+</button>
                        </div>
                        {weeklyDates.length < weeks && (
                          <p className="muted small">Bookings open {windowDays} days ahead, so this stops at {shortDate(weeklyDates[weeklyDates.length - 1])}.</p>
                        )}
                      </div>
                    ) : (
                      <p className="muted small">Tap days to book several (up to {MAX_DATES}). Same time and cages on each.</p>
                    )}
                    <div className="date-chips">
                      {dates.map((d) => (
                        <span key={d} className={`chip date-chip${closedDates.includes(d) ? ' chip-warn' : ''}`}>
                          {shortDate(d)}
                          {dates.length > 1 && (
                            <button aria-label={`Remove ${shortDate(d)}`} onClick={() => removeDate(d)}>×</button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
            {closedDates.length > 0 && (
              <p className="alert alert-error small">
                Closed on {closedDates.map((d) => `${shortDate(d)}${availByDate[d].closed_reason && availByDate[d].closed_reason !== 'Closed' ? ` (${availByDate[d].closed_reason})` : ''}`).join(', ')}.
                {openDates.length > 0 ? ' Those dates will be skipped.' : ' Pick another day.'}
              </p>
            )}
          </div>

          <div className="book-step">
            <h2 className="step-title">How long</h2>
            <div className="segmented segmented-fill" role="radiogroup" aria-label="Length">
              {LENGTHS.map((l) => (
                <button key={l.slots} role="radio" aria-checked={length === l.slots} className={length === l.slots ? 'active' : ''} onClick={() => setLength(l.slots)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="book-step">
            <div className="step-row">
              <h2 className="step-title">Start time</h2>
              {startOptions.some((o) => o.r!.peak) && <span className="muted small"><span className="peak-dot" /> peak pricing</span>}
            </div>
            {!ready || loading ? (
              <div className="page-loading">Loading times…</div>
            ) : openDates.length === 0 ? (
              <p className="muted">Closed on {dates.length > 1 ? 'those days' : 'that day'}. Pick another day.</p>
            ) : startOptions.length === 0 ? (
              <p className="muted">
                No {lengthLabel} time works on {openDates.length > 1 ? `all ${openDates.length} dates` : 'that day'}. Try a shorter length
                {openDates.length > 1 ? ', fewer dates' : ''} or another day.
              </p>
            ) : (
              <>
                <div className="time-grid">
                  {startOptions.map((o) => (
                    <button
                      key={o.time}
                      className={`time-chip${startTime === o.time ? ' active' : ''}${o.r!.peak ? ' peak' : ''}`}
                      aria-pressed={startTime === o.time}
                      onClick={() => setStartTime(o.time)}
                    >
                      {formatTime(o.time)}
                      <span className="time-chip-sub">{o.r!.free.length <= 2 ? `${o.r!.free.length} left` : `${o.r!.free.length} open`}</span>
                    </button>
                  ))}
                </div>
                {openDates.length > 1 && <p className="muted small">Showing times open on all {openDates.length} dates.</p>}
              </>
            )}
          </div>
        </>
      )}

      {step === 2 && current && startTime && (
        <>
          <button className="when-summary" onClick={() => goStep(1)}>
            <span>
              <strong>{whenLabel}</strong>
              <span className="muted"> · {lengthLabel}</span>
            </span>
            <span className="when-edit">Edit</span>
          </button>

          {cages.length > 0 && (
            <button className={`any-cage${anyCage ? ' active' : ''}`} aria-pressed={anyCage} onClick={() => setAnyCage(true)} disabled={!firstFreeCage}>
              <span className="radio-dot" aria-hidden="true" />
              <span className="any-cage-text">
                <strong>Any open cage</strong>
                <span className="muted small">
                  {firstFreeCage ? `We’ll give you ${resources.find((r) => r.id === firstFreeCage)?.name} · ${formatMoney(totalFor([firstFreeCage]))}` : 'No cages free then'}
                </span>
              </span>
            </button>
          )}

          <div className="book-step">
            <h2 className="step-title">Or choose{turf.length ? ' cages or turf' : ' cages'}</h2>
            {sessions > 1 && <p className="muted small">Price shown is for all {sessions} dates. Pick one or more.</p>}
            {cages.length > 0 && (
              <div className="resource-grid">
                {cages.map((r) => {
                  const free = freeNow.has(r.id);
                  const on = !anyCage && selected.includes(r.id);
                  return (
                    <button key={r.id} className={`resource-tile${on ? ' active' : ''}`} disabled={!free} aria-pressed={on} onClick={() => toggleResource(r.id)}>
                      <strong>{r.name.replace(/^Cage\s*/i, '') || r.name}</strong>
                      <span>{free ? formatMoney(totalFor([r.id])) : 'Taken'}</span>
                      <span className="tile-label">{/^Cage/i.test(r.name) ? 'Cage' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {turf.map((r) => {
              const free = freeNow.has(r.id);
              const on = selected.includes(r.id);
              return (
                <button key={r.id} className={`resource-tile wide${on ? ' active' : ''}`} disabled={!free} aria-pressed={on} onClick={() => toggleResource(r.id)}>
                  <strong>{r.name}</strong>
                  <span>{free ? `${formatMoney(totalFor([r.id]))} · whole turf area` : 'Taken'}</span>
                </button>
              );
            })}
          </div>

          {selected.length > 0 && (
            <ul className={`session-list price-list${quoting ? ' is-loading' : ''}`}>
              {current.plans.map((p, i) => {
                const q = quote?.dates[i];
                return (
                  <li key={p.date}>
                    <span>
                      {formatDate(p.date)}
                      {q && q.included_minutes > 0 && <span className="included-tag">{q.included_minutes / 60} hr included</span>}
                    </span>
                    <span className="muted">
                      {formatMoney(q ? q.total_cents : selected.reduce((s, id) => s + priceFor(resources.find((r) => r.id === id)?.type ?? '', p), 0))}
                    </span>
                  </li>
                );
              })}
              {quote && quote.discount_cents > 0 && (
                <li className="savings">
                  <span>Member savings</span>
                  <span>−{formatMoney(quote.discount_cents)}</span>
                </li>
              )}
              <li className="price-total">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </li>
            </ul>
          )}

          <p className="book-assure muted small">
            {waiverSigned && <span><CheckIcon size={16} /> Waiver signed</span>}
            {freeCancelUntil && freeCancelUntil.getTime() > Date.now() && (
              <span>
                <CheckIcon size={16} /> Free cancellation until{' '}
                {freeCancelUntil.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </p>
        </>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="book-bar show">
        {step === 1 ? (
          <>
            <div>
              <span className="book-bar-main">{whenLabel}</span>
              <span className="muted small">{startTime ? lengthLabel : 'Pick a start time'}</span>
            </div>
            <button className="btn btn-primary btn-lg" disabled={!startTime || !current} onClick={() => goStep(2)}>
              Next
            </button>
          </>
        ) : (
          <>
            <div>
              <strong>{formatMoney(total)}</strong>
              <span className="muted small">
                {included ? 'Covered by included time' : `${selected.length} ${selected.length === 1 ? 'spot' : 'spots'}${sessions > 1 ? ` · ${sessions} dates` : ''}`}
              </span>
            </div>
            <button className="btn btn-primary btn-lg" disabled={!selected.length || paying} onClick={() => pay()}>
              {paying ? (included ? 'Booking…' : 'Opening payment…') : included ? 'Confirm' : 'Pay & book'}
            </button>
          </>
        )}
      </div>

      {step === 2 && (
        <p className="muted small book-policy">
          {!terms?.member && <>You can book up to {windowDays} days ahead. </>}Cancel from <Link to="/bookings">My bookings</Link>: 24+ hours ahead for a full
          refund, or less than 24 hours ahead for 50%.
        </p>
      )}
    </section>
  );
}

/** Swipeable row of days; the selected day scrolls into view. */
function DateStrip({ days, selected, onPick }: { days: string[]; selected: string[]; onPick(d: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [selected.join(',')]);
  let lastMonth = '';
  return (
    <div className="date-strip" ref={ref} role="group" aria-label="Day">
      {days.map((d) => {
        const dt = new Date(`${d}T12:00:00`);
        const month = dt.toLocaleDateString(undefined, { month: 'short' });
        const showMonth = month !== lastMonth;
        lastMonth = month;
        const on = selected.includes(d);
        return (
          <button
            key={d}
            className={`day-chip${on ? ' active' : ''}`}
            aria-pressed={on}
            aria-label={dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            onClick={() => onPick(d)}
          >
            <span className="day-chip-wd">{dt.toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <strong>{dt.getDate()}</strong>
            <span className="day-chip-mo">{showMonth ? month : ' '}</span>
          </button>
        );
      })}
    </div>
  );
}
