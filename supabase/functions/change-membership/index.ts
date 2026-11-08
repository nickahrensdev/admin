// Changes the signed-in member's tier and/or billing interval.
//
// Body:
//   { tier_id, interval: 'month' | 'year', preview?: true }  switch (or estimate)
//   { cancel_pending: true }                                  undo a scheduled downgrade
//   { sync: true }                                            re-read the subscription from Stripe
//
// Rules (so nobody gets time they didn't pay for):
//  * Higher tier, or the same tier monthly → yearly: takes effect now and the
//    prorated difference is charged immediately. If the card fails, nothing changes.
//  * Lower tier, or yearly → monthly: scheduled for the next renewal. The member
//    keeps the current plan until then; no partial credit.
import Stripe from 'npm:stripe@17';
import { CORS, adminClient, failure, json, requestUser, stripe } from '../_shared/common.ts';
import { syncSubscription } from '../_shared/memberships.ts';

type Interval = 'month' | 'year';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const body = await req.json().catch(() => ({}));
    const { tier_id, interval, preview, sync, cancel_pending } = body ?? {};
    const db = adminClient();
    const s = stripe();

    const { data: m, error: me } = await db
      .from('memberships')
      .select('id, tier_id, status, billing_interval, current_period_start, current_period_end, stripe_subscription_id, pending_tier_id')
      .eq('user_id', user.id)
      .not('stripe_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (me) throw me;

    if (sync) {
      if (!m?.stripe_subscription_id || !s) return json({ synced: false });
      await syncSubscription(db, await s.subscriptions.retrieve(m.stripe_subscription_id), s);
      return json({ synced: true });
    }

    if (!m || !['active', 'past_due'].includes(m.status)) {
      return json({ error: 'You don’t have an active membership to change.' }, 404);
    }

    if (cancel_pending) {
      if (!s) return json({ error: 'Online payments aren’t set up yet. Please try again later.' }, 503);
      const sub = await s.subscriptions.retrieve(m.stripe_subscription_id);
      const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
      if (scheduleId) await s.subscriptionSchedules.release(scheduleId);
      await db.rpc('set_membership_pending', { p_subscription: sub.id, p_tier: null, p_interval: null, p_starts_at: null });
      return json({ ok: true });
    }

    if (typeof tier_id !== 'string' || (interval !== 'month' && interval !== 'year')) {
      return json({ error: 'Pick a membership and billing option.' }, 400);
    }
    if (m.status === 'past_due') {
      return json({ error: 'Your last payment didn’t go through. Update your card in Manage billing first.' }, 409);
    }
    if (m.tier_id === tier_id && m.billing_interval === interval) {
      return json({ error: 'That’s already your plan.' }, 400);
    }

    const { data: tiers, error: te } = await db
      .from('membership_tiers')
      .select('id, name, scope, is_active, monthly_price_cents, yearly_price_cents, stripe_product_id, location:locations!membership_tiers_location_id_fkey(name)')
      .in('id', [tier_id, m.tier_id]);
    if (te) throw te;
    const next = tiers?.find((t) => t.id === tier_id);
    const current = tiers?.find((t) => t.id === m.tier_id);
    if (!next || !next.is_active) return json({ error: 'That membership isn’t available.' }, 404);
    const newPrice = interval === 'year' ? next.yearly_price_cents : next.monthly_price_cents;
    if (!newPrice) return json({ error: 'That membership isn’t available yearly.' }, 400);
    const oldPrice = current
      ? m.billing_interval === 'year'
        ? (current.yearly_price_cents ?? current.monthly_price_cents * 12)
        : current.monthly_price_cents
      : 0;

    // What an immediate switch would cost today (negative = it would be a credit).
    const now = Date.now();
    const start = m.current_period_start ? Date.parse(m.current_period_start) : now;
    const end = m.current_period_end ? Date.parse(m.current_period_end) : now;
    const left = end > start ? Math.min(1, Math.max(0, (end - now) / (end - start))) : 0;
    const intervalChanges = interval !== m.billing_interval;
    const estimate = intervalChanges ? newPrice - Math.round(oldPrice * left) : Math.round((newPrice - oldPrice) * left);
    // Moving to a higher tier (or the same tier from monthly to yearly) starts now;
    // a lower tier (or yearly to monthly) waits for the renewal.
    const sameTier = next.id === m.tier_id;
    const immediate = sameTier
      ? interval === 'year'
      : next.monthly_price_cents > (current?.monthly_price_cents ?? 0);

    if (preview) {
      return json({
        mode: immediate ? 'now' : 'renewal',
        charge_today_cents: immediate ? Math.max(0, estimate) : 0,
        new_price_cents: newPrice,
        interval,
        starts_at: immediate ? new Date().toISOString() : m.current_period_end,
      });
    }

    if (!s) return json({ error: 'Online payments aren’t set up yet. Please try again later.' }, 503);

    // Each tier has one Stripe product; prices are set per subscription.
    let product = next.stripe_product_id as string | null;
    if (!product) {
      // deno-lint-ignore no-explicit-any
      const locName = (next.location as any)?.name;
      const p = await s.products.create({
        name: `${next.name} membership`,
        description: next.scope === 'all' ? 'All locations' : (locName ?? undefined),
        metadata: { tier_id: next.id },
      });
      product = p.id;
      await db.from('membership_tiers').update({ stripe_product_id: product }).eq('id', next.id);
    }
    const priceData = { currency: 'usd', product, unit_amount: newPrice, recurring: { interval: interval as Interval } };

    const sub = await s.subscriptions.retrieve(m.stripe_subscription_id);
    const item = sub.items.data[0];
    if (!item) throw new Error('Subscription has no items');
    const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;

    if (immediate) {
      // An upgrade replaces any downgrade that was scheduled.
      if (scheduleId) await s.subscriptionSchedules.release(scheduleId);
      let updated: Stripe.Subscription;
      try {
        updated = await s.subscriptions.update(sub.id, {
          items: [{ id: item.id, price_data: priceData }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          metadata: { ...sub.metadata, user_id: user.id, tier_id: next.id, switch_applied: '' },
        });
      } catch (err) {
        // deno-lint-ignore no-explicit-any
        if ((err as any)?.type === 'StripeCardError') {
          return json({ error: 'Your card was declined, so nothing changed. Update it in Manage billing and try again.' }, 402);
        }
        throw err;
      }
      await syncSubscription(db, updated, s);
      return json({ ok: true, mode: 'now', tier: next.name, interval });
    }

    // Downgrade: keep the current price until the period ends, then switch.
    // deno-lint-ignore no-explicit-any
    const periodEnd: number = (sub as any).current_period_end ?? (item as any).current_period_end;
    const schedule = scheduleId
      ? await s.subscriptionSchedules.retrieve(scheduleId)
      : await s.subscriptionSchedules.create({ from_subscription: sub.id });
    const phaseStart = schedule.current_phase?.start_date ?? schedule.phases[0]?.start_date;
    await s.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      phases: [
        {
          // Inline prices can't be reused, so restate the current price.
          items: [{
            price_data: {
              currency: item.price.currency,
              product: typeof item.price.product === 'string' ? item.price.product : item.price.product.id,
              unit_amount: item.price.unit_amount ?? oldPrice,
              recurring: { interval: (item.price.recurring?.interval ?? m.billing_interval) as Interval },
            },
            quantity: 1,
          }],
          start_date: phaseStart,
          end_date: periodEnd,
          proration_behavior: 'none',
          metadata: { ...sub.metadata, user_id: user.id, tier_id: m.tier_id, switch_applied: '' },
        },
        {
          items: [{ price_data: priceData, quantity: 1 }],
          iterations: 1,
          proration_behavior: 'none',
          metadata: { user_id: user.id, tier_id: next.id, switch_applied: '1' },
        },
      ],
    });
    const startsAt = new Date(periodEnd * 1000).toISOString();
    await db.rpc('set_membership_pending', { p_subscription: sub.id, p_tier: next.id, p_interval: interval, p_starts_at: startsAt });
    // A downgrade replaces any scheduled price change on the old tier.
    await db.rpc('set_membership_price_pending', { p_subscription: sub.id, p_cents: null, p_at: null });
    return json({ ok: true, mode: 'renewal', tier: next.name, interval, starts_at: startsAt });
  } catch (err) {
    console.error('change-membership failed', err);
    return json({ error: failure('Could not change your membership. Please try again.', err) }, 500);
  }
});
