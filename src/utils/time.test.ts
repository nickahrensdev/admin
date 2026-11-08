import { describe, expect, it } from 'vitest';
import { formatMoney, formatTime, hhmm, HALF_HOURS } from './time';
import { addDays, todayIn } from './dates';
import { groupDays } from './hours';

describe('time helpers', () => {
  it('formats times and money', () => {
    expect(hhmm('15:00:00')).toBe('15:00');
    expect(formatTime('15:00')).toBe('3:00 PM');
    expect(formatTime('00:30')).toBe('12:30 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatMoney(4950)).toMatch(/49\.50/);
    expect(HALF_HOURS).toHaveLength(48);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it("gives today's date in the location's time zone", () => {
    // 3 AM UTC on Nov 8 is still Nov 7 in Chicago.
    expect(todayIn('America/Chicago', new Date('2026-11-08T03:00:00Z'))).toBe('2026-11-07');
  });
});

describe('opening hours summary', () => {
  const hours = [1, 2, 3, 4, 5].map((d) => ({ d, t: '3–10' })).concat([6, 0].map((d) => ({ d, t: '8–8' })));
  it('groups matching weekdays', () => {
    expect(groupDays(hours, (h) => h.d, (h) => h.t)).toEqual([
      { days: 'Mon–Fri', text: '3–10' },
      { days: 'Sat–Sun', text: '8–8' },
    ]);
  });
  it('says "Every day" for a full week and skips empty rows', () => {
    const all = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, t: 'x' }));
    expect(groupDays(all, (h) => h.d, (h) => h.t)).toEqual([{ days: 'Every day', text: 'x' }]);
    expect(groupDays(all, (h) => h.d, (h) => (h.d === 3 ? 'y' : null))).toEqual([{ days: 'Wed', text: 'y' }]);
  });
});
