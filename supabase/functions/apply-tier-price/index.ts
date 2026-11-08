// Moves current members of a tier to the tier's current price.
// Body: { tier_id, notice_days } → { changed, unchanged, skipped: [{ name, reason }] }
// Admins only (memberships_manage).
//
// Each member switches at their first renewal at least `notice_days` from now
// (a Stripe subscription schedule; nothing is charged early), sees the change
// on their Membership page, and gets an email notice.
import Stripe from 'npm:stripe@17';
import { CORS, adminClient, failure, json, requestUser, stripe } from '../_shared/common.ts';

import { firstRenewalAfter, type Interval } from './plan.ts';


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);
    const db = adminClient();
    const { data: allowed } = await db.rpc('user_has_privilege', { p_user: user.id, p_privilege: 'memberships_manage', p_location: null });
    if (!allowed) return json({ error: 'You don’t have permission to do that.' }, 403);

    const { tier_id, notice_days } = await req.json().catch(() => ({}));
    const notice = Number(notice_days);
    if (typeof tier_id !== 'string' || !Number.isInteger(notice) || notice < 0 || notice > 120) {
      return json({ error: 'Pick a tier and a notice period of 0–120 days.' }, 400);
    }

    const { data: tier, error: te } = await db
      .from('membership_tiers')
      .select('id, name, monthly_price_cents, yearly_price_cents')
      .eq('id', tier_id)
      .maybeSingle();
    if (te) throw te;
    if (!tier) return json({ error: 'Tier not found.' }, 404);

    const s = stripe();
    if (!s) return json({ error: 'Online payments aren’t set up yet.' }, 503);

    const { data: members, error: me } = await db
      .from('memberships')
      .select('user_id, billing_interval, stripe_subscription_id, pending_tier_id, profile:profiles(display_name)')
      .eq('tier_id', tier.id)
      .in('status', ['active', 'past_due'])
      .not('stripe_subscription_id', 'is', null);
    if (me) throw me;

    const cutoff = Math.floor(Date.now() / 1000) + notice * 86_400;
    let changed = 0;
    let unchanged = 0;
    const skipped: { name: string; reason: string }[] = [];

    for (const m of members ?? []) {
      // deno-lint-ignore no-explicit-any
      const name = (m.profile as any)?.display_name ?? 'A member';
      try {
        const interval = m.billing_interval as Interval;
        const target = interval === 'year' ? tier.yearly_price_cents : tier.monthly_price_cents;
        if (!target) {
          skipped.push({ name, reason: 'this tier has no yearly price' });
          continue;
        }
        if (m.pending_tier_id) {
          skipped.push({ name, reason: 'already switching to another tier at renewal' });
          continue;
        }
        const sub = await s.subscriptions.retrieve(m.stripe_subscription_id);
        const item = sub.items.data[0];
        const current = item?.price?.unit_amount ?? null;
        if (!item || current === null) {
          skipped.push({ name, reason: 'subscription has no price' });
          continue;
        }
        await db.rpc('set_membership_price', { p_subscription: sub.id, p_cents: current });
        if (current === target) {
          unchanged++;
          continue;
        }

        // First renewal at least `notice` days away.
        // deno-lint-ignore no-explicit-any
        const effective = firstRenewalAfter((sub as any).current_period_end ?? (item as any).current_period_end, interval, cutoff);

        const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
        const schedule = scheduleId
          ? await s.subscriptionSchedules.retrieve(scheduleId)
          : await s.subscriptionSchedules.create({ from_subscription: sub.id });
        const product = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
        const meta = { ...sub.metadata, switch_applied: '' };
        await s.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price_data: { currency: item.price.currency, product, unit_amount: current, recurring: { interval } }, quantity: 1 }],
              start_date: schedule.current_phase?.start_date ?? schedule.phases[0]?.start_date,
              end_date: effective,
              proration_behavior: 'none',
              metadata: meta,
            },
            {
              items: [{ price_data: { currency: item.price.currency, product, unit_amount: target, recurring: { interval } }, quantity: 1 }],
              iterations: 1,
              proration_behavior: 'none',
              metadata: { ...meta, switch_applied: '1' },
            },
          ],
        } as Stripe.SubscriptionScheduleUpdateParams);

        const effectiveIso = new Date(effective * 1000).toISOString();
        await db.rpc('set_membership_price_pending', { p_subscription: sub.id, p_cents: target, p_at: effectiveIso });
        await db.rpc('queue_price_change_email', {
          p_user: m.user_id,
          p_payload: { tier: tier.name, old_cents: current, new_cents: target, interval, effective_at: effectiveIso },
        });
        changed++;
      } catch (err) {
        console.error('apply-tier-price: member failed', m.stripe_subscription_id, err);
        skipped.push({ name, reason: 'Stripe couldn’t update this subscription' });
      }
    }

    return json({ changed, unchanged, skipped });
  } catch (err) {
    console.error('apply-tier-price failed', err);
    return json({ error: failure('Could not apply the new price. Please try again.', err) }, 500);
  }
});
