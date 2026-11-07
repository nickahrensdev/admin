/** Weekdays in display order (Monday first). Values match the database: 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 0, short: 'Sun', long: 'Sunday' },
];

/** "15:00:00" or "15:00" → "15:00" */
export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

/** "15:00" → "3:00 PM" */
export function formatTime(t: string): string {
  const [h, m] = hhmm(t).split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Every half hour of the day: "00:00", "00:30", … "23:30". */
export const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);

/** YYYY-MM-DD for a local date. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-12-25" → "Fri, Dec 25, 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Cents → "$20.00" */
export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

/** Common US holidays falling in the next 12 months, soonest first. */
export function upcomingHolidays(from = new Date()): { date: string; name: string }[] {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  const out: { date: string; name: string }[] = [];
  for (const y of [start.getFullYear(), start.getFullYear() + 1]) {
    const list: [Date, string][] = [
      [new Date(y, 0, 1), "New Year's Day"],
      [lastWeekday(y, 4, 1), 'Memorial Day'],
      [new Date(y, 6, 4), 'Independence Day'],
      [nthWeekday(y, 8, 1, 1), 'Labor Day'],
      [nthWeekday(y, 10, 4, 4), 'Thanksgiving'],
      [new Date(y, 11, 24), 'Christmas Eve'],
      [new Date(y, 11, 25), 'Christmas Day'],
      [new Date(y, 11, 31), "New Year's Eve"],
    ];
    for (const [d, name] of list) {
      if (d >= start && d < end) out.push({ date: isoDate(d), name });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
