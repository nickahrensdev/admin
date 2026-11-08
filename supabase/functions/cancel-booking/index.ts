// Cancels a booking.
//
// Customers (body: { booking_id }) cancel their own online bookings:
//   full refund 24+ hours before the start, 50% after that. Unpaid holds are
//   simply released. Walk-ins booked at the desk can't be cancelled online.
//
// Staff with bookings_manage at the booking's location
// (body: { booking_id, refund: 'full' | 'policy' | 'none' }) can cancel any
// booking, walk-in or blocked time, choosing the refund. Online payments are
// refunded through Stripe; for walk-ins the amount is recorded so the desk
// can hand it back.
//
// → { refund_cents, refunded_online }
import { CORS, adminClient, failure, json, refundFor, requestUser, stripe } from '../_shared/common.ts';

type RefundChoice = 'full' | 'policy' | 'none';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const body = await req.json().catch(() => ({}));
    const bookingId = body?.booking_id;
    const choice: RefundChoice | undefined = body?.refund;
    if (typeof bookingId !== 'string') return json({ error: 'Missing booking.' }, 400);
    if (choice !== undefined && !['full', 'policy', 'none'].includes(choice)) {
      return json({ error: 'Pick a refund option.' }, 400);
    }
    const staffMode = choice !== undefined;

    const db = adminClient();
    const { data: booking, error } = await db
      .from('bookings')
      .select('id, user_id, kind, location_id, status, starts_at, total_cents, refund_cents, stripe_payment_intent_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) throw error;
    if (!booking) return json({ error: 'Booking not found.' }, 404);

    if (staffMode) {
      const { data: allowed, error: pe } = await db.rpc('user_has_privilege', {
        p_user: user.id,
        p_privilege: 'bookings_manage',
        p_location: booking.location_id,
      });
      if (pe) throw pe;
      if (!allowed) return json({ error: 'Booking not found.' }, 404);
    } else {
      if (booking.user_id !== user.id) return json({ error: 'Booking not found.' }, 404);
      if (booking.kind !== 'online') {
        return json({ error: 'This booking was made at the front desk. Please contact us to change it.' }, 409);
      }
    }

    if (booking.status === 'pending') {
      const { error: e } = await db.rpc('expire_booking', { p_booking: booking.id });
      if (e) throw e;
      return json({ refund_cents: 0, refunded_online: false });
    }
    if (booking.status !== 'confirmed') return json({ error: 'This booking is already cancelled.' }, 409);

    const starts = new Date(booking.starts_at);
    if (!staffMode && starts <= new Date()) {
      return json({ error: 'This booking has already started and can’t be cancelled online.' }, 409);
    }

    // What's still held: earlier partial refunds (e.g. after a reschedule) are already paid back.
    const held = Math.max(0, booking.total_cents - (booking.refund_cents ?? 0));
    let refund: number;
    if (!staffMode) refund = refundFor(held, starts);
    else if (booking.kind === 'block' || choice === 'none') refund = 0;
    else if (choice === 'full') refund = held;
    else refund = refundFor(held, starts);

    const online = refund > 0 && Boolean(booking.stripe_payment_intent_id);
    if (online) {
      const s = stripe();
      if (!s) return json({ error: 'Refunds aren’t available right now. Please try again later.' }, 503);
      await s.refunds.create(
        {
          payment_intent: booking.stripe_payment_intent_id,
          amount: refund,
          metadata: { booking_id: booking.id, reason: staffMode ? 'staff_cancelled' : 'customer_cancelled' },
        },
        { idempotencyKey: `cancel-${booking.id}-${refund}` },
      );
    }

    const { error: e } = staffMode
      ? await db.rpc('staff_mark_cancelled', { p_booking: booking.id, p_refund_cents: refund, p_by: user.id })
      : await db.rpc('mark_booking_cancelled', { p_booking: booking.id, p_refund_cents: refund });
    if (e) throw e;
    return json({ refund_cents: refund, refunded_online: online });
  } catch (err) {
    console.error('cancel-booking failed', err);
    return json({ error: failure('Could not cancel. Please try again.', err) }, 500);
  }
});
