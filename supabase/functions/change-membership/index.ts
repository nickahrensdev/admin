// Switches the signed-in member to another tier and/or billing interval.
// Body: { tier_id, interval: 'month' | 'year', preview?: boolean }
//
// The change takes effect right away and Stripe prorates it:
//  * costs more  → the prorated difference is charged to their card now
//                  (if the card fails, nothing changes);
//  * costs less  → unused time is credited to their next bill.
// preview: true returns an estimate without changing anything.
import { CORS, adminClient, failure, json, requestUser, stripe } from '../_shared/common.ts';
import { syncSubscription } from '../_shared/memberships.ts';

type Interval = 'month' | 'year';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const { tier_id, interval, preview, sync } = await req.json().catch(() => ({}));
    const db = adminClient();

    // { sync: true }: re-read the member's subscription from Stripe (fixes anything a webhook missed).
    if (sync) {
      const { data: row } = await db
        .from('memberships')
        .select('stripe_subscription_id')
        .eq('user_id', user.id)
        .not('stripe_subscription_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const s = stripe();
      if (!row?.stripe_subscription_id || !s) return json({ synced: false });
      await syncSubscription(db, await s.subscriptions.retrieve(row.stripe_subscription_id));
      return json({ synced: true });
    }

    if (typeof tier_id !== 'string' || (interval !== 'month' && interval !== 'year')) {
      return json({ error: 'Pick a membership and billing option.' }, 400);
    }

    const { data: m, error: me } = await db
      .from('memberships')
      .select('id, tier_id, status, billing_interval, current_period_start, current_period_end, stripe_subscription_id')
      .eq('user_id', user.id)
      .in('status', ['active', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (me) throw me;
    if (!m?.stripe_subscription_id) return json({ error: 'You don’t have an active membership to change.' }, 404);
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

    // Estimate of today's charge (positive) or credit (negative).
    const now = Date.now();
    const start = m.current_period_start ? Date.parse(m.current_period_start) : now;
    const end = m.current_period_end ? Date.parse(m.current_period_end) : now;
    const left = end > start ? Math.min(1, Math.max(0, (end - now) / (end - start))) : 0;
    const unused = Math.round(oldPrice * left);
    const intervalChanges = interval !== m.billing_interval;
    // A new billing interval starts a fresh period today; otherwise only the rest of this period changes.
    const estimate = intervalChanges ? newPrice - unused : Math.round((newPrice - oldPrice) * left);

    if (preview) {
      return json({ estimate_cents: estimate, new_price_cents: newPrice, interval, period_end: m.current_period_end });
    }

    const s = stripe();
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

    const sub = await s.subscriptions.retrieve(m.stripe_subscription_id);
    const item = sub.items.data[0];
    if (!item) throw new Error('Subscription has no items');

    let updated;
    try {
      updated = await s.subscriptions.update(sub.id, {
        items: [{ id: item.id, price_data: { currency: 'usd', product, unit_amount: newPrice, recurring: { interval: interval as Interval } } }],
        proration_behavior: estimate > 0 || intervalChanges ? 'always_invoice' : 'create_prorations',
        payment_behavior: 'error_if_incomplete',
        metadata: { ...sub.metadata, user_id: user.id, tier_id: next.id },
      });
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      if ((err as any)?.type === 'StripeCardError') {
        return json({ error: 'Your card was declined, so nothing changed. Update it in Manage billing and try again.' }, 402);
      }
      throw err;
    }

    await syncSubscription(db, updated);
    return json({ ok: true, tier: next.name, interval });
  } catch (err) {
    console.error('change-membership failed', err);
    return json({ error: failure('Could not change your membership. Please try again.', err) }, 500);
  }
});
