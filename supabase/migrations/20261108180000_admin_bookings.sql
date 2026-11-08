-- All bookings for staff/admins: across days and locations, filterable, and per customer.
-- Rows are limited to locations where the caller has bookings_view_all.
create or replace function public.admin_bookings(
  p_location uuid default null,
  p_user     uuid default null,
  p_status   text default 'upcoming',   -- upcoming | past | cancelled | no_show | all
  p_kind     text default null,          -- online | walk_in | block
  p_from     date default null,          -- local dates, inclusive
  p_to       date default null,
  p_search   text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(trim(coalesce(p_search, '')), '');
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 2000);
  v_result jsonb;
begin
  if p_location is not null and not public.has_privilege('bookings_view_all', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.locations l where public.has_privilege('bookings_view_all', l.id)) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if coalesce(p_status, 'upcoming') not in ('upcoming', 'past', 'cancelled', 'no_show', 'all') then
    raise exception 'Unknown status filter.' using errcode = '22023';
  end if;

  with rows as (
    select b.*, l.name as location_name, l.timezone,
           p.id as p_id, p.username, p.display_name, p.email
      from public.bookings b
      join public.locations l on l.id = b.location_id
      left join public.profiles p on p.id = b.user_id
     where public.has_privilege('bookings_view_all', b.location_id)
       and (p_location is null or b.location_id = p_location)
       and (p_user is null or b.user_id = p_user)
       and (p_kind is null or b.kind = p_kind)
       and b.status <> 'expired'
       and (p_from is null or (b.starts_at at time zone l.timezone)::date >= p_from)
       and (p_to   is null or (b.starts_at at time zone l.timezone)::date <= p_to)
       and case coalesce(p_status, 'upcoming')
             when 'upcoming'  then b.status in ('pending', 'confirmed') and b.ends_at > now()
             when 'past'      then b.status = 'confirmed' and b.ends_at <= now()
             when 'cancelled' then b.status = 'cancelled'
             when 'no_show'   then b.no_show
             else true
           end
       and (v_q is null
            or p.display_name ilike '%' || v_q || '%'
            or p.username ilike '%' || v_q || '%'
            or p.email ilike '%' || v_q || '%'
            or b.guest_name ilike '%' || v_q || '%'
            or b.guest_phone ilike '%' || v_q || '%'
            or b.note ilike '%' || v_q || '%')
  ),
  page as (
    select * from rows
     order by case when coalesce(p_status, 'upcoming') = 'upcoming' then extract(epoch from starts_at) else -extract(epoch from starts_at) end,
              created_at
     limit v_limit offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'summary', (select jsonb_build_object(
                  'bookings', count(*) filter (where kind <> 'block'),
                  'hours', coalesce(sum(extract(epoch from ends_at - starts_at) / 3600) filter (where kind <> 'block' and status = 'confirmed'), 0),
                  'paid_cents', coalesce(sum(total_cents) filter (where status in ('confirmed', 'cancelled')), 0),
                  'refund_cents', coalesce(sum(refund_cents), 0),
                  'no_shows', count(*) filter (where no_show),
                  'cancelled', count(*) filter (where status = 'cancelled'))
                  from rows),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'status', r.status,
        'starts_at', r.starts_at,
        'ends_at', r.ends_at,
        'total_cents', r.total_cents,
        'discount_cents', r.discount_cents,
        'refund_cents', r.refund_cents,
        'payment_method', r.payment_method,
        'paid_online', r.stripe_payment_intent_id is not null,
        'checked_in_at', r.checked_in_at,
        'no_show', r.no_show,
        'note', r.note,
        'guest_name', r.guest_name,
        'guest_phone', r.guest_phone,
        'created_at', r.created_at,
        'location', jsonb_build_object('id', r.location_id, 'name', r.location_name, 'timezone', r.timezone),
        'customer', case when r.p_id is null then null else jsonb_build_object(
          'id', r.p_id, 'username', r.username, 'display_name', r.display_name, 'email', r.email) end,
        'included_minutes', (select coalesce(sum(bi.included_minutes), 0) from public.booking_items bi where bi.booking_id = r.id),
        'resources', (select jsonb_agg(res.name order by res.sort_order, res.name)
                        from public.booking_items bi join public.resources res on res.id = bi.resource_id
                       where bi.booking_id = r.id))
      order by case when coalesce(p_status, 'upcoming') = 'upcoming' then extract(epoch from r.starts_at) else -extract(epoch from r.starts_at) end,
               r.created_at)
      from page r), '[]'::jsonb),
    'user', case when p_user is null then null else (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', p.email, 'created_at', p.created_at,
        'membership', (select jsonb_build_object('tier', t.name, 'status', m.status, 'billing_interval', m.billing_interval,
                                                 'current_period_end', m.current_period_end, 'cancel_at_period_end', m.cancel_at_period_end)
                         from public.memberships m join public.membership_tiers t on t.id = m.tier_id
                        where m.user_id = p.id and m.status in ('active', 'past_due')
                        order by m.created_at desc limit 1),
        'waiver_signed', case when public.active_waiver_id() is null then null else exists (select 1 from public.waiver_acceptances w where w.user_id = p.id and w.waiver_id = public.active_waiver_id()) end,
        'stats', (select jsonb_build_object(
                    'upcoming', count(*) filter (where b.status = 'confirmed' and b.ends_at > now()),
                    'completed', count(*) filter (where b.status = 'confirmed' and b.ends_at <= now()),
                    'cancelled', count(*) filter (where b.status = 'cancelled'),
                    'no_shows', count(*) filter (where b.no_show),
                    'hours', coalesce(sum(extract(epoch from b.ends_at - b.starts_at) / 3600) filter (where b.status = 'confirmed'), 0),
                    'spent_cents', coalesce(sum(b.total_cents - b.refund_cents) filter (where b.status in ('confirmed', 'cancelled')), 0),
                    'last_visit', max(b.checked_in_at))
                    from public.bookings b
                   where b.user_id = p.id and public.has_privilege('bookings_view_all', b.location_id)))
        from public.profiles p where p.id = p_user) end
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.admin_bookings(uuid, uuid, text, text, date, date, text, int, int) from public, anon;
grant execute on function public.admin_bookings(uuid, uuid, text, text, date, date, text, int, int) to authenticated;
