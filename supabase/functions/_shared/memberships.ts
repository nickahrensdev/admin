import type Stripe from 'npm:stripe@17';

/** Mirrors a Stripe subscription into public.memberships. */
// deno-lint-ignore no-explicit-any
export async function syncSubscription(db: any, sub: Stripe.Subscription, s?: Stripe) {
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

  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  if (!scheduleId) {
    // No scheduled change in Stripe, so none in the app either.
    await db.rpc('set_membership_pending', { p_subscription: sub.id, p_tier: null, p_interval: null, p_starts_at: null });
  } else if (sub.metadata?.switch_applied === '1' && s) {
    // The scheduled downgrade has started: hand the subscription back to normal billing.
    await s.subscriptionSchedules.release(scheduleId).catch((e) => console.error('release schedule failed', e));
    await s.subscriptions.update(sub.id, { metadata: { switch_applied: '' } }).catch((e) => console.error('clear flag failed', e));
  }
}

