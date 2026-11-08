-- Fix: switching tiers updates the subscription in Stripe, but the mirror only
-- updated status and dates, so the app kept showing the old tier. Keep tier_id
-- in step too.
create or replace function public.upsert_membership_from_stripe(
  p_user uuid, p_tier uuid, p_subscription text, p_customer text, p_status text, p_interval text,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text := case
    when p_status in ('active', 'trialing') then 'active'
    when p_status in ('past_due', 'unpaid') then 'past_due'
    when p_status in ('canceled', 'incomplete_expired') then 'canceled'
    else 'incomplete' end;
begin
  insert into public.memberships (user_id, tier_id, status, billing_interval, current_period_start, current_period_end,
                                  cancel_at_period_end, stripe_subscription_id, stripe_customer_id)
  values (p_user, p_tier, v_status, coalesce(p_interval, 'month'), p_period_start, p_period_end,
          coalesce(p_cancel_at_period_end, false), p_subscription, p_customer)
  on conflict (stripe_subscription_id) do update set
    tier_id = excluded.tier_id,
    status = excluded.status,
    billing_interval = excluded.billing_interval,
    current_period_start = coalesce(excluded.current_period_start, public.memberships.current_period_start),
    current_period_end = coalesce(excluded.current_period_end, public.memberships.current_period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, public.memberships.stripe_customer_id),
    updated_at = now();
  if p_customer is not null then
    update public.profiles set stripe_customer_id = p_customer where id = p_user and stripe_customer_id is null;
  end if;
end;
$$;
