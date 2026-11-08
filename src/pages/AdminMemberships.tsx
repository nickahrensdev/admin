import { useCallback, useEffect, useState } from 'react';
import { listLocations, type Location } from '../data/locations';
import {
  adminGetBenefits,
  adminListMembers,
  adminListTiers,
  adminSaveBenefits,
  adminSaveTier,
  adminTierPriceStatus,
  applyTierPrice,
  type BenefitRow,
  type TierPriceStatus,
  type Member,
  type TierRow,
} from '../data/memberships';
import FormField from '../components/FormField';
import Toggle from '../components/Toggle';
import Modal from '../components/Modal';
import { formatMoney } from '../utils/time';

const EMPTY: Omit<TierRow, 'id'> = {
  name: '',
  description: '',
  scope: 'all',
  location_id: null,
  monthly_price_cents: 4900,
  yearly_price_cents: 49000,
  is_active: true,
  sort_order: 100,
};

function dollars(c: number | null) {
  return c === null ? '' : (c / 100).toFixed(2);
}
function cents(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function AdminMemberships() {
  const [tab, setTab] = useState<'tiers' | 'members'>('tiers');
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Memberships</h1>
          <p className="muted">Tiers, prices, member benefits per location, and who’s a member.</p>
        </div>
      </div>
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tiers'} className={`tab${tab === 'tiers' ? ' active' : ''}`} onClick={() => setTab('tiers')}>Tiers</button>
        <button role="tab" aria-selected={tab === 'members'} className={`tab${tab === 'members' ? ' active' : ''}`} onClick={() => setTab('members')}>Members</button>
      </nav>
      {tab === 'tiers' ? <Tiers /> : <Members />}
    </section>
  );
}

function Tiers() {
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [editing, setEditing] = useState<(Omit<TierRow, 'id'> & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<TierRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([adminListTiers(), listLocations()]);
      setTiers(t);
      setLocations(l);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (editing) {
    return (
      <TierEditor
        tier={editing}
        locations={locations}
        onDone={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="stack">
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <ul className="list">
        {tiers.map((t) => (
          <li key={t.id} className="tier-list-item">
            <button className="card list-link tier-row" onClick={() => setEditing(t)}>
              <div>
                <span className="list-title">{t.name}</span>
                <span className="muted small">
                  {t.scope === 'all' ? 'All locations' : locations.find((l) => l.id === t.location_id)?.name} ·{' '}
                  {formatMoney(t.monthly_price_cents)}/mo{t.yearly_price_cents ? ` · ${formatMoney(t.yearly_price_cents)}/yr` : ''}
                </span>
              </div>
              <span className="list-meta">
                {!t.is_active && <span className="chip chip-muted">Hidden</span>}
                <span className="chevron" aria-hidden="true">›</span>
              </span>
            </button>
            <TierPriceLine tier={t} onApply={() => setApplying(t)} />
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ ...EMPTY })}>
        Add tier
      </button>
      <p className="muted small">
        Price changes apply to new members right away. To move current members to a new price, use “Apply current price” under
        the tier: they switch at a renewal after the notice period you choose and get an email.
      </p>
      {applying && <ApplyPriceDialog tier={applying} onClose={() => setApplying(null)} />}
    </div>
  );
}

function TierEditor({ tier, locations, onDone }: { tier: Omit<TierRow, 'id'> & { id?: string }; locations: Location[]; onDone(): void }) {
  const [t, setT] = useState(tier);
  const [monthly, setMonthly] = useState(dollars(tier.monthly_price_cents));
  const [yearly, setYearly] = useState(dollars(tier.yearly_price_cents));
  const [benefits, setBenefits] = useState<BenefitRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tier.id) adminGetBenefits(tier.id).then(setBenefits).catch((e) => setError((e as Error).message));
  }, [tier.id]);

  const covered = t.scope === 'all' ? locations : locations.filter((l) => l.id === t.location_id);
  const rowFor = (locId: string): BenefitRow =>
    benefits.find((b) => b.location_id === locId) ?? {
      tier_id: tier.id ?? '',
      location_id: locId,
      included_cage_minutes: 0,
      cage_discount_pct: 0,
      turf_discount_pct: 0,
      booking_window_days: 90,
      max_upcoming_bookings: null,
    };
  const setRow = (locId: string, patch: Partial<BenefitRow>) =>
    setBenefits((prev) => {
      const row = { ...rowFor(locId), ...patch };
      return [...prev.filter((b) => b.location_id !== locId), row];
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const m = cents(monthly);
      if (m === null || m < 50) throw new Error('Monthly price must be at least $0.50.');
      const y = cents(yearly);
      if (y !== null && y < 50) throw new Error('Yearly price must be at least $0.50, or empty for monthly only.');
      const id = await adminSaveTier({ ...t, monthly_price_cents: m, yearly_price_cents: y });
      const rows = covered.map((l) => ({ ...rowFor(l.id), tier_id: id }));
      if (rows.length) await adminSaveBenefits(rows);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const yearlySave = (() => {
    const m = cents(monthly);
    const y = cents(yearly);
    return m && y ? Math.round(100 - (100 * y) / (m * 12)) : null;
  })();

  return (
    <div className="stack">
      <div className="card stack">
        <h2>{tier.id ? `Edit ${tier.name}` : 'New tier'}</h2>
        <FormField label="Name" name="tier-name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} maxLength={40} />
        <label className="field">
          <span className="field-label">Description</span>
          <textarea className="textarea" maxLength={300} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} rows={2} />
        </label>
        <div className="segmented" role="radiogroup" aria-label="Where it can be used">
          <button role="radio" aria-checked={t.scope === 'all'} className={t.scope === 'all' ? 'active' : ''} onClick={() => setT({ ...t, scope: 'all', location_id: null })}>
            All locations
          </button>
          <button role="radio" aria-checked={t.scope === 'location'} className={t.scope === 'location' ? 'active' : ''}
            onClick={() => setT({ ...t, scope: 'location', location_id: t.location_id ?? locations[0]?.id ?? null })}>
            One location
          </button>
        </div>
        {t.scope === 'location' && (
          <select className="time-select" aria-label="Location" value={t.location_id ?? ''} onChange={(e) => setT({ ...t, location_id: e.target.value })}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
        <div className="closure-form">
          <label className="field">
            <span className="field-label">Monthly price</span>
            <span className="money-input"><span>$</span><input inputMode="decimal" aria-label="Monthly price" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></span>
          </label>
          <label className="field">
            <span className="field-label">Yearly price</span>
            <span className="money-input"><span>$</span><input inputMode="decimal" aria-label="Yearly price" placeholder="Monthly only" value={yearly} onChange={(e) => setYearly(e.target.value)} /></span>
            <span className="field-hint">{yearlySave !== null ? `${yearlySave}% less than 12 monthly payments` : 'Leave empty to offer monthly only'}</span>
          </label>
        </div>
        <Toggle checked={t.is_active} onChange={(v) => setT({ ...t, is_active: v })} label="Tier visible" text={t.is_active ? 'Visible — customers can join' : 'Hidden — no new members'} />
      </div>

      <div className="card stack">
        <div>
          <h2>Benefits</h2>
          <p className="muted small">Per location. Included time is cage time only, resets on the 1st, no rollover.</p>
        </div>
        {covered.map((l) => {
          const b = rowFor(l.id);
          return (
            <div key={l.id} className="benefit-block">
              {covered.length > 1 && <h3 className="benefit-loc">{l.name}</h3>}
              <div className="benefit-grid">
                <label className="field">
                  <span className="field-label">Included cage hours / month</span>
                  <select className="time-select" value={b.included_cage_minutes} onChange={(e) => setRow(l.id, { included_cage_minutes: Number(e.target.value) })}>
                    {Array.from({ length: 41 }, (_, i) => i * 30).map((m) => (
                      <option key={m} value={m}>{m === 0 ? 'None' : `${m / 60} hr`}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Cage discount %</span>
                  <input type="number" min={0} max={100} value={b.cage_discount_pct} onChange={(e) => setRow(l.id, { cage_discount_pct: Math.max(0, Math.min(100, Number(e.target.value))) })} />
                </label>
                <label className="field">
                  <span className="field-label">Turf discount %</span>
                  <input type="number" min={0} max={100} value={b.turf_discount_pct} onChange={(e) => setRow(l.id, { turf_discount_pct: Math.max(0, Math.min(100, Number(e.target.value))) })} />
                </label>
                <label className="field">
                  <span className="field-label">Book ahead (days)</span>
                  <input type="number" min={1} max={365} value={b.booking_window_days} onChange={(e) => setRow(l.id, { booking_window_days: Math.max(1, Math.min(365, Number(e.target.value))) })} />
                </label>
                <label className="field">
                  <span className="field-label">Max upcoming bookings</span>
                  <input type="number" min={1} placeholder="No limit" value={b.max_upcoming_bookings ?? ''} onChange={(e) => setRow(l.id, { max_upcoming_bookings: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
                </label>
              </div>
            </div>
          );
        })}
        {covered.length === 0 && <p className="muted">Pick a location first.</p>}
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onDone} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save tier'}</button>
      </div>
    </div>
  );
}

function Members() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminListMembers()
      .then(setMembers)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading…</div>;
  const active = members.filter((m) => m.status === 'active').length;
  return (
    <div className="stack">
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <p className="muted">{active} active {active === 1 ? 'member' : 'members'}</p>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id} className="card member-row">
            <div>
              <span className="list-title">{m.display_name}</span>
              <span className="muted small">@{m.username} · {m.email}</span>
            </div>
            <div className="member-row-meta">
              <span className="chip">{m.tier_name}</span>
              <span className={`small ${m.status === 'active' ? '' : 'muted'}`}>
                {m.status === 'active' ? (m.cancel_at_period_end ? 'Ends' : 'Renews') : m.status.replace('_', ' ')}
                {m.status === 'active' && m.current_period_end && ` ${new Date(m.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                {` · ${m.billing_interval === 'year' ? 'yearly' : 'monthly'}`}
              </span>
            </div>
          </li>
        ))}
        {members.length === 0 && <li className="card muted">No members yet.</li>}
      </ul>
    </div>
  );
}

/** "4 members · 3 on an older price · Apply current price" under each tier. */
function TierPriceLine({ tier, onApply }: { tier: TierRow; onApply(): void }) {
  const [st, setSt] = useState<TierPriceStatus | null>(null);
  useEffect(() => {
    adminTierPriceStatus(tier.id).then(setSt).catch(() => setSt(null));
  }, [tier.id, tier.monthly_price_cents, tier.yearly_price_cents]);
  if (!st || st.members === 0) return null;
  const older = st.members - st.at_current - st.unknown;
  return (
    <div className="tier-price-line small">
      <span className="muted">
        {st.members} member{st.members === 1 ? '' : 's'}
        {older > 0 && ` · ${older} on an older price`}
        {st.unknown > 0 && ` · ${st.unknown} not checked yet`}
        {st.scheduled > 0 && ` · ${st.scheduled} price change${st.scheduled === 1 ? '' : 's'} scheduled`}
      </span>
      {(older > 0 || st.unknown > 0) && (
        <button className="link-button" onClick={onApply}>Apply current price to members</button>
      )}
    </div>
  );
}

function ApplyPriceDialog({ tier, onClose }: { tier: TierRow; onClose(): void }) {
  const [days, setDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ changed: number; unchanged: number; skipped: { name: string; reason: string }[] } | null>(null);

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      setResult(await applyTierPrice(tier.id, days));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Apply ${tier.name} price to members`} onClose={onClose}>
      {result ? (
        <>
          <p>
            <strong>{result.changed}</strong> member{result.changed === 1 ? '' : 's'} will move to the new price at a renewal at
            least {days} days from now, and will get an email about it.
            {result.unchanged > 0 && ` ${result.unchanged} already pay the current price.`}
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="muted small">Not changed:</p>
              <ul className="plain-list small">
                {result.skipped.map((s, i) => <li key={i}>{s.name}: {s.reason}</li>)}
              </ul>
            </>
          )}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <>
          <p>
            Current members of {tier.name} will move to <strong>{formatMoney(tier.monthly_price_cents)}/month</strong>
            {tier.yearly_price_cents ? <> (yearly members: <strong>{formatMoney(tier.yearly_price_cents)}/year</strong>)</> : null} at
            their first renewal after the notice period. Nobody is charged early.
          </p>
          <label className="field">
            <span>Notice period (days)</span>
            <input type="number" min={0} max={120} value={days} onChange={(e) => setDays(Math.max(0, Math.min(120, Number(e.target.value) || 0)))} />
          </label>
          <p className="muted small">
            Members get an email right away with the date and new price, and see it on their Membership page. Anyone already
            switching to another tier is left alone. Check your local rules on notice for price increases; 30 days is common.
          </p>
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={apply} disabled={saving}>{saving ? 'Applying…' : 'Apply new price'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
