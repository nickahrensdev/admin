-- =====================================================================
-- Revenue and usage reports (super admin by default)
-- =====================================================================
-- Everything is reported by SESSION date (the local date at the location),
-- not by payment date. Revenue = what customers paid for those sessions
-- minus refunds. Membership revenue comes from Stripe subscriptions and is
-- shown as an estimate from active plans (MRR).
-- =====================================================================

insert into public.privileges (code, description) values
  ('reports_view', 'See revenue and usage reports for every location');

create or replace function public.report_summary(p_from date, p_to date, p_location uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.has_privilege('reports_view') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a valid date range.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Pick a range of a year or less.' using errcode = '22023';
  end if;

  with
  locs as (
    select id, timezone from public.locations
     where (p_location is null or id = p_location)
  ),
  days as (
    select l.id as location_id, l.timezone, d::date as day
      from locs l, generate_series(p_from, p_to, interval '1 day') d
  ),
  -- Bookings whose session falls in the range (customers only; blocks are counted separately).
  bk as (
    select b.*, (b.starts_at at time zone l.timezone)::date as day,
           extract(epoch from (b.ends_at - b.starts_at)) / 3600.0 as hours,
           (select count(*) from public.booking_items bi where bi.booking_id = b.id) as n_items
      from public.bookings b
      join locs l on l.id = b.location_id
     where (b.starts_at at time zone l.timezone)::date between p_from and p_to
       and b.status in ('confirmed', 'cancelled')
  ),
  cust as (select * from bk where kind <> 'block'),
  -- Opening hours x active cages/turf, per day.
  open_time as (
    select d.location_id, d.day, w.opens_at, w.closes_at,
           extract(epoch from (w.closes_at - w.opens_at)) / 3600.0 as hours
      from days d
      cross join lateral public.location_day_window(d.location_id, d.day) w
     where w.opens_at is not null
  ),
  res as (
    select r.id, r.location_id, r.type from public.resources r join locs l on l.id = r.location_id where r.is_active
  ),
  capacity as (
    select r.type, sum(o.hours) as hours
      from open_time o join res r on r.location_id = o.location_id
     group by r.type
  ),
  -- Booked / blocked resource-hours inside opening hours.
  used as (
    select r.type,
           sum(case when b.kind <> 'block' then extract(epoch from (least(bi.ends_at, o.closes_at) - greatest(bi.starts_at, o.opens_at))) / 3600.0 else 0 end) as booked,
           sum(case when b.kind = 'block' then extract(epoch from (least(bi.ends_at, o.closes_at) - greatest(bi.starts_at, o.opens_at))) / 3600.0 else 0 end) as blocked
      from public.booking_items bi
      join public.bookings b on b.id = bi.booking_id and b.status = 'confirmed'
      join res r on r.id = bi.resource_id
      join open_time o on o.location_id = b.location_id
                      and bi.starts_at < o.closes_at and bi.ends_at > o.opens_at
     where bi.active
     group by r.type
  ),
  -- Occupancy by local hour of day: share of open cage/turf half-hours that were booked.
  slots as (
    select o.location_id, s, extract(hour from s at time zone d.timezone)::int as hr
      from open_time o
      join days d on d.location_id = o.location_id and d.day = o.day
      cross join lateral generate_series(o.opens_at, o.closes_at - interval '30 minutes', interval '30 minutes') s
  ),
  by_hour as (
    select sl.hr,
           sum((select count(*) from res r where r.location_id = sl.location_id)) as open_slots,
           sum((select count(distinct bi.resource_id)
                  from public.booking_items bi
                  join public.bookings b on b.id = bi.booking_id
                 where bi.active and b.status = 'confirmed' and b.kind <> 'block'
                   and b.location_id = sl.location_id
                   and bi.starts_at < sl.s + interval '30 minutes' and bi.ends_at > sl.s)) as booked_slots
      from slots sl
     group by sl.hr
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'revenue', (select jsonb_build_object(
        'gross_cents', coalesce(sum(total_cents), 0),
        'refund_cents', coalesce(sum(refund_cents), 0),
        'net_cents', coalesce(sum(total_cents - refund_cents), 0),
        'member_discount_cents', coalesce(sum(discount_cents) filter (where payment_method is distinct from 'comp'), 0),
        'comp_value_cents', coalesce(sum(discount_cents) filter (where payment_method = 'comp'), 0))
      from cust),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'bookings', n, 'net_cents', net) order by method) from (
        select case when kind = 'online' then (case when total_cents = 0 and refund_cents = 0 then 'included' else 'online' end)
                    else coalesce(payment_method, 'other') end as method,
               count(*) as n, sum(total_cents - refund_cents) as net
          from cust group by 1) s), '[]'::jsonb),
    'bookings', (select jsonb_build_object(
        'confirmed', count(*) filter (where status = 'confirmed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'walk_ins', count(*) filter (where status = 'confirmed' and kind = 'walk_in'),
        'online', count(*) filter (where status = 'confirmed' and kind = 'online'),
        'checked_in', count(*) filter (where status = 'confirmed' and checked_in_at is not null),
        'no_shows', count(*) filter (where status = 'confirmed' and no_show),
        'customers', count(distinct coalesce(user_id::text, guest_name)) filter (where status = 'confirmed'),
        'session_hours', round(coalesce(sum(hours * n_items) filter (where status = 'confirmed'), 0)::numeric, 1),
        'included_hours', round(coalesce((select sum(bi.included_minutes) / 60.0 from public.booking_items bi
                                     join cust c on c.id = bi.booking_id where c.status = 'confirmed'), 0)::numeric, 1))
      from cust),
    'utilization', coalesce((select jsonb_agg(jsonb_build_object(
        'type', c.type,
        'open_hours', round(c.hours::numeric, 1),
        'booked_hours', round(coalesce(u.booked, 0)::numeric, 1),
        'blocked_hours', round(coalesce(u.blocked, 0)::numeric, 1)) order by c.type)
      from capacity c left join used u on u.type = c.type), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', g.day,
        'net_cents', coalesce((select sum(total_cents - refund_cents) from cust where cust.day = g.day), 0),
        'bookings', coalesce((select count(*) from cust where cust.day = g.day and status = 'confirmed'), 0),
        'hours', round(coalesce((select sum(hours * n_items) from cust where cust.day = g.day and status = 'confirmed'), 0)::numeric, 1))
        order by g.day)
      from (select generate_series(p_from, p_to, interval '1 day')::date as day) g), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object(
        'hour', hr, 'open_slots', open_slots, 'booked_slots', booked_slots) order by hr)
      from by_hour), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
                 'name', coalesce(p.display_name, k.guest, 'Guest'),
                 'username', p.username,
                 'bookings', k.bookings,
                 'hours', k.hours,
                 'net_cents', k.net) as x
          from (select c.user_id,
                       case when c.user_id is null then c.guest_name end as guest,
                       count(*) filter (where c.status = 'confirmed') as bookings,
                       round(coalesce(sum(c.hours * c.n_items) filter (where c.status = 'confirmed'), 0)::numeric, 1) as hours,
                       sum(c.total_cents - c.refund_cents) as net
                  from cust c
                 group by c.user_id, case when c.user_id is null then c.guest_name end) k
          left join public.profiles p on p.id = k.user_id
         order by k.net desc, k.bookings desc
         limit 10) s), '[]'::jsonb),
    'memberships', (select jsonb_build_object(
        'active', count(*) filter (where m.status in ('active', 'past_due')),
        'past_due', count(*) filter (where m.status = 'past_due'),
        'ending', count(*) filter (where m.status = 'active' and m.cancel_at_period_end),
        'new_in_range', count(*) filter (where (m.created_at at time zone 'America/Chicago')::date between p_from and p_to
                                           and m.status <> 'incomplete'),
        'mrr_cents', coalesce(sum(case when m.billing_interval = 'year' then round(coalesce(t.yearly_price_cents, t.monthly_price_cents * 12) / 12.0)
                                       else t.monthly_price_cents end)
                              filter (where m.status in ('active', 'past_due') and not m.cancel_at_period_end), 0),
        'by_tier', coalesce((select jsonb_agg(jsonb_build_object('tier', t2.name, 'members', (
                                select count(*) from public.memberships m2 where m2.tier_id = t2.id and m2.status in ('active', 'past_due')))
                              order by t2.sort_order, t2.name)
                              from public.membership_tiers t2), '[]'::jsonb))
      from public.memberships m join public.membership_tiers t on t.id = m.tier_id),
    'signups', (select count(*) from public.profiles where (created_at at time zone 'America/Chicago')::date between p_from and p_to)
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.report_summary(date, date, uuid) from public, anon;
grant execute on function public.report_summary(date, date, uuid) to authenticated;
