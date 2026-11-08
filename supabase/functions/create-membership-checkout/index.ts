// Starts a Stripe Checkout subscription for a membership tier.
// Body: { tier_id, interval: 'month' | 'year' } → { url }
import { CORS, adminClient, appBaseUrl, json, requestUser, stripe, failure } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const { tier_id, interval } = await req.json().catch(() => ({}));
    if (typeof tier_id !== 'string' || (interval !== 'month' && interval !== 'year')) {
      return json({ error: 'Pick a membership and billing option.' }, 400);
    }

    const db = adminClient();
    const { data: tier, error } = await db
      .from('membership_tiers')
      .select('id, name, description, scope, is_active, monthly_price_cents, yearly_price_cents, location:locations(name)')
      .eq('id', tier_id)
      .maybeSingle();
    if (error) throw error;
    if (!tier || !tier.is_active) return json({ error: 'That membership isn’t available.' }, 404);
    const amount = interval === 'year' ? tier.yearly_price_cents : tier.monthly_price_cents;
    if (!amount) return json({ error: 'That membership isn’t available yearly.' }, 400);

    const { data: existing } = await db
      .from('memberships')
      .select('id')
      .eq('user_id', user.id)
      .in('status', ['active', 'past_due'])
      .limit(1);
    if (existing?.length) {
      return json({ error: 'You already have a membership. Use “Manage billing” to change or cancel it.' }, 409);
    }

    const s = stripe();
    if (!s) return json({ error: 'Online payments aren’t set up yet. Please try again later.' }, 503);

    // Reuse the customer's Stripe record so all their payments live together.
    const { data: profile } = await db.from('profiles').select('stripe_customer_id, display_name').eq('id', user.id).single();
    let customer = profile?.stripe_customer_id as string | null;
    if (!customer) {
      const c = await s.customers.create({
        email: user.email ?? undefined,
        name: profile?.display_name ?? undefined,
        metadata: { user_id: user.id },
      });
      customer = c.id;
      await db.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
    }

    // deno-lint-ignore no-explicit-any
    const locName = (tier.location as any)?.name;
    const base = appBaseUrl(req);
    const meta = { user_id: user.id, tier_id: tier.id };
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      metadata: meta,
      subscription_data: { metadata: meta },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amount,
          recurring: { interval },
          product_data: {
            name: `${tier.name} membership`,
            description: tier.scope === 'all' ? 'All locations' : (locName ?? undefined),
          },
        },
      }],
      success_url: `${base}#/memberships?joined=1`,
      cancel_url: `${base}#/memberships`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error('create-membership-checkout failed', err);
    return json({ error: failure('Could not start checkout. Please try again.', err) }, 500);
  }
});
