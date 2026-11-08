import { describe, expect, it } from 'vitest';
import type { MyBooking } from '../data/bookings';
import { bookAgainLink, lastRegular } from './rebook';
import { bookingIcs, directionsUrl } from './ics';

const tz = 'America/Chicago';
const booking = (over: Partial<MyBooking>): MyBooking => ({
  id: 'b1',
  kind: 'online',
  status: 'confirmed',
  starts_at: '2026-11-10T21:00:00Z', // Tue 3:00 PM Chicago
  ends_at: '2026-11-10T22:00:00Z',
  total_cents: 5000,
  refund_cents: 0,
  hold_expires_at: null,
  created_at: '2026-11-01T12:00:00Z',
  location: { id: 'loc', name: 'Location 1', timezone: tz, address: '1 Main St, Town' },
  items: [{ resource_id: 'c1', name: 'Cage 1', type: 'batting_cage', price_cents: 5000 }],
  ...over,
});

describe('lastRegular', () => {
  it('suggests the same cage, weekday, time and length', () => {
    const r = lastRegular([booking({})], new Date('2026-11-08T18:00:00Z'))!; // Sun
    expect(r.date).toBe('2026-11-10');
    expect(r.time).toBe('15:00');
    expect(r.slots).toBe(2);
    expect(r.label).toBe('Cage 1 · Tue 3 PM · 1 hr');
    expect(bookAgainLink(r)).toBe('/book?loc=loc&date=2026-11-10&time=15%3A00&len=2&res=c1');
  });

  it('skips to next week once today’s time has passed', () => {
    const r = lastRegular([booking({})], new Date('2026-11-10T22:30:00Z'))!; // Tue 4:30 PM
    expect(r.date).toBe('2026-11-17');
  });

  it('uses the most recently made booking and ignores walk-ins and cancellations', () => {
    const list = [
      booking({ id: 'old', created_at: '2026-10-01T00:00:00Z' }),
      booking({ id: 'walk', kind: 'walk_in', created_at: '2026-11-05T00:00:00Z', items: [{ resource_id: 'c9', name: 'Cage 9', type: 'batting_cage', price_cents: 0 }] }),
      booking({ id: 'gone', status: 'cancelled', created_at: '2026-11-06T00:00:00Z' }),
    ];
    expect(lastRegular(list, new Date('2026-11-08T18:00:00Z'))!.resourceIds).toEqual(['c1']);
  });

  it('returns null with nothing to repeat', () => {
    expect(lastRegular([booking({ items: [{ name: 'Cage 1', type: 'batting_cage', price_cents: 0 }] })])).toBeNull();
    expect(lastRegular([])).toBeNull();
  });
});

describe('calendar and directions', () => {
  it('builds an .ics event in UTC with escaped text', () => {
    const ics = bookingIcs(booking({}), new Date('2026-11-08T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261110T210000Z');
    expect(ics).toContain('DTEND:20261110T220000Z');
    expect(ics).toContain('SUMMARY:The Yard: Cage 1');
    expect(ics).toContain('LOCATION:1 Main St\\, Town');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });

  it('links directions to the address, or the name when there is none', () => {
    expect(directionsUrl({ name: 'Location 1', address: '1 Main St' })).toContain('destination=1%20Main%20St');
    expect(directionsUrl({ name: 'Location 1', address: null })).toContain('The%20Yard%20Location%201');
  });
});
