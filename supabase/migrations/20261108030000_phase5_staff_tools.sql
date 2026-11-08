-- =====================================================================
-- Phase 5: staff tools
-- =====================================================================
-- * LOCATION_MANAGER role: runs the front desk, for every location (global
--   role) or only the locations it is assigned to (location-scoped role).
-- * bookings_view_all: see the day schedule and booking details.
--   bookings_manage:   check in / no-show, walk-in bookings, blocked time,
--                      cancel any booking (refunds through the cancel-booking
--                      Edge Function).
-- * Bookings gain a kind: 'online' (customer, paid through Stripe),
--   'walk_in' (booked by staff, paid at the desk) or 'block' (time held for
--   lessons, team rentals, maintenance…). Blocks use the same no-overlap
--   rule, so customers can't book over them.
-- =====================================================================

insert into public.privileges (code, description) values
  ('bookings_manage', 'Check customers in, book walk-ins, block time and cancel bookings at a location');

insert into public.roles (code, description, sort_order) values
  ('LOCATION_MANAGER',
   'Runs the front desk: daily schedule, check-in, walk-ins, blocked time and cancellations. Give it for all locations or only some.',
   15);

insert into public.role_privileges (role_code, privilege_code) values
  ('LOCATION_MANAGER', 'bookings_view_all'),
  ('LOCATION_MANAGER', 'bookings_manage');

-- ---------------------------------------------------------------------
-- Bookings: kinds, walk-in customers, attendance
-- ---------------------------------------------------------------------
alter table public.bookings
  add column kind           text not null default 'online' check (kind in ('online', 'walk_in', 'block')),
  add column guest_name     text check (guest_name is null or length(guest_name) between 1 and 80),
  add column guest_phone    text check (guest_phone is null or length(guest_phone) between 1 and 30),
  add column note           text check (note is null or length(note) <= 200),
  add column payment_method text check (payment_method is null or payment_method in ('stripe', 'cash', 'card', 'comp')),
  add column checked_in_at  timestamptz,
  add column no_show        boolean not null default false,
  add column created_by     uuid references public.profiles (id) on delete set null,
  add column cancelled_by   uuid references public.profiles (id) on delete set null;

alter table public.bookings alter column user_id drop not null;
alter table public.bookings add constraint bookings_customer_check check (
  case kind
    when 'online'  then user_id is not null
    when 'walk_in' then user_id is not null or guest_name is not null
    else true
  end);

update public.bookings set payment_method = 'stripe' where stripe_payment_intent_id is not null;

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------

-- has_privilege() for another user. Only the Edge Functions (service role) use this.
create or replace function public.user_has_privilege(p_user uuid, p_privilege text, p_location uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.user_roles ur
     where ur.user_id = p_user
       and (ur.location_id is null or ur.location_id = p_location)
       and (ur.role_code = 'SUPER_ADMIN'
            or exists (select 1 from public.role_privileges rp
                        where rp.role_code = ur.role_code and rp.privilege_code = p_privilege))
  );
$$;

-- Adds privileges granted per location, so the app can show staff pages to
-- someone who manages only some locations.
create or replace function public.my_access()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with mine as (
    select role_code, location_id from public.user_roles where user_id = auth.uid()
  )
  select jsonb_build_object(
    'roles', coalesce(
      (select jsonb_agg(distinct role_code) from mine where location_id is null), '[]'::jsonb),
    'location_roles', coalesce(
      (select jsonb_agg(jsonb_build_object('role', role_code, 'location_id', location_id))
         from mine where location_id is not null), '[]'::jsonb),
    'privileges', coalesce(
      case when public.is_super_admin()
        then (select jsonb_agg(code order by code) from public.privileges)
        else (select jsonb_agg(distinct rp.privilege_code)
                from mine m join public.role_privileges rp on rp.role_code = m.role_code
               where m.location_id is null)
      end, '[]'::jsonb),
    'location_privileges', coalesce((
      select jsonb_agg(jsonb_build_object('location_id', x.location_id, 'privileges', x.privs))
        from (select m.location_id, jsonb_agg(distinct rp.privilege_code) as privs
                from mine m join public.role_privileges rp on rp.role_code = m.role_code
               where m.location_id is not null
               group by m.location_id) x), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Location-scoped roles (Users page)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_location_roles()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('users_view') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', ur.user_id, 'role', ur.role_code,
                                        'location_id', ur.location_id, 'location_name', l.name)
                     order by l.name)
      from public.user_roles ur
      join public.locations l on l.id = ur.location_id
     where ur.location_id is not null), '[]'::jsonb);
end;
$$;

-- Sets the locations where a user has a role (replaces that role's location list).
create or replace function public.set_user_location_roles(p_user uuid, p_role text, p_locations uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_locs uuid[] := coalesce(p_locations, '{}');
begin
  if not public.has_privilege('users_manage_roles') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'SUPER_ADMIN' or not exists (select 1 from public.roles where code = p_role) then
    raise exception 'That role can''t be given per location.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_locs) x where x not in (select id from public.locations)) then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  delete from public.user_roles
   where user_id = p_user and role_code = p_role and location_id is not null
     and not (location_id = any (v_locs));
  insert into public.user_roles (user_id, role_code, location_id)
  select p_user, p_role, x from unnest(v_locs) x
  on conflict (user_id, role_code, location_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- Staff: schedule
-- ---------------------------------------------------------------------

-- Locations the signed-in user can see the schedule for.
create or replace function public.staff_locations()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'name', l.name, 'timezone', l.timezone,
           'can_manage', public.has_privilege('bookings_manage', l.id))
         order by l.name), '[]'::jsonb)
    from public.locations l
   where l.is_active and public.has_privilege('bookings_view_all', l.id);
$$;

-- One location's day: opening window, cages/turf and every booking that day.
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
                 'id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', p.email) end,
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

-- Check in, mark a no-show, or clear both.
create or replace function public.staff_set_attendance(p_booking uuid, p_state text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  b record;
begin
  select id, location_id, kind, status into b from public.bookings where id = p_booking;
  if b.id is null then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if not public.has_privilege('bookings_manage', b.location_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if b.kind = 'block' then
    raise exception 'Blocked time has no check-in.' using errcode = '22023';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be checked in.' using errcode = '22023';
  end if;

  case p_state
    when 'checked_in' then update public.bookings set checked_in_at = now(), no_show = false where id = p_booking;
    when 'no_show'    then update public.bookings set checked_in_at = null, no_show = true where id = p_booking;
    when 'none'       then update public.bookings set checked_in_at = null, no_show = false where id = p_booking;
    else raise exception 'Unknown check-in state.' using errcode = '22023';
  end case;
end;
$$;

-- ---------------------------------------------------------------------
-- Staff: walk-ins and blocked time
-- ---------------------------------------------------------------------

-- Customer lookup for walk-ins (name, username or email).
create or replace function public.staff_find_customers(p_location uuid, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if not public.has_privilege('bookings_manage', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if length(q) < 2 then
    return '[]'::jsonb;
  end if;
  q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(x order by x ->> 'display_name')
      from (select jsonb_build_object(
                     'id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', p.email,
                     'member_tier', (select mb.tier_name from public.member_benefits(p.id, p_location) mb)) as x
              from public.profiles p
             where p.username::text ilike q or p.display_name ilike q or p.email ilike q
             order by p.display_name
             limit 8) s), '[]'::jsonb);
end;
$$;

-- Price preview for a walk-in (member pricing when a member is picked).
create or replace function public.staff_quote(p_location uuid, p_resource_ids uuid[], p_slots jsonb, p_user uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('bookings_manage', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return public.price_booking(p_user, p_location, p_resource_ids,
           (select jsonb_agg(e order by (e ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_slots) e), null);
end;
$$;

-- Creates confirmed walk-in bookings (paid at the desk) or blocked time,
-- one booking per date in p_slots ([{starts_at, ends_at}, …]).
create or replace function public.staff_create_booking(
  p_location       uuid,
  p_kind           text,
  p_resource_ids   uuid[],
  p_slots          jsonb,
  p_user           uuid default null,
  p_guest_name     text default null,
  p_guest_phone    text default null,
  p_note           text default null,
  p_payment_method text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_hours constant int := 12;
  c_max_dates constant int := 12;
  v_tz        text;
  v_ids       uuid[];
  v_group     uuid := gen_random_uuid();
  v_guest     text := nullif(trim(coalesce(p_guest_name, '')), '');
  v_phone     text := nullif(trim(coalesce(p_guest_phone, '')), '');
  v_note      text := nullif(trim(coalesce(p_note, '')), '');
  v_today     date;
  v_quote     jsonb;
  v_date      jsonb;
  v_item      jsonb;
  v_start     timestamptz;
  v_end       timestamptz;
  v_label     text;
  w           record;
  m           record;
  v_booking   uuid;
  v_total     int;
  v_disc      int;
  v_list      int;
  v_sum       int := 0;
  v_out       jsonb := '[]'::jsonb;
  v_name      text;
begin
  if not public.has_privilege('bookings_manage', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if p_kind not in ('walk_in', 'block') then
    raise exception 'Unknown booking type.' using errcode = '22023';
  end if;

  select timezone into v_tz from public.locations where id = p_location and is_active;
  if v_tz is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;
  v_today := (now() at time zone v_tz)::date;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_resource_ids, '{}')) x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Pick at least one cage or the turf.' using errcode = '22023';
  end if;
  if (select count(*) from public.resources
       where id = any (v_ids) and location_id = p_location and is_active) <> cardinality(v_ids) then
    raise exception 'One of those isn''t available at this location.' using errcode = '22023';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Pick a date and time.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > c_max_dates then
    raise exception 'You can add up to % dates at once.', c_max_dates using errcode = '22023';
  end if;

  if p_kind = 'walk_in' then
    if p_user is null and v_guest is null then
      raise exception 'Pick a customer or enter a name.' using errcode = '22023';
    end if;
    if p_user is not null and not exists (select 1 from public.profiles where id = p_user) then
      raise exception 'Customer not found.' using errcode = 'P0002';
    end if;
    if p_payment_method is null or p_payment_method not in ('cash', 'card', 'comp') then
      raise exception 'Pick how they paid.' using errcode = '22023';
    end if;
    if p_user is not null then
      v_guest := null;
      v_phone := null;
    end if;
  else
    if v_note is null then
      raise exception 'Add a reason for the blocked time.' using errcode = '22023';
    end if;
    v_guest := null;
    v_phone := null;
  end if;

  for v_date in select * from jsonb_array_elements(p_slots) loop
    v_start := (v_date ->> 'starts_at')::timestamptz;
    v_end   := (v_date ->> 'ends_at')::timestamptz;
    if v_start is null or v_end is null or v_end <= v_start then
      raise exception 'Pick a start time and length.' using errcode = '22023';
    end if;
    v_label := to_char(v_start at time zone v_tz, 'Dy Mon FMDD');
    if extract(epoch from v_start)::bigint % 1800 <> 0 or extract(epoch from v_end)::bigint % 1800 <> 0 then
      raise exception 'Times start and end on the hour or half hour.' using errcode = '22023';
    end if;
    if v_end - v_start > make_interval(hours => c_max_hours) then
      raise exception 'That''s longer than % hours.', c_max_hours using errcode = '22023';
    end if;
    if (v_start at time zone v_tz)::date < v_today or v_end <= now() then
      raise exception '% is already over.', v_label using errcode = '22023';
    end if;
    select * into w from public.location_day_window(p_location, (v_start at time zone v_tz)::date);
    if w.opens_at is null then
      raise exception 'The location is closed on %.', v_label using errcode = '22023';
    end if;
    if v_start < w.opens_at or v_end > w.closes_at then
      raise exception 'That time is outside opening hours on %.', v_label using errcode = '22023';
    end if;
  end loop;

  perform public.expire_stale_holds();

  if p_kind = 'walk_in' then
    select * into m from public.member_benefits(p_user, p_location);
    v_quote := public.price_booking(p_user, p_location, v_ids,
                 (select jsonb_agg(e order by (e ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_slots) e), null);
  else
    v_quote := jsonb_build_object('dates', (
      select jsonb_agg(jsonb_build_object(
               'starts_at', (e ->> 'starts_at')::timestamptz, 'ends_at', (e ->> 'ends_at')::timestamptz,
               'total_cents', 0, 'discount_cents', 0,
               'items', (select jsonb_agg(jsonb_build_object('resource_id', r.id, 'name', r.name,
                                            'price_cents', 0, 'list_cents', null, 'included_minutes', 0))
                           from public.resources r where r.id = any (v_ids))))
        from jsonb_array_elements(p_slots) e));
  end if;

  for v_date in select * from jsonb_array_elements(v_quote -> 'dates') loop
    v_start := (v_date ->> 'starts_at')::timestamptz;
    v_end   := (v_date ->> 'ends_at')::timestamptz;
    v_label := to_char(v_start at time zone v_tz, 'Dy Mon FMDD');
    v_total := (v_date ->> 'total_cents')::int;
    v_disc  := (v_date ->> 'discount_cents')::int;
    if p_payment_method = 'comp' then
      v_disc := v_disc + v_total;
      v_total := 0;
    end if;

    insert into public.bookings (location_id, user_id, status, kind, starts_at, ends_at, total_cents, discount_cents,
                                 checkout_group, membership_id, confirmed_at, guest_name, guest_phone, note,
                                 payment_method, created_by)
    values (p_location, case when p_kind = 'walk_in' then p_user end, 'confirmed', p_kind, v_start, v_end,
            v_total, v_disc, v_group, case when p_kind = 'walk_in' then m.membership_id end, now(),
            v_guest, v_phone, v_note, case when p_kind = 'walk_in' then p_payment_method end, auth.uid())
    returning id into v_booking;

    for v_item in select * from jsonb_array_elements(v_date -> 'items') loop
      begin
        insert into public.booking_items (booking_id, resource_id, starts_at, ends_at, price_cents, list_price_cents, included_minutes)
        values (v_booking, (v_item ->> 'resource_id')::uuid, v_start, v_end,
                case when p_payment_method = 'comp' then 0 else (v_item ->> 'price_cents')::int end,
                (v_item ->> 'list_cents')::int, coalesce((v_item ->> 'included_minutes')::int, 0));
      exception when exclusion_violation then
        v_name := v_item ->> 'name';
        raise exception '% is already booked on % at that time.', v_name, v_label using errcode = '23P01';
      end;
    end loop;

    v_sum := v_sum + v_total;
    v_out := v_out || jsonb_build_object('booking_id', v_booking, 'starts_at', v_start, 'total_cents', v_total);
  end loop;

  return jsonb_build_object('group_id', v_group, 'total_cents', v_sum, 'bookings', v_out);
end;
$$;

-- Records a cancellation made by staff (refunds are handled by the Edge Function).
create or replace function public.staff_mark_cancelled(p_booking uuid, p_refund_cents integer, p_by uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), refund_cents = greatest(coalesce(p_refund_cents, 0), 0),
         cancelled_by = p_by
   where id = p_booking and status in ('confirmed', 'pending');
  update public.booking_items set active = false where booking_id = p_booking;
end;
$$;

-- ---------------------------------------------------------------------
-- Customers: My bookings now says how a booking was made
-- ---------------------------------------------------------------------
create or replace function public.my_bookings()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'kind', b.kind,
           'status', b.status,
           'starts_at', b.starts_at,
           'ends_at', b.ends_at,
           'total_cents', b.total_cents,
           'discount_cents', b.discount_cents,
           'refund_cents', b.refund_cents,
           'hold_expires_at', b.hold_expires_at,
           'created_at', b.created_at,
           'location', jsonb_build_object('id', l.id, 'name', l.name, 'timezone', l.timezone),
           'items', (select jsonb_agg(jsonb_build_object('name', r.name, 'type', r.type, 'price_cents', bi.price_cents,
                                                         'included_minutes', bi.included_minutes)
                                      order by r.sort_order, r.name)
                       from public.booking_items bi join public.resources r on r.id = bi.resource_id
                      where bi.booking_id = b.id))
         order by b.starts_at desc), '[]'::jsonb)
    from public.bookings b
    join public.locations l on l.id = b.location_id
   where b.user_id = auth.uid()
     and b.status <> 'expired';
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.user_has_privilege(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.staff_mark_cancelled(uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_location_roles() from public, anon;
revoke execute on function public.set_user_location_roles(uuid, text, uuid[]) from public, anon;
revoke execute on function public.staff_locations() from public, anon;
revoke execute on function public.staff_day(uuid, date, boolean) from public, anon;
revoke execute on function public.staff_set_attendance(uuid, text) from public, anon;
revoke execute on function public.staff_find_customers(uuid, text) from public, anon;
revoke execute on function public.staff_quote(uuid, uuid[], jsonb, uuid) from public, anon;
revoke execute on function public.staff_create_booking(uuid, text, uuid[], jsonb, uuid, text, text, text, text) from public, anon;

grant execute on function public.user_has_privilege(uuid, text, uuid) to service_role;
grant execute on function public.staff_mark_cancelled(uuid, integer, uuid) to service_role;
grant execute on function public.admin_list_location_roles() to authenticated;
grant execute on function public.set_user_location_roles(uuid, text, uuid[]) to authenticated;
grant execute on function public.staff_locations() to authenticated;
grant execute on function public.staff_day(uuid, date, boolean) to authenticated;
grant execute on function public.staff_set_attendance(uuid, text) to authenticated;
grant execute on function public.staff_find_customers(uuid, text) to authenticated;
grant execute on function public.staff_quote(uuid, uuid[], jsonb, uuid) to authenticated;
grant execute on function public.staff_create_booking(uuid, text, uuid[], jsonb, uuid, text, text, text, text) to authenticated;
