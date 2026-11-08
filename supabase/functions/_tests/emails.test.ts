import { assert, assertEquals, assertStringIncludes } from './assert.ts';
import { render, renderNotice, renderPriceChange, type Job } from '../send-emails/render.ts';

function job(over: Omit<Partial<Job>, 'booking'> & { booking?: Partial<Job['booking']> } = {}): Job {
  const { booking, ...rest } = over;
  return {
    id: crypto.randomUUID(),
    kind: 'confirmation',
    payload: null,
    checkout_group: 'g1',
    to: 'bob@test.local',
    name: 'Bob',
    ...rest,
    booking: {
      id: crypto.randomUUID(),
      kind: 'online',
      status: 'confirmed',
      starts_at: '2030-01-15T23:00:00Z', // 5 PM Chicago
      ends_at: '2030-01-16T00:00:00Z',
      total_cents: 5000,
      discount_cents: 0,
      refund_cents: 0,
      payment_method: 'stripe',
      paid_online: true,
      location: { name: 'The Yard — Location 1', timezone: 'America/Chicago', address: null },
      items: [{ name: 'Cage 1', included_minutes: 0 }],
      ...booking,
    },
  };
}

Deno.test('confirmation: one email lists every date of a checkout', () => {
  const a = job();
  const b = job({ booking: { starts_at: '2030-01-22T23:00:00Z', ends_at: '2030-01-23T00:00:00Z' } });
  const { subject, html, text } = render([a, b]);
  assertEquals(subject, "You're booked: 2 sessions starting Tue, Jan 15 at 5:00 PM");
  assertStringIncludes(html, 'Tue, Jan 22');
  assertStringIncludes(text, 'Paid: $100.00 online');
  assertStringIncludes(text, 'Cage 1');
});

Deno.test('confirmation: free with membership and walk-ins say so', () => {
  const free = render([job({ booking: { total_cents: 0, items: [{ name: 'Cage 2', included_minutes: 60 }] } })]);
  assertStringIncludes(free.text, 'Covered by your membership');
  assertStringIncludes(free.text, 'Included cage time: 1 hr');
  const walk = render([job({ booking: { kind: 'walk_in', payment_method: 'cash' } })]);
  assertStringIncludes(walk.text, 'at the front desk');
  assertStringIncludes(walk.text, '$50.00 at the desk (cash)');
});

Deno.test('cancellation and reminder wording', () => {
  const c = render([job({ kind: 'cancellation', booking: { status: 'cancelled', refund_cents: 2500 } })]);
  assertEquals(c.subject, 'Booking cancelled: Tue, Jan 15 at 5:00 PM');
  assertStringIncludes(c.text, '$25.00 back to your card');
  const r = render([job({ kind: 'reminder' })]);
  assertEquals(r.subject, 'Reminder: Tue, Jan 15 at 5:00 PM');
});

Deno.test('names are escaped in HTML', () => {
  const { html } = render([job({ name: '<script>alert(1)</script>' })]);
  assert(!html.includes('<script>'), 'raw script tag must not appear');
  assertStringIncludes(html, '&lt;script&gt;');
});

Deno.test('price change notice', () => {
  const { subject, text } = renderPriceChange(job({
    kind: 'price_change',
    payload: { tier: 'Rookie', old_cents: 4900, new_cents: 5900, interval: 'month', effective_at: '2030-03-01T18:00:00Z' },
  }));
  assertEquals(subject, 'Your Rookie membership price is changing on March 1, 2030');
  assertStringIncludes(text, '$59.00/month (currently $49.00/month)');
});

Deno.test('staff notice to a day’s customers', () => {
  const { subject, text, html } = renderNotice(job({
    kind: 'notice',
    payload: { subject: 'Closing at 6 PM', body: 'Storm coming.\n\nSessions after 6 are cancelled and refunded.', location: 'Location 1', date: '2030-03-01' },
  }));
  assertEquals(subject, 'Closing at 6 PM (Location 1)');
  assertStringIncludes(text, 'About your booking at Location 1 on Friday, March 1');
  assertStringIncludes(text, 'Sessions after 6 are cancelled and refunded.');
  assertStringIncludes(html, 'View my bookings');
});
