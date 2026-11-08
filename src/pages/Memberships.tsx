import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  cancelPendingChange,
  changeMembership,
  joinMembership,
  listTiers,
  myMembership,
  openBillingPortal,
  previewMembershipChange,
  syncMembership,
  type ChangePreview,
  type MyMembership,
  type Tier,
} from '../data/memberships';
import Modal from '../components/Modal';
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

/** What switching from `from` to `to` changes, as short lines ("+4 hrs included every month"). */
function differences(from: Tier | undefined, to: Tier): { text: string; up: boolean }[] {
  const a = from?.benefits[0];
  const b = to.benefits[0];
  if (!a || !b) return perks(to).map((text) => ({ text, up: true }));
  const out: { text: string; up: boolean }[] = [];
  const dh = b.included_cage_minutes - a.included_cage_minutes;
  if (dh) out.push({ text: `${dh > 0 ? '+' : '−'}${hours(Math.abs(dh))} included every month (${hours(b.included_cage_minutes)} total)`, up: dh > 0 });
  if (b.cage_discount_pct !== a.cage_discount_pct) out.push({ text: `${b.cage_discount_pct}% off extra cage time (now ${a.cage_discount_pct}%)`, up: b.cage_discount_pct > a.cage_discount_pct });
  if (b.turf_discount_pct !== a.turf_discount_pct) out.push({ text: `${b.turf_discount_pct}% off turf (now ${a.turf_discount_pct}%)`, up: b.turf_discount_pct > a.turf_discount_pct });
  if (b.booking_window_days !== a.booking_window_days) out.push({ text: `Book ${b.booking_window_days} days ahead (now ${a.booking_window_days})`, up: b.booking_window_days > a.booking_window_days });
  if (to.scope !== from!.scope) out.push({ text: to.scope === 'all' ? 'Every location' : `${to.location?.name ?? 'One location'} only`, up: to.scope === 'all' });
  return out.length ? out : [{ text: 'Same benefits', up: true }];
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
  const [switchTo, setSwitchTo] = useState<{ tier: Tier; interval: 'month' | 'year' } | null>(null);

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

  // Once per visit, make sure the membership matches Stripe (in case a webhook was missed).
  const synced = useRef(false);
  useEffect(() => {
    if (!mine || synced.current) return;
    synced.current = true;
    syncMembership().then((ran) => {
      if (ran) load();
    });
  }, [mine, load]);

  // Members start on their own billing interval.
  const intervalSet = useRef(false);
  useEffect(() => {
    if (mine && !intervalSet.current) {
      intervalSet.current = true;
      setInterval(mine.billing_interval);
    }
  }, [mine]);

  const undoPending = async () => {
    setBusy('undo');
    setError(null);
    try {
      await cancelPendingChange();
      setNotice('Scheduled change cancelled. You’ll stay on your current plan.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
  const currentTier = tiers.find((t) => t.id === mine?.tier.id);
  const waiting = Boolean(params.get('joined')) && !notice;
  const hasMembership = mine && (mine.status === 'active' || mine.status === 'past_due');

  return (
    <section>
      <h1>Memberships</h1>
      {!hasMembership && <p className="lead">Train more for less: included cage time, member pricing and a longer booking window.</p>}

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
            {mine.pending_price && !mine.pending && (
              <div className="pending-change">
                <span>
                  Your price changes to <strong>{formatMoney(mine.pending_price.cents)}/{mine.billing_interval === 'year' ? 'year' : 'month'}</strong>{' '}
                  at your renewal on {new Date(mine.pending_price.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.
                </span>
              </div>
            )}
            {mine.pending && (
              <div className="pending-change">
                <span>
                  Switching to <strong>{mine.pending.tier_name}</strong> ({mine.pending.interval === 'year' ? 'yearly' : 'monthly'}) on{' '}
                  {new Date(mine.pending.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.
                  You keep {mine.tier.name} until then.
                </span>
                <button className="link-button" disabled={busy === 'undo'} onClick={undoPending}>
                  {busy === 'undo' ? 'Working…' : `Keep ${mine.tier.name}`}
                </button>
              </div>
            )}
            {mine.status === 'past_due' && (
              <p className="alert alert-error small">Your last payment didn’t go through. Update your card to keep your benefits.</p>
            )}
          </div>
          {terms?.member && terms.included_cage_minutes! > 0 && (
            <UsageRing used={terms.included_used_this_month ?? 0} total={terms.included_cage_minutes!} />
          )}
          {currentTier && (
            <div className="perk-chips">
              {perks(currentTier).filter((p) => !/included every month/.test(p)).map((p) => <span key={p} className="perk-chip">{p}</span>)}
              <span className="perk-chip">{currentTier.scope === 'all' ? 'All locations' : currentTier.location?.name}</span>
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
            if (current && mine?.billing_interval === interval) return null;
            const diff = hasMembership && !current ? differences(currentTier, t) : null;
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
                {diff ? (
                  <>
                    <span className="eyebrow">Compared with your plan</span>
                    <ul className="perk-list diff-list">
                      {diff.map((d) => (
                        <li key={d.text} className={d.up ? 'up' : 'down'}>{d.text}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <ul className="perk-list">
                    {perks(t).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {current && mine?.billing_interval === interval ? (
                  <span className="btn btn-ghost btn-block disabled-look">Your plan</span>
                ) : hasMembership && mine && mine.pending?.tier_id === t.id && mine.pending.interval === interval ? (
                  <span className="btn btn-ghost btn-block disabled-look">
                    Starts {new Date(mine.pending.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                ) : hasMembership && mine ? (
                  <button
                    className="btn btn-primary btn-block"
                    disabled={mine.status === 'past_due' || (interval === 'year' && !t.yearly_price_cents)}
                    onClick={() => setSwitchTo({ tier: t, interval })}
                  >
                    {current ? `Switch to ${interval === 'year' ? 'yearly' : 'monthly'}` : `Switch to ${t.name}`}
                  </button>
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
      {switchTo && mine && (
        <SwitchDialog
          tier={switchTo.tier}
          interval={switchTo.interval}
          mine={mine}
          onClose={() => setSwitchTo(null)}
          onDone={async (msg) => {
            setSwitchTo(null);
            setNotice(msg);
            await load();
          }}
        />
      )}

      <details className="fine-print">
        <summary>How plans, changes and included time work</summary>
        <p className="muted small">
        Included cage time resets on the 1st of each month and doesn’t roll over. Turf time isn’t included but is discounted.
        Members can switch tiers or between monthly and yearly here. Upgrades start right away (you pay the difference); downgrades start at your next renewal. Included cage time covers sessions up to your renewal date. Cancel anytime from Manage billing; benefits last until the end of the period you’ve paid for.
        </p>
      </details>
    </section>
  );
}

/** Ring showing included cage time left this month. */
function UsageRing({ used, total }: { used: number; total: number }) {
  const left = Math.max(0, total - used);
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className="usage-ring">
      <svg viewBox="0 0 92 92" width="92" height="92" role="img" aria-label={`${hours(left)} of ${hours(total)} included cage time left this month`}>
        <circle cx="46" cy="46" r={r} fill="none" stroke="#1f2836" strokeWidth="9" />
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--primary)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(c * left) / total} ${c}`} transform="rotate(-90 46 46)" />
      </svg>
      <div className="usage-ring-text" aria-hidden="true">
        <strong>{hours(left)}</strong>
        <span>left of {hours(total)}</span>
      </div>
      <span className="muted small">Included cage time this month</span>
    </div>
  );
}

function SwitchDialog({
  tier,
  interval,
  mine,
  onClose,
  onDone,
}: {
  tier: Tier;
  interval: 'month' | 'year';
  mine: MyMembership;
  onClose(): void;
  onDone(message: string): void;
}) {
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    previewMembershipChange(tier.id, interval).then(setPreview).catch((e: Error) => setError(e.message));
  }, [tier.id, interval]);

  const sameTier = mine.tier.id === tier.id;
  const per = interval === 'year' ? 'year' : 'month';
  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await changeMembership(tier.id, interval);
      if (res.mode === 'renewal') {
        const when = res.starts_at ? new Date(res.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'your next renewal';
        onDone(`Done. You’ll switch to ${tier.name}${sameTier ? '' : ''} (${interval === 'year' ? 'yearly' : 'monthly'}) on ${when}.`);
      } else {
        onDone(sameTier ? `You’re now billed ${interval === 'year' ? 'yearly' : 'monthly'}.` : `You’re now on ${tier.name}. Your new benefits are active.`);
      }
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title={sameTier ? `Switch to ${interval === 'year' ? 'yearly' : 'monthly'}` : `Switch to ${tier.name}`} onClose={onClose}>
      {!preview && !error && <p className="muted">Working out the cost…</p>}
      {preview && (
        <>
          <p>
            <strong>{tier.name}</strong>, {formatMoney(preview.new_price_cents)}/{per}.
          </p>
          <div className="switch-cost">
            {preview.mode === 'now' ? (
              <>
                <strong>About {formatMoney(preview.charge_today_cents)} today. Starts now</strong>
                <span className="muted small">
                  {interval !== mine.billing_interval
                    ? `Your first ${per} starts today, minus credit for unused time on your current plan.`
                    : 'The difference for the rest of this billing period, charged to your card on file.'}
                </span>
              </>
            ) : (
              <>
                <strong>
                  Starts {preview.starts_at ? new Date(preview.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'at your next renewal'}
                </strong>
                <span className="muted small">
                  No charge today. You keep {mine.tier.name} until your plan renews, then you’re billed {formatMoney(preview.new_price_cents)}/{per}.
                </span>
              </>
            )}
          </div>
          <ul className="perk-list small">
            {perks(tier).map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="muted small">
            {preview.mode === 'now' && 'Cage time you’ve already used this month still counts toward your new monthly allowance. '}
            {mine.cancel_at_period_end && 'Your plan is set to end at the close of this period; switching doesn’t change that. Renew in Manage billing to keep it going.'}
          </p>
        </>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Keep my plan</button>
        <button className="btn btn-primary" onClick={confirm} disabled={!preview || saving}>
          {saving ? 'Switching…' : 'Confirm switch'}
        </button>
      </div>
    </Modal>
  );
}
