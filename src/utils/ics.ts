import type { MyBooking } from '../data/bookings';

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** An iCalendar (.ics) file for one booking: opens in Apple, Google or Outlook calendars. */
export function bookingIcs(b: Pick<MyBooking, 'id' | 'starts_at' | 'ends_at' | 'items' | 'location'>, now = new Date()): string {
  const what = (b.items ?? []).map((i) => i.name).join(', ') || 'Session';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Yard//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${b.id}@the-yard`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(b.starts_at)}`,
    `DTEND:${stamp(b.ends_at)}`,
    `SUMMARY:${esc(`The Yard: ${what}`)}`,
    `LOCATION:${esc(b.location.address || b.location.name)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function downloadIcs(b: Pick<MyBooking, 'id' | 'starts_at' | 'ends_at' | 'items' | 'location'>) {
  const url = URL.createObjectURL(new Blob([bookingIcs(b)], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'the-yard-booking.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Map directions to a location (by address, falling back to the name). */
export function directionsUrl(location: { name: string; address?: string | null }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.address || `The Yard ${location.name}`)}`;
}
