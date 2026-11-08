-- Staff tools, round 2: customer phone, marking walk-ins paid, an activity log
-- for bookings, closure impact, emailing a day's customers, and the admin dashboard.

-- ---------------------------------------------------------------- phone
alter table public.profiles add column if not exists phone text check (phone is null or length(phone) <= 30);
grant update (username, display_name, phone) on public.profiles to authenticated;

-- ---------------------------------------------------------------- paid at the desk
alter table public.bookings add column if not exists paid_at timestamptz;
alter table public.bookings add column if not exists paid_by uuid references public.profiles (id) on delete set null;

create or replace function public.staff_mark_paid(p_booking uuid, p_paid boolean, p_method text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or not public.has_privilege('bookings_manage', b.location_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if b.kind <> 'walk_in' or b.status <> 'confirmed' or b.total_cents <= 0 or b.payment_method = 'comp' then
    raise exception 'Only walk-ins with something to collect can be marked paid.' using errcode = '22023';
  end if;
  if p_method is not null and p_method not in ('cash', 'card') then
    raise exception 'Pick cash or card.' using errcode = '22023';
  end if;
  update public.bookings
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         payment_method = coalesce(p_method, payment_method)
   where id = p_booking;
end;
$$;

-- ---------------------------------------------------------------- activity log
create table if not exists public.booking_events (
  id         bigserial primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  at         timestamptz not null default now(),
  actor      uuid references public.profiles (id) on delete set null,
  action     text not null,
  details    jsonb not null default '{}'::jsonb
);
create index if not exists booking_events_booking on public.booking_events (booking_id, at);
create index if not exists booking_events_at on public.booking_events (at desc);
alter table public.booking_events enable row level security;
create policy "staff read events at their locations" on public.booking_events for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and public.has_privilege('bookings_view_all', b.location_id)));
revoke insert, update, delete on public.booking_events from anon, authenticated;

create or replace function public.log_booking_event(p_booking uuid, p_action text, p_details jsonb, p_fallback uuid)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.booking_events (booking_id, actor, action, details)
  values (p_booking,
          coalesce(auth.uid(), nullif(current_setting('yard.actor', true), '')::uuid, p_fallback),
          p_action, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.log_booking_event(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.trg_booking_events()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_booking_event(new.id, 'created',
      jsonb_build_object('kind', new.kind, 'status', new.status, 'total_cents', new.total_cents, 'payment_method', new.payment_method),
      coalesce(new.created_by, new.user_id));
    return new;
  end if;
  if old.status = 'pending' and new.status = 'confirmed' then
    perform public.log_booking_event(new.id, 'confirmed', jsonb_build_object('total_cents', new.total_cents), new.user_id);
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.log_booking_event(new.id, 'cancelled', jsonb_build_object('refund_cents', new.refund_cents), coalesce(new.cancelled_by, new.user_id));
  elsif new.refund_cents > old.refund_cents then
    perform public.log_booking_event(new.id, 'refunded', jsonb_build_object('refund_cents', new.refund_cents - old.refund_cents), null);
  end if;
  if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at then
    perform public.log_booking_event(new.id, 'rescheduled',
      jsonb_build_object('from_start', old.starts_at, 'from_end', old.ends_at, 'to_start', new.starts_at, 'to_end', new.ends_at,
                         'from_cents', old.total_cents, 'to_cents', new.total_cents), new.user_id);
  end if;
  if new.checked_in_at is distinct from old.checked_in_at then
    perform public.log_booking_event(new.id, case when new.checked_in_at is null then 'check_in_undone' else 'checked_in' end, '{}'::jsonb, null);
  end if;
  if new.no_show is distinct from old.no_show then
    perform public.log_booking_event(new.id, case when new.no_show then 'no_show' else 'no_show_undone' end, '{}'::jsonb, null);
  end if;
  if new.paid_at is distinct from old.paid_at then
    perform public.log_booking_event(new.id, case when new.paid_at is null then 'payment_undone' else 'paid' end,
      jsonb_build_object('method', new.payment_method, 'total_cents', new.total_cents), new.paid_by);
  end if;
  return new;
end;
$$;

drop trigger if exists booking_events_log on public.bookings;
create trigger booking_events_log after insert or update on public.bookings
  for each row execute function public.trg_booking_events();

create or replace function public.trg_booking_item_moves()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.resource_id <> old.resource_id and new.active then
    perform public.log_booking_event(new.booking_id, 'moved',
      jsonb_build_object('from', (select name from public.resources where id = old.resource_id),
                         'to', (select name from public.resources where id = new.resource_id)), null);
  end if;
  return new;
end;
$$;

drop trigger if exists booking_item_moves_log on public.booking_items;
create trigger booking_item_moves_log after update of resource_id on public.booking_items
  for each row execute function public.trg_booking_item_moves();

-- One booking's history (front desk panel).
create or replace function public.booking_history(p_booking uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'details', e.details,
                                               'actor', p.display_name, 'actor_id', e.actor) order by e.at, e.id), '[]'::jsonb)
    from public.booking_events e
    join public.bookings b on b.id = e.booking_id
    left join public.profiles p on p.id = e.actor
   where e.booking_id = p_booking and public.has_privilege('bookings_view_all', b.location_id);
$$;

-- Everything staff did, newest first (admin Activity page).
create or replace function public.admin_activity(
  p_location uuid default null, p_actor uuid default null, p_action text default null,
  p_staff_only boolean default true, p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.locations l where public.has_privilege('bookings_view_all', l.id)) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return (
    with ev as (
      select e.*, b.location_id, b.starts_at, b.ends_at, b.kind as booking_kind, b.guest_name, b.note, b.user_id,
             l.name as location_name, l.timezone
        from public.booking_events e
        join public.bookings b on b.id = e.booking_id
        join public.locations l on l.id = b.location_id
       where public.has_privilege('bookings_view_all', b.location_id)
         and (p_location is null or b.location_id = p_location)
         and (p_actor is null or e.actor = p_actor)
         and (p_action is null or e.action = p_action)
         -- "Staff only": hide what customers and payments did themselves.
         and (not p_staff_only or (e.actor is not null and e.actor is distinct from b.user_id))
    )
    select jsonb_build_object(
      'total', (select count(*) from ev),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', x.id, 'at', x.at, 'action', x.action, 'details', x.details,
                 'actor', (select jsonb_build_object('id', a.id, 'name', a.display_name) from public.profiles a where a.id = x.actor),
                 'booking', jsonb_build_object(
                   'id', x.booking_id, 'kind', x.booking_kind, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                   'location', jsonb_build_object('id', x.location_id, 'name', x.location_name, 'timezone', x.timezone),
                   'who', coalesce((select c.display_name from public.profiles c where c.id = x.user_id), x.guest_name,
                                   case when x.booking_kind = 'block' then coalesce(x.note, 'Blocked time') end, 'Guest')))
               order by x.at desc, x.id desc)
          from (select * from ev order by at desc, id desc
                 limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)));
end;
$$;

-- ---------------------------------------------------------------- front desk day (adds phone, paid, history counts)
create or replace function public.staff_day(p_location uuid, p_date date, p_include_cancelled boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tz      text;
  w         record;
  v_from    timestamptz;
  v_to      timestamptz;
begin
  if not public.has_privilege('bookings_view_all', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select timezone into v_tz from public.locations where id = p_location;
  if v_tz is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  perform public.expire_stale_holds();

  select * into w from public.location_day_window(p_location, p_date);
  v_from := p_date::timestamp at time zone v_tz;
  v_to   := (p_date + 1)::timestamp at time zone v_tz;

  return jsonb_build_object(
    'location_id', p_location,
    'date', p_date,
    'timezone', v_tz,
    'opens_at', w.opens_at,
    'closes_at', w.closes_at,
    'closed_reason', w.closed_reason,
    'can_manage', public.has_privilege('bookings_manage', p_location),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type) order by r.sort_order, r.name)
        from public.resources r where r.location_id = p_location and r.is_active), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
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
               'checked_in_at', b.checked_in_at,
               'no_show', b.no_show,
               'note', b.note,
               'guest_name', b.guest_name,
               'guest_phone', b.guest_phone,
               'created_at', b.created_at,
               'hold_expires_at', b.hold_expires_at,
               'customer', case when p.id is null then null else jsonb_build_object(
                 'id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', p.email,
                 'waiver_ok', public.has_signed_waiver(p.id), 'phone', p.phone,
                 'bookings', (select count(*) from public.bookings x where x.user_id = p.id and x.status = 'confirmed'),
                 'no_shows', (select count(*) from public.bookings x where x.user_id = p.id and x.no_show)) end,
               'paid_at', b.paid_at,
               'member_tier', (select t.name from public.memberships m
                                 join public.membership_tiers t on t.id = m.tier_id
                                where m.id = b.membership_id),
               'created_by', (select cb.display_name from public.profiles cb where cb.id = b.created_by),
               'included_minutes', (select coalesce(sum(bi.included_minutes), 0)
                                      from public.booking_items bi where bi.booking_id = b.id),
               'resource_ids', (select jsonb_agg(bi.resource_id order by r.sort_order, r.name)
                                  from public.booking_items bi join public.resources r on r.id = bi.resource_id
                                 where bi.booking_id = b.id))
             order by b.starts_at, b.created_at)
        from public.bookings b
        left join public.profiles p on p.id = b.user_id
       where b.location_id = p_location
         and b.starts_at < v_to and b.ends_at > v_from
         and (b.status in ('pending', 'confirmed') or (p_include_cancelled and b.status = 'cancelled'))
    ), '[]'::jsonb)
  );
end;
$$;


-- ---------------------------------------------------------------- closures: who's affected
create or replace function public.closure_impact(p_location uuid, p_dates date[], p_all_day boolean, p_opens time default null, p_closes time default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if not public.has_privilege('locations_manage', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select timezone into v_tz from public.locations where id = p_location;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'kind', b.kind, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'total_cents', b.total_cents,
             'paid_online', b.stripe_payment_intent_id is not null,
             'who', coalesce(p.display_name, b.guest_name, 'Guest'), 'email', p.email,
             'resources', (select jsonb_agg(r.name order by r.sort_order) from public.booking_items bi
                             join public.resources r on r.id = bi.resource_id where bi.booking_id = b.id and bi.active))
           order by b.starts_at)
      from public.bookings b
      left join public.profiles p on p.id = b.user_id
     where b.location_id = p_location
       and b.status = 'confirmed'
       and b.kind <> 'block'
       and (b.starts_at at time zone v_tz)::date = any (p_dates)
       and (p_all_day
            or (b.starts_at at time zone v_tz)::time < p_opens
            or (b.ends_at at time zone v_tz)::time > p_closes
            or (b.ends_at at time zone v_tz)::date > (b.starts_at at time zone v_tz)::date)), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- email a day's customers
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation', 'cancellation', 'reminder', 'price_change', 'notice'));

create or replace function public.queue_customer_notice(p_location uuid, p_date date, p_subject text, p_body text, p_dry_run boolean default false)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tz   text;
  v_name text;
  v_n    integer;
begin
  if not public.has_privilege('announcements_manage', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select timezone, name into v_tz, v_name from public.locations where id = p_location;
  if v_tz is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;
  if not p_dry_run and (length(trim(coalesce(p_subject, ''))) = 0 or length(trim(coalesce(p_body, ''))) = 0) then
    raise exception 'Add a subject and a message.' using errcode = '22023';
  end if;

  with who as (
    select distinct b.user_id
      from public.bookings b
     where b.location_id = p_location and b.status = 'confirmed' and b.user_id is not null
       and (b.starts_at at time zone v_tz)::date = p_date
  ), ins as (
    insert into public.email_outbox (kind, user_id, payload)
    select 'notice', w.user_id,
           jsonb_build_object('subject', left(trim(p_subject), 150), 'body', left(trim(p_body), 4000),
                              'location', v_name, 'date', p_date)
      from who w
     where not p_dry_run
    returning 1
  )
  select case when p_dry_run then (select count(*) from who) else (select count(*) from ins) end into v_n;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- admin dashboard
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('reports_view') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return (
    with today as (
      select b.*, l.name as location_name,
             (b.starts_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date as is_today,
             (b.starts_at at time zone l.timezone)::date between (now() at time zone l.timezone)::date
                                                              and (now() at time zone l.timezone)::date + 6 as is_week
        from public.bookings b join public.locations l on l.id = b.location_id
       where b.starts_at between now() - interval '2 days' and now() + interval '8 days'
         and b.kind <> 'block'
    ), t as (select * from today where is_today)
    select jsonb_build_object(
      'today', jsonb_build_object(
        'bookings', (select count(*) from t where status = 'confirmed'),
        'checked_in', (select count(*) from t where status = 'confirmed' and checked_in_at is not null),
        'still_to_come', (select count(*) from t where status = 'confirmed' and starts_at > now()),
        'revenue_cents', (select coalesce(sum(total_cents - refund_cents), 0) from t where status in ('confirmed', 'cancelled')),
        'hours', (select coalesce(sum(extract(epoch from ends_at - starts_at)) / 3600, 0) from t where status = 'confirmed')),
      'next_7_days', (select count(*) from today where is_week and status = 'confirmed'),
      'attention', jsonb_build_object(
        'unpaid_walk_ins', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'location_id', location_id, 'starts_at', starts_at,
                                     'who', coalesce(guest_name, (select display_name from public.profiles where id = user_id)), 'cents', total_cents)
                                     order by starts_at), '[]'::jsonb)
                              from t where kind = 'walk_in' and status = 'confirmed' and total_cents > 0
                               and coalesce(payment_method, '') <> 'comp' and paid_at is null),
        'possible_no_shows', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'location_id', location_id, 'starts_at', starts_at,
                                     'who', coalesce(guest_name, (select display_name from public.profiles where id = user_id)))
                                     order by starts_at), '[]'::jsonb)
                                from t where status = 'confirmed' and ends_at < now() and checked_in_at is null and not no_show),
        'unsigned_waivers', (select coalesce(jsonb_agg(distinct jsonb_build_object('user_id', p.id, 'name', p.display_name)), '[]'::jsonb)
                               from t join public.profiles p on p.id = t.user_id
                              where t.status = 'confirmed' and t.ends_at > now() and not public.has_signed_waiver(p.id)),
        'past_due_members', (select count(*) from public.memberships where status = 'past_due')),
      'members', jsonb_build_object(
        'active', (select count(*) from public.memberships where status in ('active', 'past_due')),
        'new_7_days', (select count(*) from public.memberships where status in ('active', 'past_due') and created_at > now() - interval '7 days')),
      'signups_7_days', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
      'open_todos', (select count(*) from public.admin_todos where not done)
    ));
end;
$$;

-- ---------------------------------------------------------------- users: who's a member, who signed
create or replace function public.admin_user_flags()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('users_view') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', p.id,
             'phone', p.phone,
             'created_at', p.created_at,
             'member_tier', (select t.name from public.memberships m join public.membership_tiers t on t.id = m.tier_id
                              where m.user_id = p.id and m.status in ('active', 'past_due') order by m.created_at desc limit 1),
             'waiver_signed', public.has_signed_waiver(p.id),
             'bookings', (select count(*) from public.bookings b where b.user_id = p.id and b.status = 'confirmed'),
             'last_booking_at', (select max(b.starts_at) from public.bookings b where b.user_id = p.id and b.status = 'confirmed')))
      from public.profiles p), '[]'::jsonb);
end;
$$;

revoke execute on function public.staff_mark_paid(uuid, boolean, text) from public, anon;
revoke execute on function public.booking_history(uuid) from public, anon;
revoke execute on function public.admin_activity(uuid, uuid, text, boolean, int, int) from public, anon;
revoke execute on function public.closure_impact(uuid, date[], boolean, time, time) from public, anon;
revoke execute on function public.queue_customer_notice(uuid, date, text, text, boolean) from public, anon;
revoke execute on function public.admin_dashboard() from public, anon;
revoke execute on function public.admin_user_flags() from public, anon;
grant execute on function public.staff_mark_paid(uuid, boolean, text) to authenticated;
grant execute on function public.booking_history(uuid) to authenticated;
grant execute on function public.admin_activity(uuid, uuid, text, boolean, int, int) to authenticated;
grant execute on function public.closure_impact(uuid, date[], boolean, time, time) to authenticated;
grant execute on function public.queue_customer_notice(uuid, date, text, text, boolean) to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_user_flags() to authenticated;
