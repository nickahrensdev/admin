import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { joinMembership, listTiers, myMembership, openBillingPortal, type MyMembership, type Tier } from '../data/memberships';
import { myBookingTerms, type BookingTerms } from '../data/bookings';
import { formatMoney } from '../utils/time';

function hours(min: number) {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr${h === 1 ? '' : 's'}`;
}

function perks(t: Tier): string[] {
  const b = t.benefits[0];
  if (!b) return [];
  const out: string[] = [];
  if (b.included_cage_minutes > 0) out.push(`${hours(b.included_cage_minutes)} of cage time included every month`);
  if (b.cage_discount_pct > 0) out.push(`${b.cage_discount_pct}% off extra cage time`);
  if (b.turf_discount_pct > 0) out.push(`${b.turf_discount_pct}% off the turf`);
  out.push(`Book up to ${b.booking_window_days} days ahead`);
  if (b.max_upcoming_bookings) out.push(`Up to ${b.max_upcoming_bookings} upcoming bookings`);
  return out;
}

export default function Memberships() {
  const [params, setParams] = useSearchParams();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [mine, setMine] = useState<MyMembership | null>(null);
  const [terms, setTerms] = useState<BookingTerms | null>(null);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([listTiers(), myMembership()]);
      setTiers(t);
      setMine(m);
      const loc = t.find((x) => x.id === m?.tier.id)?.benefits[0]?.location_id;
      setTerms(m && loc ? await myBookingTerms(loc) : null);
      setError(null);
      return m;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Back from Stripe after subscribing: the webhook activates it a moment later.
  useEffect(() => {
    let timer: number | undefined;
    const joined = params.get('joined');
    const tick = async () => {
      const m = await load();
      if (!joined) return;
      if (m?.status === 'active') {
        setNotice(`Welcome to ${m.tier.name}! Your member benefits are active.`);
        setParams({}, { replace: true });
      } else if (polls.current++ < 15) {
        timer = window.setTimeout(tick, 2000);
      } else {
        setNotice('Payment received. Your membership will show as active in a moment; refresh if it doesn’t.');
        setParams({}, { replace: true });
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [params, setParams, load]);

  const join = async (t: Tier) => {
    setBusy(t.id);
    setError(null);
    try {
      window.location.href = await joinMembership(t.id, interval);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const manage = async () => {
    setBusy('portal');
    setError(null);
    try {
      window.location.href = await openBillingPortal();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const anyYearly = tiers.some((t) => t.yearly_price_cents);
  const waiting = Boolean(params.get('joined')) && !notice;
  const hasMembership = mine && (mine.status === 'active' || mine.status === 'past_due');

  return (
    <section>
      <h1>Memberships</h1>
      <p className="lead">Train more for less: included cage time, member pricing and a longer booking window.</p>

      {waiting && <p className="alert alert-success" role="status">Payment received. Activating your membership…</p>}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {hasMembership && mine && (
        <div className="card member-card">
          <div>
            <span className="chip chip-super">Member</span>
            <h2>{mine.tier.name}</h2>
            <p className="muted small">
              {mine.tier.scope === 'all' ? 'All locations' : mine.tier.location_name} · billed {mine.billing_interval === 'year' ? 'yearly' : 'monthly'}
              {mine.current_period_end &&
                ` · ${mine.cancel_at_period_end ? 'ends' : 'renews'} ${new Date(mine.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
            </p>
            {mine.cancel_at_period_end && mine.status === 'active' && (
              <p className="alert alert-info small">
                Your membership is cancelled and won’t renew. You keep your benefits until
                {mine.current_period_end
                  ? ` ${new Date(mine.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : ' the end of this billing period'}
                . Changed your mind? Use Manage billing to renew.
              </p>
            )}
            {mine.status === 'past_due' && (
              <p className="alert alert-error small">Your last payment didn’t go through. Update your card to keep your benefits.</p>
            )}
          </div>
          {terms?.member && terms.included_cage_minutes! > 0 && (
            <div className="usage">
              <div className="usage-bar">
                <span style={{ width: `${Math.min(100, (100 * terms.included_used_this_month!) / terms.included_cage_minutes!)}%` }} />
              </div>
              <span className="small">
                <strong>{hours(Math.max(0, terms.included_cage_minutes! - terms.included_used_this_month!))}</strong> of{' '}
                {hours(terms.included_cage_minutes!)} included cage time left this month
              </span>
            </div>
          )}
          <button className="btn btn-ghost" onClick={manage} disabled={busy === 'portal'}>
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        </div>
      )}

      {anyYearly && (
        <div className="segmented interval-toggle" role="radiogroup" aria-label="Billing">
          <button role="radio" aria-checked={interval === 'month'} className={interval === 'month' ? 'active' : ''} onClick={() => setInterval('month')}>
            Monthly
          </button>
          <button role="radio" aria-checked={interval === 'year'} className={interval === 'year' ? 'active' : ''} onClick={() => setInterval('year')}>
            Yearly <span className="save-tag">Save</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <div className="tier-grid">
          {tiers.map((t) => {
            const yearly = interval === 'year' && t.yearly_price_cents;
            const price = yearly ? t.yearly_price_cents! : t.monthly_price_cents;
            const savePct = t.yearly_price_cents
              ? Math.round(100 - (100 * t.yearly_price_cents) / (t.monthly_price_cents * 12))
              : 0;
            const current = mine?.tier.id === t.id && hasMembership;
            return (
              <div key={t.id} className={`card tier-card${current ? ' current' : ''}`}>
                <div className="tier-top">
                  <h2>{t.name}</h2>
                  <span className="muted small">{t.scope === 'all' ? 'All locations' : t.location?.name}</span>
                </div>
                <div className="tier-price">
                  <strong>{formatMoney(price)}</strong>
                  <span className="muted">/{yearly ? 'year' : 'month'}</span>
                </div>
                {interval === 'year' && t.yearly_price_cents && savePct > 0 && (
                  <span className="chip">Save {savePct}% vs monthly</span>
                )}
                {interval === 'year' && !t.yearly_price_cents && <span className="muted small">Monthly only</span>}
                {t.description && <p className="muted">{t.description}</p>}
                <ul className="perk-list">
                  {perks(t).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                {current ? (
                  <span className="btn btn-ghost btn-block disabled-look">Your plan</span>
                ) : (
                  <button
                    className="btn btn-primary btn-block"
                    disabled={Boolean(busy) || Boolean(hasMembership) || (interval === 'year' && !t.yearly_price_cents)}
                    onClick={() => join(t)}
                  >
                    {busy === t.id ? 'Opening checkout…' : hasMembership ? 'You already have a plan' : `Join ${t.name}`}
                  </button>
                )}
              </div>
            );
          })}
          {tiers.length === 0 && <p className="muted">No memberships are available yet.</p>}
        </div>
      )}
      <p className="muted small book-policy">
        Included cage time resets on the 1st of each month and doesn’t roll over. Turf time isn’t included but is discounted.
        Cancel anytime from Manage billing; benefits last until the end of the period you’ve paid for.
      </p>
    </section>
  );
}
