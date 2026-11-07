// Cancels one of the signed-in customer's bookings.
// Paid bookings: full refund if cancelled 24+ hours before the start,
// 50% refund after that. Unpaid holds are simply released.
// Body: { booking_id } → { refund_cents }
import { CORS, adminClient, json, refundFor, requestUser, stripe } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const { booking_id } = await req.json().catch(() => ({}));
    if (typeof booking_id !== 'string') return json({ error: 'Missing booking.' }, 400);

    const db = adminClient();
    const { data: booking, error } = await db
      .from('bookings')
      .select('id, user_id, status, starts_at, total_cents, stripe_payment_intent_id')
      .eq('id', booking_id)
      .maybeSingle();
    if (error) throw error;
    if (!booking || booking.user_id !== user.id) return json({ error: 'Booking not found.' }, 404);

    if (booking.status === 'pending') {
      const { error: e } = await db.rpc('expire_booking', { p_booking: booking.id });
      if (e) throw e;
      return json({ refund_cents: 0 });
    }
    if (booking.status !== 'confirmed') return json({ error: 'This booking is already cancelled.' }, 409);
    if (new Date(booking.starts_at) <= new Date()) {
      return json({ error: 'This booking has already started and can’t be cancelled online.' }, 409);
    }

    const refund = refundFor(booking.total_cents, new Date(booking.starts_at));
    if (refund > 0 && booking.stripe_payment_intent_id) {
      const s = stripe();
      if (!s) return json({ error: 'Refunds aren’t available right now. Please contact us.' }, 503);
      await s.refunds.create(
        { payment_intent: booking.stripe_payment_intent_id, amount: refund, metadata: { booking_id: booking.id, reason: 'customer_cancelled' } },
        { idempotencyKey: `cancel-${booking.id}` },
      );
    }

    const { error: e } = await db.rpc('mark_booking_cancelled', { p_booking: booking.id, p_refund_cents: refund });
    if (e) throw e;
    return json({ refund_cents: refund });
  } catch (err) {
    console.error('cancel-booking failed', err);
    return json({ error: 'Could not cancel. Please try again.' }, 500);
  }
});
