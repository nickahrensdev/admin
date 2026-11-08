import type { MyBooking } from '../data/bookings';
import { addDays, todayIn } from './dates';

export interface Regular {
  locationId: string;
  resourceIds: string[];
  /** Next date on the same weekday (YYYY-MM-DD, location time). */
  date: string;
  /** Start time "HH:MM" in the location's time zone. */
  time: string;
  /** Length in 30-minute slots. */
  slots: number;
  label: string;
}

const parts = (iso: string, tz: string) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, time: `${p.hour}:${p.minute}` };
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The customer's most recent booking they made themselves, as a "book the
 * same again" suggestion for the next matching weekday. Null when there's
 * nothing to repeat (no online bookings, or the items have no ids).
 */
export function lastRegular(bookings: MyBooking[], now = new Date()): Regular | null {
  const b = bookings
    .filter((x) => x.status === 'confirmed' && x.kind !== 'walk_in' && (x.items ?? []).length > 0 && (x.items ?? []).every((i) => i.resource_id))
    .sort((a, c) => Date.parse(c.created_at) - Date.parse(a.created_at))[0];
  if (!b) return null;
  const tz = b.location.timezone;
  const start = parts(b.starts_at, tz);
  const nowLocal = parts(now.toISOString(), tz);
  const today = todayIn(tz, now);
  const todayIdx = WEEKDAYS.indexOf(nowLocal.weekday);
  const wantIdx = WEEKDAYS.indexOf(start.weekday);
  let ahead = (wantIdx - todayIdx + 7) % 7;
  if (ahead === 0 && start.time <= nowLocal.time) ahead = 7;
  const slots = Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 1_800_000);
  const [h, m] = start.time.split(':').map(Number);
  const clock = `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  const len = slots === 1 ? '30 min' : `${slots / 2} hr`;
  return {
    locationId: b.location.id,
    resourceIds: (b.items ?? []).map((i) => i.resource_id!),
    date: addDays(today, ahead),
    time: start.time,
    slots,
    label: `${(b.items ?? []).map((i) => i.name).join(', ')} · ${start.weekday} ${clock} · ${len}`,
  };
}

/** Link to the booking page with everything filled in. */
export function bookAgainLink(r: Regular): string {
  const q = new URLSearchParams({ loc: r.locationId, date: r.date, time: r.time, len: String(r.slots), res: r.resourceIds.join(',') });
  return `/book?${q.toString()}`;
}
