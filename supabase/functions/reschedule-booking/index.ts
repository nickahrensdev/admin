// Moves a customer's own online booking to a new date/time (same length).
// Body: { booking_id, starts_at } → { starts_at, ends_at, resources, refund_cents }
// Allowed until 24 hours before the start. Repriced at the new time: if it
// costs less, the difference is refunded to their card; if more, it's refused.
import { CORS, adminClient, failure, json, requestUser, stripe } from '../_shared/common.ts';

const FRIENDLY = new Set(['22023', 'P0002', '23P01']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const { booking_id, starts_at } = await req.json().catch(() => ({}));
    if (typeof booking_id !== 'string' || typeof starts_at !== 'string' || Number.isNaN(Date.parse(starts_at))) {
      return json({ error: 'Pick a new date and time.' }, 400);
    }

    const db = adminClient();
    const args = { p_user: user.id, p_booking: booking_id, p_starts_at: starts_at };

    // 1. Work out the result without changing anything.
    const { data: plan, error: pe } = await db.rpc('reschedule_booking_core', { ...args, p_dry_run: true });
    if (pe) {
      if (FRIENDLY.has(pe.code ?? '')) return json({ error: pe.message }, 409);
      throw pe;
    }
    const refund = Number(plan?.refund_cents ?? 0);

    // 2. Refund the difference first, so it's never recorded without being paid back.
    if (refund > 0) {
      const { data: b, error: be } = await db.from('bookings').select('stripe_payment_intent_id').eq('id', booking_id).single();
      if (be) throw be;
      if (b?.stripe_payment_intent_id) {
        const s = stripe();
        if (!s) return json({ error: 'Changes aren’t available right now. Please try again later.' }, 503);
        await s.refunds.create(
          { payment_intent: b.stripe_payment_intent_id, amount: refund, metadata: { booking_id, reason: 'rescheduled' } },
          { idempotencyKey: `reschedule-${booking_id}-${plan.starts_at}` },
        );
      }
    }

    // 3. Make the change.
    const { data: done, error: ae } = await db.rpc('reschedule_booking_core', { ...args, p_dry_run: false });
    if (ae) {
      console.error('reschedule-booking: apply failed after refund', booking_id, refund, ae);
      if (FRIENDLY.has(ae.code ?? '')) return json({ error: ae.message }, 409);
      throw ae;
    }
    return json(done);
  } catch (err) {
    console.error('reschedule-booking failed', err);
    return json({ error: failure('Could not change your booking. Please try again.', err) }, 500);
  }
});
