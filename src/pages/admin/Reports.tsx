import { useEffect, useMemo, useState } from 'react';
import ColumnChart from '../../components/ColumnChart';
import { listLocations, type Location } from '../../data/locations';
import { reportSummary, type Report } from '../../data/reports';
import { formatMoney, isoDate } from '../../utils/time';

type Preset = '7d' | '30d' | 'month' | 'last-month' | 'year' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

function rangeFor(p: Preset): [string, string] {
  const now = new Date();
  const today = isoDate(now);
  const back = (n: number) => isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  switch (p) {
    case '7d': return [back(6), today];
    case '30d': return [back(29), today];
    case 'month': return [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), today];
    case 'last-month': return [isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), isoDate(new Date(now.getFullYear(), now.getMonth(), 0))];
    case 'year': return [isoDate(new Date(now.getFullYear(), 0, 1)), today];
    default: return [back(29), today];
  }
}

const METHOD: Record<string, string> = {
  online: 'Paid online',
  included: 'Membership included',
  cash: 'Cash at desk',
  card: 'Card at desk',
  comp: 'Comp',
  other: 'Other',
};
const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
const long = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
const compactMoney = (cents: number) => {
  const d = cents / 100;
  return d >= 10_000 ? `$${Math.round(d / 1000)}K` : `$${d.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

export default function Reports() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor('30d'));
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string>('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listLocations().then((l) => setLocations(l)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    reportSummary(from, to, locationId || null)
      .then((r) => {
        if (!live) return;
        setReport(r);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to, locationId]);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(rangeFor(p));
  };

  const util = useMemo(() => {
    const u = report?.utilization ?? [];
    const cage = u.find((x) => x.type === 'batting_cage');
    const turf = u.find((x) => x.type === 'turf');
    const all = u.reduce((a, x) => ({ open: a.open + x.open_hours, booked: a.booked + x.booked_hours }), { open: 0, booked: 0 });
    return { cage, turf, all };
  }, [report]);

  const downloadCsv = () => {
    if (!report) return;
    const rows = [['date', 'net_revenue', 'sessions', 'hours_booked'], ...report.daily.map((d) => [d.day, (d.net_cents / 100).toFixed(2), d.bookings, d.hours])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `the-yard-daily-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const r = report;
  return (
    <section className="reports">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">By session date. Revenue is what customers paid for sessions, minus refunds.</p>
        </div>
        {r && <button className="btn btn-ghost btn-sm" onClick={downloadCsv}>Download daily CSV</button>}
      </div>

      <div className="report-filters">
        <div className="segmented" role="radiogroup" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p.id} role="radio" aria-checked={preset === p.id} className={preset === p.id ? 'active' : ''} onClick={() => pickPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="custom-range">
            <input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} />
            <span className="muted">to</span>
            <input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} />
          </div>
        )}
        {locations.length > 1 && (
          <select className="location-select" aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!r && !error && <div className="page-loading">Loading…</div>}

      {r && (
        <div className={loading ? 'is-refreshing' : ''}>
          <p className="muted small">{long(r.from)} – {long(r.to)}</p>
          <div className="kpi-grid">
            <div className="card kpi">
              <span className="kpi-label">Net revenue</span>
              <strong>{formatMoney(r.revenue.net_cents)}</strong>
              <span className="kpi-sub">{formatMoney(r.revenue.gross_cents)} paid · {formatMoney(r.revenue.refund_cents)} refunded</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Sessions</span>
              <strong>{r.bookings.confirmed}</strong>
              <span className="kpi-sub">{r.bookings.walk_ins} walk-in · {r.bookings.cancelled} cancelled · {r.bookings.customers} customers</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Hours booked</span>
              <strong>{r.bookings.session_hours}</strong>
              <span className="kpi-sub">{r.bookings.included_hours} hr from memberships</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Utilization</span>
              <strong>{pct(util.all.booked, util.all.open)}%</strong>
              <span className="kpi-sub">
                Cages {pct(util.cage?.booked_hours ?? 0, util.cage?.open_hours ?? 0)}% · Turf {pct(util.turf?.booked_hours ?? 0, util.turf?.open_hours ?? 0)}% of open hours
              </span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Members</span>
              <strong>{r.memberships.active}</strong>
              <span className="kpi-sub">≈{formatMoney(r.memberships.mrr_cents)}/mo recurring · {r.memberships.new_in_range} new</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">New accounts</span>
              <strong>{r.signups}</strong>
              <span className="kpi-sub">{r.bookings.no_shows} no-shows · {pct(r.bookings.checked_in, r.bookings.confirmed)}% checked in</span>
            </div>
          </div>

          <div className="report-charts">
            <div className="card">
              <h2 className="chart-title">Net revenue by day</h2>
              <ColumnChart
                data={r.daily.map((d) => ({ label: short(d.day), value: d.net_cents, title: long(d.day) }))}
                format={compactMoney}
                valueLabel="Net revenue"
              />
            </div>
            <div className="card">
              <h2 className="chart-title">Hours booked by day</h2>
              <ColumnChart
                data={r.daily.map((d) => ({ label: short(d.day), value: d.hours, title: long(d.day) }))}
                format={(v) => `${+v.toFixed(1)} hr`}
                valueLabel="Hours booked"
              />
            </div>
            <div className="card">
              <h2 className="chart-title">Busiest times</h2>
              <p className="muted small">Share of open cage and turf time booked, by hour of day</p>
              <ColumnChart
                data={r.by_hour.map((h) => ({
                  label: hourLabel(h.hour),
                  value: pct(h.booked_slots, h.open_slots),
                  title: `${hourLabel(h.hour)}m–${hourLabel((h.hour + 1) % 24)}m`,
                }))}
                format={(v) => `${Math.round(v)}%`}
                valueLabel="Booked"
                max={Math.max(25, Math.ceil(Math.max(0, ...r.by_hour.map((h) => pct(h.booked_slots, h.open_slots))) / 25) * 25)}
              />
            </div>
          </div>

          <div className="report-tables">
            <div>
              <h2 className="section-title">Revenue by payment</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Method</th><th className="num">Sessions</th><th className="num">Net</th></tr></thead>
                  <tbody>
                    {r.by_method.length === 0 && <tr><td colSpan={3} className="muted">No sessions in this range.</td></tr>}
                    {r.by_method.map((m) => (
                      <tr key={m.method}><td>{METHOD[m.method] ?? m.method}</td><td className="num">{m.bookings}</td><td className="num">{formatMoney(m.net_cents)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Member discounts given: {formatMoney(r.revenue.member_discount_cents)} · Comps (list value): {formatMoney(r.revenue.comp_value_cents)}
              </p>
            </div>

            <div>
              <h2 className="section-title">Cages vs turf</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th></th><th className="num">Open hrs</th><th className="num">Booked</th><th className="num">Blocked</th><th className="num">Used</th></tr></thead>
                  <tbody>
                    {r.utilization.map((u) => (
                      <tr key={u.type}>
                        <td>{u.type === 'turf' ? 'Turf' : 'Batting cages'}</td>
                        <td className="num">{u.open_hours}</td>
                        <td className="num">{u.booked_hours}</td>
                        <td className="num">{u.blocked_hours}</td>
                        <td className="num">{pct(u.booked_hours, u.open_hours)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="section-title">Top customers</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Customer</th><th className="num">Sessions</th><th className="num">Hours</th><th className="num">Net</th></tr></thead>
                  <tbody>
                    {r.top_customers.length === 0 && <tr><td colSpan={4} className="muted">No customers in this range.</td></tr>}
                    {r.top_customers.map((c, i) => (
                      <tr key={i}>
                        <td>{c.name} {c.username ? <span className="muted">@{c.username}</span> : <span className="muted">(guest)</span>}</td>
                        <td className="num">{c.bookings}</td>
                        <td className="num">{c.hours}</td>
                        <td className="num">{formatMoney(c.net_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="section-title">Memberships (today)</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Tier</th><th className="num">Active members</th></tr></thead>
                  <tbody>
                    {r.memberships.by_tier.map((t) => (
                      <tr key={t.tier}><td>{t.tier}</td><td className="num">{t.members}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                {r.memberships.ending} cancelling at period end · {r.memberships.past_due} with a failed payment. Recurring revenue is an
                estimate from active plans; Stripe has the exact payouts.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
