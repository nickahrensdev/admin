import type Stripe from 'npm:stripe@17';

/** Mirrors a Stripe subscription into public.memberships. */
// deno-lint-ignore no-explicit-any
export async function syncSubscription(db: any, sub: Stripe.Subscription) {
  const userId = sub.metadata?.user_id;
  const tierId = sub.metadata?.tier_id;
  if (!userId || !tierId) return; // not one of ours
  // Newer Stripe API versions keep the billing period on the subscription item.
  // deno-lint-ignore no-explicit-any
  const item = sub.items?.data?.[0] as any;
  // deno-lint-ignore no-explicit-any
  const anySub = sub as any;
  const start = anySub.current_period_start ?? item?.current_period_start;
  const end = anySub.current_period_end ?? item?.current_period_end;
  const { error } = await db.rpc('upsert_membership_from_stripe', {
    p_user: userId,
    p_tier: tierId,
    p_subscription: sub.id,
    p_customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    p_status: sub.status,
    p_interval: item?.price?.recurring?.interval ?? item?.plan?.interval ?? 'month',
    p_period_start: start ? new Date(start * 1000).toISOString() : null,
    p_period_end: end ? new Date(end * 1000).toISOString() : null,
    p_cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  });
  if (error) throw error;
}

