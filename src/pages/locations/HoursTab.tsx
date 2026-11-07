import { getHours, saveHours, type DayHours } from '../../data/locations';
import SaveBar from '../../components/SaveBar';
import TimeSelect from '../../components/TimeSelect';
import Toggle from '../../components/Toggle';
import { WEEKDAYS } from '../../utils/time';
import { useEditable } from '../../utils/useEditable';

export default function HoursTab({ locationId }: { locationId: string }) {
  const ed = useEditable<DayHours[]>(() => getHours(locationId), (v) => saveHours(locationId, v), [locationId]);
  if (ed.loading || !ed.value) return <div className="page-loading">Loading…</div>;
  const days = ed.value;

  const setDay = (weekday: number, patch: Partial<DayHours>) =>
    ed.setValue((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));

  const copyMonday = () => {
    const mon = days.find((d) => d.weekday === 1)!;
    ed.setValue((prev) =>
      prev.map((d) => (d.weekday >= 2 && d.weekday <= 5 ? { ...d, is_closed: mon.is_closed, opens_at: mon.opens_at, closes_at: mon.closes_at } : d)),
    );
  };

  return (
    <div className="card stack">
      <div className="section-head">
        <div>
          <h2>Weekly hours</h2>
          <p className="muted small">When customers can book. Times are in 30-minute steps.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copyMonday}>
          Copy Monday to Tue–Fri
        </button>
      </div>

      <div className="week">
        {WEEKDAYS.map(({ value, long, short }) => {
          const d = days.find((x) => x.weekday === value)!;
          const invalid = !d.is_closed && d.closes_at <= d.opens_at;
          return (
            <div key={value} className={`day-row${d.is_closed ? ' is-closed' : ''}${invalid ? ' invalid' : ''}`}>
              <span className="day-name">
                <span className="long">{long}</span>
                <span className="short">{short}</span>
              </span>
              <Toggle checked={!d.is_closed} onChange={(open) => setDay(value, { is_closed: !open })} label={`${long} open`} text={d.is_closed ? 'Closed' : 'Open'} />
              <div className="time-range">
                <TimeSelect label={`${long} opens`} value={d.opens_at} disabled={d.is_closed} onChange={(v) => setDay(value, { opens_at: v })} />
                <span className="muted">to</span>
                <TimeSelect label={`${long} closes`} value={d.closes_at} disabled={d.is_closed} onChange={(v) => setDay(value, { closes_at: v })} />
              </div>
            </div>
          );
        })}
      </div>

      <SaveBar dirty={ed.dirty} saving={ed.saving} onSave={ed.save} onReset={ed.reset} error={ed.error} saved={ed.saved} />
    </div>
  );
}
