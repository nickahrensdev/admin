import { WEEKDAYS } from './time';

/**
 * Groups consecutive weekdays (Mon → Sun) that share the same text into ranges:
 * "Mon–Fri 3:00 PM – 10:00 PM", "Sat–Sun …". Rows whose label is null are left out.
 */
export function groupDays<T>(rows: T[], weekday: (r: T) => number, label: (r: T) => string | null): { days: string; text: string }[] {
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
