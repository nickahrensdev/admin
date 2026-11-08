// Receives Stripe events.
// Bookings: confirms when Checkout is paid; frees slots when it expires.
// Memberships: mirrors every subscription change into public.memberships.
// Configure in Stripe: endpoint …/functions/v1/stripe-webhook with events
// checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.expired, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted.
import Stripe from 'npm:stripe@17';
import { adminClient, env, json, stripe } from '../_shared/common.ts';
import { syncSubscription } from '../_shared/memberships.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const s = stripe();
  if (!s) return json({ error: 'Stripe is not configured.' }, 503);

  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(body, signature ?? '', env('STRIPE_WEBHOOK_SECRET'), undefined, cryptoProvider);
  } catch (err) {
    console.error('Bad webhook signature', err);
    return json({ error: 'Invalid signature.' }, 400);
  }

  const db = adminClient();
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription') {
          if (typeof session.subscription === 'string') await syncSubscription(db, await s.subscriptions.retrieve(session.subscription), s);
          break;
        }
        if (session.payment_status !== 'paid') break;
        const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        const groupId = session.metadata?.group_id;
        const bookingId = session.metadata?.booking_id ?? (groupId ? undefined : session.client_reference_id);

        // Which bookings lost their slot while unpaid and must be refunded.
        let conflicts: { booking_id: string; total_cents: number }[] = [];
        if (groupId) {
          const { data, error } = await db.rpc('confirm_checkout_group', {
            p_group: groupId,
            p_session: session.id,
            p_payment_intent: paymentIntent ?? null,
          });
          if (error) throw error;
          conflicts = ((data ?? []) as { booking_id: string; result: string; total_cents: number }[]).filter((r) => r.result === 'conflict');
        } else if (bookingId) {
          const { data: result, error } = await db.rpc('confirm_booking_payment', {
            p_booking: bookingId,
            p_session: session.id,
            p_payment_intent: paymentIntent ?? null,
            p_amount_cents: session.amount_total ?? null,
          });
          if (error) throw error;
          if (result === 'conflict') conflicts = [{ booking_id: bookingId, total_cents: session.amount_total ?? 0 }];
        }

        for (const c of conflicts) {
          if (paymentIntent && c.total_cents > 0) {
            await s.refunds.create(
              { payment_intent: paymentIntent, amount: c.total_cents, metadata: { booking_id: c.booking_id, reason: 'slot_taken' } },
              { idempotencyKey: `conflict-${c.booking_id}` },
            );
          }
          const { error } = await db.rpc('mark_booking_cancelled', { p_booking: c.booking_id, p_refund_cents: c.total_cents });
          if (error) throw error;
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscription(db, event.data.object as Stripe.Subscription, s);
        break;
      }
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription') break;
        const groupId = session.metadata?.group_id;
        const bookingId = session.metadata?.booking_id;
        if (groupId) {
          const { error } = await db.rpc('expire_checkout_group', { p_group: groupId });
          if (error) throw error;
        } else if (bookingId ?? session.client_reference_id) {
          const { error } = await db.rpc('expire_booking', { p_booking: bookingId ?? session.client_reference_id });
          if (error) throw error;
        }
        break;
      }
    }
    return json({ received: true });
  } catch (err) {
    console.error(`Handling ${event.type} failed`, err);
    // A 500 makes Stripe retry later.
    return json({ error: 'Webhook handling failed.' }, 500);
  }
});
