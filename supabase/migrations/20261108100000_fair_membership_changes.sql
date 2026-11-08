-- =====================================================================
-- Fairer membership changes
-- =====================================================================
-- 1. Downgrades (anything that would give a credit) take effect at the next
--    renewal instead of immediately. The member keeps the current tier until
--    then; memberships.pending_* records the scheduled change for the app.
--    (Stripe side: a subscription schedule, see change-membership.)
-- 2. Included cage time only covers sessions before the end of the period the
--    member has paid for (memberships.current_period_end), so future months
--    can't be booked for free and then cancelled or downgraded.
-- =====================================================================

alter table public.memberships
  add column pending_tier_id   uuid references public.membership_tiers (id),
  add column pending_interval  text check (pending_interval is null or pending_interval in ('month', 'year')),
  add column pending_starts_at timestamptz;

-- member_benefits gains paid_until (end of the paid period).
drop function public.member_benefits(uuid, uuid);
create or replace function public.member_benefits(p_uid uuid, p_location uuid)
returns table (membership_id uuid, tier_name text, included_cage_minutes int, cage_discount_pct int,
               turf_discount_pct int, booking_window_days int, max_upcoming_bookings int, paid_until timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.id, t.name, b.included_cage_minutes, b.cage_discount_pct, b.turf_discount_pct,
         b.booking_window_days, b.max_upcoming_bookings, m.current_period_end
    from public.memberships m
    join public.membership_tiers t on t.id = m.tier_id
    join public.tier_location_benefits b on b.tier_id = t.id and b.location_id = p_location
   where m.user_id = p_uid
     and m.status = 'active'
     and (m.current_period_end is null or m.current_period_end > now())
     and (t.scope = 'all' or t.location_id = p_location)
   order by b.included_cage_minutes desc, b.cage_discount_pct desc, b.turf_discount_pct desc
   limit 1;
$$;
revoke execute on function public.member_benefits(uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_benefits(uuid, uuid) to service_role;

create or replace function public.price_booking(
  p_uid uuid, p_location uuid, p_resource_ids uuid[], p_slots jsonb, p_exclude_group uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz        text;
  m           record;
  v_month     text;
  v_used      jsonb := '{}'::jsonb; -- month -> minutes used so far
  v_slot      jsonb;
  v_start     timestamptz;
  v_end       timestamptz;
  r           record;
  s           timestamptz;
  v_list      int;
  v_slot_list int;
  v_price     int;
  v_incl      int;
  v_items     jsonb;
  v_dates     jsonb := '[]'::jsonb;
  v_total     int := 0;
  v_disc      int := 0;
  v_dtotal    int;
  v_ddisc     int;
  v_dincl     int;
  v_left      int;
begin
  select timezone into v_tz from public.locations where id = p_location;
  select * into m from public.member_benefits(p_uid, p_location);

  for v_slot in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    v_start := (v_slot ->> 'starts_at')::timestamptz;
    v_end   := (v_slot ->> 'ends_at')::timestamptz;
    v_month := to_char(v_start at time zone v_tz, 'YYYY-MM');

    -- Included minutes already used this calendar month (outside this request).
    if m.membership_id is not null and not (v_used ? v_month) then
      v_used := v_used || jsonb_build_object(v_month, coalesce((
        select sum(bi.included_minutes)
          from public.booking_items bi
          join public.bookings b on b.id = bi.booking_id
         where b.membership_id = m.membership_id
           and bi.active
           and b.status in ('pending', 'confirmed')
           and (p_exclude_group is null or b.checkout_group is distinct from p_exclude_group)
           and to_char(b.starts_at at time zone v_tz, 'YYYY-MM') = v_month), 0));
    end if;

    v_items := '[]'::jsonb;
    v_dtotal := 0; v_ddisc := 0; v_dincl := 0;
    for r in select id, name, type from public.resources where id = any (p_resource_ids) order by sort_order, name loop
      v_list := 0; v_price := 0; v_incl := 0;
      for s in select generate_series(v_start, v_end - interval '30 minutes', interval '30 minutes') loop
        v_slot_list := public.slot_price_cents(p_location, r.type, s);
        if v_slot_list is null then
          raise exception 'Prices aren''t set up for this location yet.' using errcode = '22023';
        end if;
        v_list := v_list + v_slot_list;
        if m.membership_id is null then
          v_price := v_price + v_slot_list;
        elsif r.type = 'batting_cage' then
          v_left := m.included_cage_minutes - (v_used ->> v_month)::int;
          -- Included time only covers sessions inside the period already paid for.
          if v_left >= 30 and s < coalesce(m.paid_until, now()) then
            v_incl := v_incl + 30;
            v_used := jsonb_set(v_used, array[v_month], to_jsonb((v_used ->> v_month)::int + 30));
          else
            v_price := v_price + round(v_slot_list * (100 - m.cage_discount_pct) / 100.0)::int;
          end if;
        else
          v_price := v_price + round(v_slot_list * (100 - m.turf_discount_pct) / 100.0)::int;
        end if;
      end loop;
      v_items := v_items || jsonb_build_object('resource_id', r.id, 'name', r.name, 'type', r.type,
                   'list_cents', v_list, 'price_cents', v_price, 'included_minutes', v_incl);
      v_dtotal := v_dtotal + v_price;
      v_ddisc := v_ddisc + (v_list - v_price);
      v_dincl := v_dincl + v_incl;
    end loop;

    v_dates := v_dates || jsonb_build_object('starts_at', v_start, 'ends_at', v_end, 'total_cents', v_dtotal,
                 'discount_cents', v_ddisc, 'included_minutes', v_dincl, 'items', v_items);
    v_total := v_total + v_dtotal;
    v_disc := v_disc + v_ddisc;
  end loop;

  return jsonb_build_object(
    'member', case when m.membership_id is null then null else jsonb_build_object(
      'membership_id', m.membership_id, 'tier_name', m.tier_name,
      'included_cage_minutes', m.included_cage_minutes,
      'cage_discount_pct', m.cage_discount_pct, 'turf_discount_pct', m.turf_discount_pct,
      'booking_window_days', m.booking_window_days) end,
    'total_cents', v_total,
    'discount_cents', v_disc,
    'dates', v_dates);
end;
$$;

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
    -- A scheduled change has happened once the tier and interval match it.
    pending_tier_id = case when excluded.tier_id = public.memberships.pending_tier_id
                            and excluded.billing_interval = public.memberships.pending_interval
                           then null else public.memberships.pending_tier_id end,
    pending_interval = case when excluded.tier_id = public.memberships.pending_tier_id
                             and excluded.billing_interval = public.memberships.pending_interval
                            then null else public.memberships.pending_interval end,
    pending_starts_at = case when excluded.tier_id = public.memberships.pending_tier_id
                              and excluded.billing_interval = public.memberships.pending_interval
                             then null else public.memberships.pending_starts_at end,
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


-- Records (or clears, with nulls) a scheduled change. Edge Functions only.
create or replace function public.set_membership_pending(p_subscription text, p_tier uuid, p_interval text, p_starts_at timestamptz)
returns void
language sql security definer
set search_path = ''
as $$
  update public.memberships
     set pending_tier_id = p_tier, pending_interval = p_interval, pending_starts_at = p_starts_at, updated_at = now()
   where stripe_subscription_id = p_subscription;
$$;
revoke execute on function public.set_membership_pending(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_membership_pending(text, uuid, text, timestamptz) to service_role;

create or replace function public.my_membership()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select (select jsonb_build_object(
      'id', m.id, 'status', m.status, 'billing_interval', m.billing_interval,
      'current_period_end', m.current_period_end, 'cancel_at_period_end', m.cancel_at_period_end,
      'tier', jsonb_build_object('id', t.id, 'name', t.name, 'scope', t.scope,
                'location_name', (select name from public.locations where id = t.location_id)),
      'pending', case when m.pending_tier_id is null then null else jsonb_build_object(
                  'tier_id', m.pending_tier_id,
                  'tier_name', (select name from public.membership_tiers where id = m.pending_tier_id),
                  'interval', m.pending_interval,
                  'starts_at', m.pending_starts_at) end)
    from public.memberships m join public.membership_tiers t on t.id = m.tier_id
   where m.user_id = auth.uid() and m.status in ('active', 'past_due', 'incomplete')
   order by (m.status = 'active') desc, m.created_at desc
   limit 1);
$$;
