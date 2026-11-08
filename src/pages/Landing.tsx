import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { getPrices, listLocations, type Location, type Price } from '../data/locations';
import { getAvailability, type Availability } from '../data/bookings';
import { formatMoney, formatTime } from '../utils/time';
import { todayIn } from '../utils/dates';
import { StarIcon } from '../components/Icons';

const PILLARS = [
  { word: 'Train.', text: 'Book batting cages or the indoor turf in 30-minute blocks, whenever it fits your schedule.' },
  { word: 'Improve.', text: 'Get consistent reps in any weather. Members get cage time included every month.' },
  { word: 'Compete.', text: 'Show up ready for game day. Book weekly sessions and keep your work on the calendar.' },
];

/** "3 PM" style end-of-day label from the last slot ("21:30" → "10 PM"). */
function closesAt(a: Availability): string | null {
  const last = a.slots[a.slots.length - 1];
  if (!last) return null;
  const [h, m] = last.time.split(':').map(Number);
  const mins = h * 60 + m + 30;
  return formatTime(`${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
}

export default function Landing() {
  const [location, setLocation] = useState<Location | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [today, setToday] = useState<Availability | null>(null);

  // Live prices and today's open times; the page still works if any of it fails.
  useEffect(() => {
    listLocations()
      .then(async (all) => {
        const loc = all.find((l) => l.is_active);
        if (!loc) return;
        setLocation(loc);
        getPrices(loc.id).then(setPrices).catch(() => undefined);
        getAvailability(loc.id, todayIn(loc.timezone)).then(setToday).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  const from = (type: Price['resource_type']) => prices.find((p) => p.resource_type === type)?.base_cents || undefined;
  const cage = from('batting_cage');
  const turf = from('turf');
  const openTimes = today && !today.closed ? today.slots.filter((s) => !s.past && s.free.length > 0).slice(0, 3) : [];
  const closes = today && !today.closed ? closesAt(today) : null;

  return (
    <>
      <section className="hero hero-yard">
        <div className="hero-glow" aria-hidden="true" />
        <Logo size="lg" tagline />
        <p className="motto">
          Train. Improve. <span>Compete.</span>
        </p>
        <p className="lead">Indoor baseball and softball training: batting cages and turf, booked online.</p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg">Get started</Link>
          <Link to="/signin" className="btn btn-ghost btn-lg">Sign in</Link>
        </div>
      </section>

      {(cage !== undefined || turf !== undefined) && (
        <section className="price-peek" aria-label="Prices">
          {cage !== undefined && (
            <div className="card price-tile">
              <span className="muted small">Cages from</span>
              <strong>{formatMoney(cage)}</strong>
              <span className="muted small">per 30 min</span>
            </div>
          )}
          {turf !== undefined && (
            <div className="card price-tile">
              <span className="muted small">Turf from</span>
              <strong>{formatMoney(turf)}</strong>
              <span className="muted small">per 30 min</span>
            </div>
          )}
        </section>
      )}

      {today && location && (
        <section className="card open-today" aria-label="Open today">
          <div className="open-today-head">
            <strong>Open cages today</strong>
            <span className={`small ${today.closed ? 'muted' : 'open-dot'}`}>
              {today.closed ? `Closed today${today.closed_reason && today.closed_reason !== 'Closed' ? ` · ${today.closed_reason}` : ''}` : closes ? `Open until ${closes}` : 'Open'}
            </span>
          </div>
          {openTimes.length > 0 ? (
            <div className="open-times">
              {openTimes.map((s) => (
                <Link key={s.time} to="/signup" className="open-time">{formatTime(s.time)}</Link>
              ))}
            </div>
          ) : (
            !today.closed && <p className="muted small">Fully booked for the rest of today. Book ahead for tomorrow.</p>
          )}
          <Link to="/signup" className="small">Create a free account to book →</Link>
        </section>
      )}

      <p className="member-hint muted">
        <StarIcon size={18} /> Members get cage time included every month.
      </p>

      <section className="pillars">
        {PILLARS.map((p) => (
          <div key={p.word} className="card pillar">
            <h2>{p.word}</h2>
            <p className="muted">{p.text}</p>
          </div>
        ))}
      </section>

      <p className="landing-more">
        <Link to="/about">Hours, prices and how it works →</Link>
      </p>

      <div className="landing-cta mobile-only-flex">
        <Link to="/signup" className="btn btn-primary btn-lg btn-block">Create free account</Link>
        <span className="muted small">Already training here? <Link to="/signin">Sign in</Link></span>
      </div>
    </>
  );
}
