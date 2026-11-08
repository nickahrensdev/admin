import { assert, assertEquals } from './assert.ts';
import { refundFor } from '../_shared/common.ts';
import { planChange } from '../change-membership/plan.ts';
import { addInterval, firstRenewalAfter } from '../apply-tier-price/plan.ts';

const H = 3_600_000;

Deno.test('refunds: full refund 24+ hours ahead, half after that', () => {
  const now = new Date('2030-01-10T12:00:00Z');
  assertEquals(refundFor(5000, new Date(now.getTime() + 25 * H), now), 5000);
  assertEquals(refundFor(5000, new Date(now.getTime() + 24 * H), now), 5000);
  assertEquals(refundFor(5000, new Date(now.getTime() + 23 * H), now), 2500);
  assertEquals(refundFor(4999, new Date(now.getTime() + 1 * H), now), 2499, 'half rounds down');
});

const base = {
  currentInterval: 'month' as const,
  periodStart: '2030-01-01T00:00:00Z',
  periodEnd: '2030-01-31T00:00:00Z',
  now: Date.parse('2030-01-11T00:00:00Z'), // 2/3 of the period left
};

Deno.test('plan change: higher tier is immediate and charges the prorated difference', () => {
  const r = planChange({ ...base, sameTier: false, currentMonthlyCents: 4900, nextMonthlyCents: 9900, oldPriceCents: 4900, newPriceCents: 9900, nextInterval: 'month' });
  assert(r.immediate);
  assertEquals(r.estimate, 3333);
});

Deno.test('plan change: lower tier waits for renewal', () => {
  const r = planChange({ ...base, sameTier: false, currentMonthlyCents: 9900, nextMonthlyCents: 4900, oldPriceCents: 9900, newPriceCents: 4900, nextInterval: 'month' });
  assertEquals(r.immediate, false);
});

Deno.test('plan change: lower tier on a yearly plan still waits (no credit loophole)', () => {
  const r = planChange({ ...base, sameTier: false, currentMonthlyCents: 9900, nextMonthlyCents: 4900, oldPriceCents: 9900, newPriceCents: 49000, nextInterval: 'year' });
  assertEquals(r.immediate, false);
  assert(r.estimate > 0, 'it would cost more today, but it is still a lower tier');
});

Deno.test('plan change: same tier monthly → yearly is immediate; yearly → monthly waits', () => {
  const up = planChange({ ...base, sameTier: true, currentMonthlyCents: 4900, nextMonthlyCents: 4900, oldPriceCents: 4900, newPriceCents: 49000, nextInterval: 'year' });
  assert(up.immediate);
  assertEquals(up.estimate, 49000 - 3267, 'new year minus unused month');
  const down = planChange({ ...base, currentInterval: 'year', sameTier: true, currentMonthlyCents: 4900, nextMonthlyCents: 4900, oldPriceCents: 49000, newPriceCents: 4900, nextInterval: 'month' });
  assertEquals(down.immediate, false);
});

Deno.test('price change: first renewal after the notice period', () => {
  const end = Date.parse('2030-01-31T15:00:00Z') / 1000;
  assertEquals(firstRenewalAfter(end, 'month', end - 86_400), end, 'renewal already far enough away');
  const tooSoon = end + 10 * 86_400;
  const next = firstRenewalAfter(end, 'month', tooSoon);
  assertEquals(new Date(next * 1000).toISOString().slice(0, 10), '2030-03-03', 'next monthly renewal (Jan 31 + 1 month rolls over)');
  assertEquals(new Date(addInterval(end, 'year') * 1000).toISOString().slice(0, 10), '2031-01-31');
});
