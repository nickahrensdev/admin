-- =====================================================================
-- Apply a tier's current price to existing members
-- =====================================================================
-- The apply-tier-price Edge Function moves each member of a tier to the
-- tier's current price at their first renewal after a notice period
-- (Stripe subscription schedule), records it here so the member sees it, and
-- emails them a notice.
-- =====================================================================

alter table public.memberships
  add column price_cents         integer,
  add column pending_price_cents integer,
  add column pending_price_at    timestamptz;

-- Price-change notices aren't about a booking.
alter table public.email_outbox alter column booking_id drop not null;
alter table public.email_outbox add column payload jsonb;
alter table public.email_outbox drop constraint email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation', 'cancellation', 'reminder', 'price_change'));

create or replace function public.email_claim(p_limit integer default 25)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- Don't send stale news (e.g. if email was switched on late) or reminders for sessions that changed.
  update public.email_outbox o
     set skipped_reason = 'stale'
   where o.sent_at is null and o.skipped_reason is null
     and o.kind in ('confirmation', 'cancellation', 'price_change') and o.created_at < now() - interval '24 hours';
  update public.email_outbox o
     set skipped_reason = 'booking changed'
    from public.bookings b
   where b.id = o.booking_id and o.sent_at is null and o.skipped_reason is null
     and o.kind = 'reminder' and (b.status <> 'confirmed' or b.starts_at <= now());
  update public.email_outbox o
     set skipped_reason = 'gave up'
   where o.sent_at is null and o.skipped_reason is null and o.attempts >= 5;

  select array_agg(id) into v_ids
    from (select id from public.email_outbox
           where sent_at is null and skipped_reason is null
             and (claimed_at is null or claimed_at < now() - interval '10 minutes')
           order by created_at
           limit greatest(1, least(coalesce(p_limit, 25), 100))
           for update skip locked) x;
  if v_ids is null then
    return '[]'::jsonb;
  end if;

  update public.email_outbox set claimed_at = now(), attempts = attempts + 1 where id = any (v_ids);

  return (
    select jsonb_agg(jsonb_build_object(
             'id', o.id,
             'kind', o.kind,
             'checkout_group', o.checkout_group,
             'to', p.email,
             'name', p.display_name,
             'payload', o.payload,
             'booking', case when b.id is null then null else jsonb_build_object(
               'id', b.id,
               'kind', b.kind,
               'status', b.status,
               'starts_at', b.starts_at,
               'ends_at', b.ends_at,
               'total_cents', b.total_cents,
               'discount_cents', b.discount_cents,
               'refund_cents', b.refund_cents,
               'payment_method', b.payment_method,
               'paid_online', b.stripe_payment_intent_id is not null,
               'location', jsonb_build_object('name', l.name, 'timezone', l.timezone, 'address', l.address),
               'items', (select jsonb_agg(jsonb_build_object('name', r.name, 'included_minutes', bi.included_minutes)
                                          order by r.sort_order, r.name)
                           from public.booking_items bi join public.resources r on r.id = bi.resource_id
                          where bi.booking_id = b.id)) end)
           order by coalesce(b.starts_at, o.created_at))
      from public.email_outbox o
      left join public.bookings b on b.id = o.booking_id
      left join public.locations l on l.id = b.location_id
      join public.profiles p on p.id = o.user_id
     where o.id = any (v_ids));
end;
$$;

-- Edge Functions only.
create or replace function public.set_membership_price(p_subscription text, p_cents integer)
returns void
language sql security definer
set search_path = ''
as $$
  update public.memberships set price_cents = p_cents where stripe_subscription_id = p_subscription;
$$;

create or replace function public.set_membership_price_pending(p_subscription text, p_cents integer, p_at timestamptz)
returns void
language sql security definer
set search_path = ''
as $$
  update public.memberships set pending_price_cents = p_cents, pending_price_at = p_at, updated_at = now()
   where stripe_subscription_id = p_subscription;
$$;

create or replace function public.queue_price_change_email(p_user uuid, p_payload jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.email_outbox (kind, user_id, payload) values ('price_change', p_user, p_payload);
$$;

-- Admin preview: who on this tier pays something other than the current price.
create or replace function public.admin_tier_price_status(p_tier uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  t record;
begin
  if not public.has_privilege('memberships_manage') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select * into t from public.membership_tiers where id = p_tier;
  return (
    select jsonb_build_object(
      'members', count(*),
      'at_current', count(*) filter (where m.price_cents = case when m.billing_interval = 'year' then t.yearly_price_cents else t.monthly_price_cents end),
      'unknown', count(*) filter (where m.price_cents is null),
      'scheduled', count(*) filter (where m.pending_price_cents is not null),
      'downgrading', count(*) filter (where m.pending_tier_id is not null))
      from public.memberships m
     where m.tier_id = p_tier and m.status in ('active', 'past_due') and m.stripe_subscription_id is not null);
end;
$$;

create or replace function public.my_membership()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select (select jsonb_build_object(
      'id', m.id, 'status', m.status, 'billing_interval', m.billing_interval,
      'current_period_end', m.current_period_end, 'cancel_at_period_end', m.cancel_at_period_end,
      'price_cents', m.price_cents,
      'tier', jsonb_build_object('id', t.id, 'name', t.name, 'scope', t.scope,
                'location_name', (select name from public.locations where id = t.location_id)),
      'pending', case when m.pending_tier_id is null then null else jsonb_build_object(
                  'tier_id', m.pending_tier_id,
                  'tier_name', (select name from public.membership_tiers where id = m.pending_tier_id),
                  'interval', m.pending_interval,
                  'starts_at', m.pending_starts_at) end,
      'pending_price', case when m.pending_price_cents is null then null else jsonb_build_object(
                  'cents', m.pending_price_cents, 'starts_at', m.pending_price_at) end)
    from public.memberships m join public.membership_tiers t on t.id = m.tier_id
   where m.user_id = auth.uid() and m.status in ('active', 'past_due', 'incomplete')
   order by (m.status = 'active') desc, m.created_at desc
   limit 1);
$$;

revoke execute on function public.set_membership_price(text, integer) from public, anon, authenticated;
revoke execute on function public.set_membership_price_pending(text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.queue_price_change_email(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_tier_price_status(uuid) from public, anon;
grant execute on function public.set_membership_price(text, integer) to service_role;
grant execute on function public.set_membership_price_pending(text, integer, timestamptz) to service_role;
grant execute on function public.queue_price_change_email(uuid, jsonb) to service_role;
grant execute on function public.admin_tier_price_status(uuid) to authenticated;
