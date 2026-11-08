import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getHours,
  getPeak,
  getPrices,
  listClosures,
  listLocations,
  listResources,
  type Closure,
  type DayHours,
  type Location,
  type PeakDay,
  type Price,
  type Resource,
} from '../data/locations';
import { listTiers, type Tier } from '../data/memberships';
import { WEEKDAYS, formatDate, formatMoney, formatTime, isoDate } from '../utils/time';

interface LocationInfo {
  location: Location;
  resources: Resource[];
  hours: DayHours[];
  peak: PeakDay[];
  prices: Price[];
  closures: Closure[];
}

/** Groups consecutive weekdays (Mon → Sun) that share the same text: "Mon–Fri", "Sat–Sun". */
function groupDays<T>(rows: T[], weekday: (r: T) => number, label: (r: T) => string | null): { days: string; text: string }[] {
  const ordered = WEEKDAYS.map((w) => ({ w, row: rows.find((r) => weekday(r) === w.value) }));
  const out: { from: string; to: string; text: string }[] = [];
  for (const { w, row } of ordered) {
    const text = row ? label(row) : null;
    if (text === null) continue;
    const last = out[out.length - 1];
    const prevIdx = WEEKDAYS.findIndex((x) => x.short === last?.to);
    if (last && last.text === text && prevIdx === WEEKDAYS.indexOf(w) - 1) last.to = w.short;
    else out.push({ from: w.short, to: w.short, text });
  }
  return out.map((g) => ({
    days: g.from === 'Mon' && g.to === 'Sun' ? 'Every day' : g.from === g.to ? g.from : `${g.from}–${g.to}`,
    text: g.text,
  }));
}

const STEPS = [
  { title: 'Create a free account', text: 'Sign up with a username and email. It takes a minute.' },
  { title: 'Pick your time', text: 'Choose a cage or the turf, a date and a start time. Sessions run in 30-minute blocks, up to 4 hours.' },
  { title: 'Pay online', text: 'Checkout is secure through Stripe. Book several dates or a weekly session in one go.' },
  { title: 'Show up and hit', text: 'Check in at the front desk and get your work in.' },
];

export default function About() {
  const { user } = useAuth();
  const [info, setInfo] = useState<LocationInfo[] | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);

  useEffect(() => {
    const today = isoDate(new Date());
    listLocations()
      .then((locs) =>
        Promise.all(
          locs
            .filter((l) => l.is_active)
            .map(async (location) => {
              const [resources, hours, peak, prices, closures] = await Promise.all([
                listResources(location.id),
                getHours(location.id),
                getPeak(location.id),
                getPrices(location.id),
                listClosures(location.id, today),
              ]);
              return { location, resources: resources.filter((r) => r.is_active), hours, peak, prices, closures: closures.slice(0, 4) };
            }),
        ),
      )
      .then(setInfo)
      .catch(() => setInfo([]));
    listTiers().then(setTiers).catch(() => undefined);
  }, []);

  return (
    <section className="about">
      <div className="about-hero">
        <p className="eyebrow">About</p>
        <h1>The Yard</h1>
        <p className="motto">
          Train. Improve. <span>Compete.</span>
        </p>
        <p className="lead">
          The Yard is an indoor baseball and softball practice facility. Rent a batting cage or the turf by the half
          hour, train on your own schedule in any weather, and leave better than you came in.
        </p>
      </div>

      <h2 className="section-title">Locations</h2>
      {info === null && <p className="muted">Loading…</p>}
      {info?.length === 0 && <p className="muted">Location details are coming soon.</p>}
      <div className="about-locations">
        {info?.map(({ location, resources, hours, peak, prices, closures }) => {
          const cages = resources.filter((r) => r.type === 'batting_cage').length;
          const turf = resources.filter((r) => r.type === 'turf').length;
          const hourGroups = groupDays(hours, (h) => h.weekday, (h) => (h.is_closed ? 'Closed' : `${formatTime(h.opens_at)} – ${formatTime(h.closes_at)}`));
          const peakGroups = groupDays(peak, (p) => p.weekday, (p) => (p.enabled ? `${formatTime(p.starts_at)} – ${formatTime(p.ends_at)}` : null));
          const price = (t: Price['resource_type']) => prices.find((p) => p.resource_type === t);
          return (
            <article key={location.id} className="card about-location">
              <h3>{location.name}</h3>
              {location.address && <p className="muted">{location.address}</p>}
              <div className="facility-stats">
                {cages > 0 && <div><strong>{cages}</strong><span>batting {cages === 1 ? 'cage' : 'cages'}</span></div>}
                {turf > 0 && <div><strong>{turf}</strong><span>indoor turf {turf === 1 ? 'area' : 'areas'}</span></div>}
              </div>

              <div className="about-cols">
                <div>
                  <h4>Hours</h4>
                  <dl className="hours-list">
                    {hourGroups.map((g) => (
                      <div key={g.days}><dt>{g.days}</dt><dd>{g.text}</dd></div>
                    ))}
                  </dl>
                  {closures.length > 0 && (
                    <>
                      <h4>Upcoming closures</h4>
                      <ul className="plain-list">
                        {closures.map((c) => (
                          <li key={c.id}>
                            {formatDate(c.date)}{' '}
                            <span className="muted">
                              {c.all_day ? '· Closed' : `· ${formatTime(c.opens_at!)} – ${formatTime(c.closes_at!)}`}
                              {c.reason && ` · ${c.reason}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <div>
                  <h4>Prices</h4>
                  <dl className="hours-list">
                    {(['batting_cage', 'turf'] as const).map((t) => {
                      const p = price(t);
                      if (!p) return null;
                      return (
                        <div key={t}>
                          <dt>{t === 'turf' ? 'Turf' : 'Batting cage'}</dt>
                          <dd>
                            {formatMoney(p.base_cents)} <span className="muted">/ 30 min</span>
                            {p.peak_cents != null && p.peak_cents !== p.base_cents && (
                              <><br /><span className="muted">{formatMoney(p.peak_cents)} at peak times</span></>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  {peakGroups.length > 0 && (
                    <p className="muted small">
                      Peak: {peakGroups.map((g) => `${g.days} ${g.text}`).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <h2 className="section-title">How booking works</h2>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="card">
            <span className="step-num">{i + 1}</span>
            <h3>{s.title}</h3>
            <p className="muted">{s.text}</p>
          </li>
        ))}
      </ol>

      {tiers.length > 0 && (
        <>
          <h2 className="section-title">Memberships</h2>
          <div className="about-tiers">
            {tiers.map((t) => {
              const b = t.benefits[0];
              return (
                <div key={t.id} className="card">
                  <h3>{t.name}</h3>
                  <p className="tier-price">
                    {formatMoney(t.monthly_price_cents)}<span className="muted">/month</span>
                  </p>
                  <p className="muted small">{t.scope === 'all' ? 'All locations' : t.location?.name}</p>
                  {b && (
                    <ul className="plain-list small">
                      {b.included_cage_minutes > 0 && <li>{+(b.included_cage_minutes / 60).toFixed(1)} hrs of cage time every month</li>}
                      {b.cage_discount_pct > 0 && <li>{b.cage_discount_pct}% off extra cage time</li>}
                      {b.turf_discount_pct > 0 && <li>{b.turf_discount_pct}% off the turf</li>}
                      <li>Book up to {b.booking_window_days} days ahead</li>
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            Members can book up to 90 days ahead; everyone else up to 30. Included hours reset each month and don’t roll over.{' '}
            <Link to="/memberships">See memberships</Link>
          </p>
        </>
      )}

      <h2 className="section-title">Cancellations</h2>
      <div className="card policy">
        <div>
          <strong>24+ hours before</strong>
          <span>Full refund</span>
        </div>
        <div>
          <strong>Less than 24 hours</strong>
          <span>50% refund</span>
        </div>
        <p className="muted small">Cancel from My bookings. Refunds go back to the card you paid with and usually show up in 5–10 business days.</p>
      </div>

      <div className="about-cta card">
        <h2>Ready to get your reps in?</h2>
        {user ? (
          <Link to="/book" className="btn btn-primary btn-lg">Book a cage</Link>
        ) : (
          <div className="hero-actions">
            <Link to="/signup" className="btn btn-primary btn-lg">Create an account</Link>
            <Link to="/signin" className="btn btn-ghost btn-lg">Sign in</Link>
          </div>
        )}
      </div>
    </section>
  );
}
