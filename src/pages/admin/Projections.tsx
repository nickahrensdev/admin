import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadProjectionBase } from '../../data/projections';
import LocationPicker from '../../components/LocationPicker';
import SweepChart from '../../components/SweepChart';
import {
  breakEven, defaultScenario, priceSweep, project,
  type LocationBase, type Scenario, type TierBase,
} from '../../utils/projection';

const STORE = 'yard-projections-v1';
const money = (cents: number) =>
  (cents < 0 ? '−' : '') + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(cents) / 100);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hrs = (h: number) => `${Math.round(h).toLocaleString()} hr`;
const price30 = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** Saved levers win over today's numbers, but only for locations and tiers that still exist. */
function merge(base: Scenario, saved: Partial<Scenario> | null): Scenario {
  if (!saved) return base;
  return {
    global: { ...base.global, ...saved.global },
    tiers: Object.fromEntries(Object.entries(base.tiers).map(([id, t]) => [id, { ...t, ...saved.tiers?.[id] }])),
    locs: Object.fromEntries(Object.entries(base.locs).map(([id, l]) => [id, { ...l, ...saved.locs?.[id] }])),
  };
}

export default function Projections() {
  const [locations, setLocations] = useState<LocationBase[] | null>(null);
  const [tiers, setTiers] = useState<TierBase[]>([]);
  const [baseline, setBaseline] = useState<Scenario | null>(null);
  const [s, setS] = useState<Scenario | null>(null);
  const [scope, setScope] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjectionBase()
      .then(({ locations: l, tiers: t }) => {
        const base = defaultScenario(l, t);
        let saved: Partial<Scenario> | null = null;
        try {
          saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
        } catch {
          saved = null;
        }
        setLocations(l);
        setTiers(t);
        setBaseline(base);
        setS(merge(base, saved));
      })
      .catch((e) => setError(e instanceof Error && e.message ? e.message : 'Could not load the numbers.'));
  }, []);

  useEffect(() => {
    if (!s) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* private mode: the scenario just won't be remembered */
    }
  }, [s]);

  const chosen = useMemo(() => (locations ?? []).filter((l) => !scope || l.id === scope), [locations, scope]);
  const view = useMemo(() => (s && locations ? project(chosen, tiers, s) : null), [s, chosen, tiers, locations]);
  // "Today" = today's prices, tiers and occupancy, with your costs and assumptions (those aren't changes).
  const todayScenario = useMemo(() => {
    if (!baseline || !s) return null;
    return {
      ...baseline,
      global: s.global,
      locs: Object.fromEntries(
        Object.entries(baseline.locs).map(([id, l]) => [id, { ...l, fixedCents: s.locs[id].fixedCents, varCentsPerHour: s.locs[id].varCentsPerHour }]),
      ),
    };
  }, [baseline, s]);
  const today = useMemo(() => (todayScenario && locations ? project(chosen, tiers, todayScenario) : null), [todayScenario, chosen, tiers, locations]);
  const sweep = useMemo(() => (s && locations ? priceSweep(chosen, locations, tiers, s) : null), [s, chosen, tiers, locations]);
  const even = useMemo(() => (s && locations ? breakEven(chosen, locations, tiers, s) : null), [s, chosen, tiers, locations]);

  if (error) return <p className="alert alert-error" role="alert">{error}</p>;
  if (!locations || !s || !view || !today || !sweep || !baseline || !todayScenario) return <div className="page-loading">Loading…</div>;
  if (!locations.length) return <p className="muted">Add a location first.</p>;

  const loc = scope ? locations.find((l) => l.id === scope)! : null;
  const r = view.total;
  const delta = r.profit - today.total.profit;
  const scopeTiers = tiers.filter((t) => !loc || t.scope === 'all' || t.locationId === loc.id);
  const noCosts = chosen.every((l) => !s.locs[l.id].fixedCents && !s.locs[l.id].varCentsPerHour);
  const guessed = chosen.some((l) => !l.occFromData);
  const changed = JSON.stringify(s) !== JSON.stringify(todayScenario);
  const cageNow = loc ? loc.cagePrice : null;
  const curMult = loc ? s.locs[loc.id].cagePriceMult : chosen.reduce((a, l) => a + s.locs[l.id].cagePriceMult, 0) / chosen.length;

  const setGlobal = (k: keyof Scenario['global'], v: number) => setS({ ...s, global: { ...s.global, [k]: v } });
  const setTier = (id: string, k: keyof Scenario['tiers'][string], v: number) =>
    setS({ ...s, tiers: { ...s.tiers, [id]: { ...s.tiers[id], [k]: v } } });
  const setLoc = (id: string, k: keyof Scenario['locs'][string], v: number) =>
    setS({ ...s, locs: { ...s.locs, [id]: { ...s.locs[id], [k]: v } } });
  const useBest = () =>
    setS({ ...s, locs: { ...s.locs, ...Object.fromEntries(chosen.map((l) => [l.id, { ...s.locs[l.id], cagePriceMult: sweep.best.mult }])) } });

  return (
    <section className="projections">
      <div className="page-header">
        <div>
          <h1>Projections</h1>
          <p className="muted">A month at your current tiers and bookings. Move the sliders to see what changes profit.</p>
        </div>
      </div>

      <div className="proj-toolbar">
        <LocationPicker locations={[{ id: '', name: 'All locations' }, ...locations]} value={scope} onChange={setScope} />
        {changed && (
          <button className="btn btn-ghost btn-sm" onClick={() => setS(todayScenario)}>Reset to today</button>
        )}
      </div>

      {(noCosts || guessed) && (
        <div className="proj-notes">
          {noCosts && <p className="alert small">Add your rent, staff and other monthly costs under <strong>Costs</strong>{scope ? '' : ' (pick a location)'} to see real profit.</p>}
          {guessed && <p className="muted small">No booking history yet{chosen.length > 1 ? ' for some locations' : ''}, so occupancy starts from a guess. Adjust it below.</p>}
        </div>
      )}

      <div className="proj-grid">
        <div className="proj-results">
          <div className={`card proj-hero ${r.profit >= 0 ? 'is-up' : 'is-down'}`}>
            <span className="eyebrow">Monthly profit · {loc ? loc.name : 'All locations'}</span>
            <strong className="proj-profit">{money(r.profit)}</strong>
            <span className="muted small">
              {money(r.profit * 12)} a year · {r.revenue.total ? pct(r.profit / r.revenue.total) : '—'} margin
              {changed && (
                <>
                  {' · '}
                  <span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : '−'}{money(Math.abs(delta)).replace('−', '')} vs today</span>
                </>
              )}
            </span>
            <p className="proj-even small">
              {even === 'always'
                ? 'Memberships alone cover your costs.'
                : even === 'never'
                  ? 'Even full cages don’t cover costs at these prices.'
                  : `Break-even at ${pct(even as number)} of cage and turf hours booked (now ${pct(r.occupancy)}).`}
            </p>
          </div>

          <div className="card proj-breakdown">
            <h2 className="list-title">Money in</h2>
            <Line label="Cage bookings" value={r.revenue.cage} sub={`${hrs(r.cageHours - r.includedHours)} paid · ${hrs(r.includedHours)} included`} />
            {r.turfHours > 0 || r.revenue.turf > 0 ? <Line label="Turf bookings" value={r.revenue.turf} sub={hrs(r.turfHours)} /> : null}
            <Line label="Memberships" value={r.revenue.memberships} sub={`${Math.round(r.members)} ${Math.round(r.members) === 1 ? "member" : "members"}`} />
            <Line label="Total" value={r.revenue.total} strong />
            <h2 className="list-title">Money out</h2>
            <Line label="Card fees" value={-r.costs.fees} />
            <Line label="Per-hour costs" value={-r.costs.variable} />
            <Line label="Monthly costs" value={-r.costs.fixed} />
            <Line label="Profit" value={r.profit} strong />
          </div>

          <div className="card proj-sweep">
            <div className="proj-sweep-head">
              <h2>Best cage price</h2>
              <span className="muted small">Profit at each price level, with bookings rising or falling as prices move</span>
            </div>
            <SweepChart
              points={sweep.points.map((p) => ({ x: p.mult, y: p.profit }))}
              current={curMult}
              best={sweep.best.mult}
              formatX={(m) => (cageNow ? `${price30(cageNow.off * m)} / ${price30(cageNow.peak * m)}` : `${Math.round((m - 1) * 100) >= 0 ? '+' : ''}${Math.round((m - 1) * 100)}%`)}
              formatY={money}
              xLabel={cageNow ? 'Off-peak / peak price per 30 min' : 'Cage price change'}
            />
            <div className="proj-sweep-foot">
              <span className="small">
                Best: <strong>{cageNow ? `${price30(cageNow.off * sweep.best.mult)} / ${price30(cageNow.peak * sweep.best.mult)}` : `${Math.round((sweep.best.mult - 1) * 100)}%`}</strong> for {money(sweep.best.profit)}/month
              </span>
              {Math.abs(sweep.best.mult - curMult) > 0.001 && (
                <button className="btn btn-primary btn-sm" onClick={useBest}>Use it</button>
              )}
            </div>
          </div>

          {!loc && view.byLocation.length > 1 && (
            <div className="card">
              <h2 className="list-title">By location</h2>
              <div className="table-scroll">
                <table className="proj-table">
                  <thead>
                    <tr><th>Location</th><th>Revenue</th><th>Costs</th><th>Profit</th></tr>
                  </thead>
                  <tbody>
                    {view.byLocation.map(({ loc: l, result }) => (
                      <tr key={l.id} onClick={() => setScope(l.id)}>
                        <td><button className="link-button" onClick={() => setScope(l.id)}>{l.name}</button></td>
                        <td>{money(result.revenue.total)}</td>
                        <td>{money(result.costs.total)}</td>
                        <td className={result.profit >= 0 ? 'up' : 'down'}>{money(result.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">All-locations memberships are split evenly between locations.</p>
            </div>
          )}
        </div>

        <div className="proj-levers">
          {loc ? (
            <>
              <details className="card lever-group" open>
                <summary><h2>Prices</h2></summary>
                {loc.cages > 0 && (
                  <Slider label="Cage price" min={0.5} max={2} step={0.05} value={s.locs[loc.id].cagePriceMult} now={1}
                    format={(m) => `${price30(loc.cagePrice.off * m)} / ${price30(loc.cagePrice.peak * m)}`}
                    hint="Off-peak / peak, per 30 min" onChange={(v) => setLoc(loc.id, 'cagePriceMult', v)} />
                )}
                {loc.turfs > 0 && (
                  <Slider label="Turf price" min={0.5} max={2} step={0.05} value={s.locs[loc.id].turfPriceMult} now={1}
                    format={(m) => `${price30(loc.turfPrice.off * m)} / ${price30(loc.turfPrice.peak * m)}`}
                    hint="Off-peak / peak, per 30 min" onChange={(v) => setLoc(loc.id, 'turfPriceMult', v)} />
                )}
              </details>

              <details className="card lever-group" open>
                <summary><h2>How busy</h2></summary>
                <p className="muted small">Share of hours booked at today’s prices{loc.occFromData ? ' (starts at the last 30 days)' : ' (a starting guess)'}. Price changes move it using “Price sensitivity”.</p>
                {loc.cages > 0 && (
                  <>
                    <Slider label="Cages, peak" min={0} max={100} step={1} value={s.locs[loc.id].occCagePeak} now={baseline.locs[loc.id].occCagePeak}
                      format={(v) => `${v}%`} onChange={(v) => setLoc(loc.id, 'occCagePeak', v)} />
                    <Slider label="Cages, off-peak" min={0} max={100} step={1} value={s.locs[loc.id].occCageOff} now={baseline.locs[loc.id].occCageOff}
                      format={(v) => `${v}%`} onChange={(v) => setLoc(loc.id, 'occCageOff', v)} />
                  </>
                )}
                {loc.turfs > 0 && (
                  <Slider label="Turf" min={0} max={100} step={1} value={s.locs[loc.id].occTurf} now={baseline.locs[loc.id].occTurf}
                    format={(v) => `${v}%`} onChange={(v) => setLoc(loc.id, 'occTurf', v)} />
                )}
                <p className="muted small">{loc.cages} cages{loc.turfs ? `, ${loc.turfs} turf` : ''} · {hrs(loc.peakHours + loc.offHours)} open each a month ({hrs(loc.peakHours)} peak)</p>
              </details>

              <details className="card lever-group" open>
                <summary><h2>Costs</h2></summary>
                <Slider label="Monthly costs" min={0} max={5_000_000} step={25_000} value={s.locs[loc.id].fixedCents} now={0}
                  format={money} hint="Rent, staff, utilities, insurance, software" onChange={(v) => setLoc(loc.id, 'fixedCents', v)} />
                <Slider label="Cost per booked hour" min={0} max={2_000} step={50} value={s.locs[loc.id].varCentsPerHour} now={0}
                  format={(v) => `$${(v / 100).toFixed(2)}`} hint="Balls, machine wear, cleaning" onChange={(v) => setLoc(loc.id, 'varCentsPerHour', v)} />
              </details>
            </>
          ) : (
            <div className="card lever-group">
              <h2>Prices, how busy and costs</h2>
              <p className="muted small">These are set per location.</p>
              <div className="lever-locs">
                {locations.map((l) => (
                  <button key={l.id} className="btn btn-ghost btn-sm" onClick={() => setScope(l.id)}>{l.name}</button>
                ))}
              </div>
            </div>
          )}

          <details className="card lever-group" open>
            <summary><h2>Memberships</h2></summary>
            {scopeTiers.length === 0 && <p className="muted small">No tiers yet. <Link to="/admin/memberships">Add one</Link>.</p>}
            {scopeTiers.map((t) => {
              const tl = s.tiers[t.id];
              const b = baseline.tiers[t.id];
              return (
                <div key={t.id} className="tier-levers">
                  <h3>{t.name} <span className="muted small">{t.scope === 'all' ? 'all locations' : locations.find((l) => l.id === t.locationId)?.name}</span></h3>
                  <Slider label="Members" min={0} max={Math.max(200, b.members * 3)} step={1} value={tl.members} now={b.members}
                    format={(v) => String(v)} onChange={(v) => setTier(t.id, 'members', v)} />
                  <Slider label="Price" min={0} max={Math.max(30_000, b.priceCents * 3)} step={100} value={tl.priceCents} now={b.priceCents}
                    format={(v) => `${money(v)}/mo`} onChange={(v) => setTier(t.id, 'priceCents', v)} />
                  <Slider label="Included cage time" min={0} max={1_200} step={30} value={tl.includedMin} now={b.includedMin}
                    format={(v) => `${v / 60} hr/mo`} onChange={(v) => setTier(t.id, 'includedMin', v)} />
                </div>
              );
            })}
            <p className="muted small">Member numbers don’t react to price here; set them to what you expect at that price.</p>
          </details>

          <details className="card lever-group">
            <summary><h2>Assumptions</h2></summary>
            <Slider label="Price sensitivity" min={0} max={2} step={0.1} value={s.global.elasticity} now={baseline.global.elasticity}
              format={(v) => v.toFixed(1)} hint={`A 10% price rise loses ${Math.round(s.global.elasticity * 10)}% of bookings`} onChange={(v) => setGlobal('elasticity', v)} />
            <Slider label="Included time used" min={0} max={100} step={5} value={s.global.includedUse} now={baseline.global.includedUse}
              format={(v) => `${v}%`} hint="How much of their included time members actually book" onChange={(v) => setGlobal('includedUse', v)} />
            <Slider label="Paid hours booked by members" min={0} max={100} step={5} value={s.global.memberShare} now={baseline.global.memberShare}
              format={(v) => `${v}%`} hint="These get the member discount" onChange={(v) => setGlobal('memberShare', v)} />
            <Slider label="Card fees" min={0} max={6} step={0.1} value={s.global.feePct} now={baseline.global.feePct}
              format={(v) => `${v.toFixed(1)}%`} hint="Stripe is about 2.9% + 30¢" onChange={(v) => setGlobal('feePct', v)} />
          </details>
        </div>
      </div>
      <p className="muted small">A projection, not a promise: it uses your schedule, prices and tiers today, and the assumptions above. Your slider settings are saved on this device.</p>
    </section>
  );
}

function Line({ label, value, sub, strong }: { label: string; value: number; sub?: string; strong?: boolean }) {
  return (
    <div className={`proj-line${strong ? ' is-total' : ''}`}>
      <span>
        {label}
        {sub && <span className="muted small"> · {sub}</span>}
      </span>
      <span className={strong ? (value >= 0 ? 'up' : 'down') : ''}>{money(value)}</span>
    </div>
  );
}

function Slider({ label, min, max, step, value, now, format, hint, onChange }: {
  label: string; min: number; max: number; step: number; value: number; now: number;
  format(v: number): string; hint?: string; onChange(v: number): void;
}) {
  const id = useId();
  const moved = Math.abs(value - now) > step / 2;
  const nowPos = ((Math.min(max, Math.max(min, now)) - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-top">
        <label htmlFor={id}>{label}</label>
        <span className="slider-value">{format(value)}</span>
      </div>
      <div className="slider-track">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="slider-now" style={{ left: `${nowPos}%` }} aria-hidden="true" />
      </div>
      <div className="slider-foot muted small">
        <span>{hint}</span>
        {moved && (
          <button className="link-button small" onClick={() => onChange(now)}>Today: {format(now)}</button>
        )}
      </div>
    </div>
  );
}
