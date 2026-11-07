-- =====================================================================
-- Phase 3: bookings
-- =====================================================================
-- * A booking belongs to one customer and one location and covers one time
--   window; it has one item per cage/turf it reserves.
-- * booking_items can never overlap for the same resource while active.
--   The database enforces this (exclusion constraint), so two people can't
--   book the same cage even if they press "Pay" at the same moment.
-- * A new booking starts as a 'pending' hold while the customer pays.
--   Stripe confirms it (webhook → confirm_booking_payment). Unpaid holds
--   expire and free their slots.
-- * Prices are always computed here, never trusted from the browser.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

insert into public.privileges (code, description) values
  ('bookings_create',   'Book cages and turf, and manage own bookings'),
  ('bookings_view_all', 'See every booking at a location');
insert into public.role_privileges (role_code, privilege_code) values ('APP_USER', 'bookings_create');

create type public.booking_status as enum ('pending', 'confirmed', 'cancelled', 'expired');

create table public.bookings (
  id                         uuid primary key default gen_random_uuid(),
  location_id                uuid not null references public.locations (id),
  user_id                    uuid not null references public.profiles (id) on delete cascade,
  status                     public.booking_status not null default 'pending',
  starts_at                  timestamptz not null,
  ends_at                    timestamptz not null,
  total_cents                integer not null check (total_cents >= 0),
  hold_expires_at            timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  refund_cents               integer not null default 0 check (refund_cents >= 0),
  confirmed_at               timestamptz,
  cancelled_at               timestamptz,
  created_at                 timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bookings_user_idx on public.bookings (user_id, starts_at desc);
create index bookings_location_idx on public.bookings (location_id, starts_at);
create index bookings_pending_idx on public.bookings (hold_expires_at) where status = 'pending';

create table public.booking_items (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  resource_id uuid not null references public.resources (id),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  price_cents integer not null check (price_cents >= 0),
  active      boolean not null default true,
  check (ends_at > starts_at),
  constraint booking_items_no_overlap
    exclude using gist (resource_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (active)
);
create index booking_items_booking_idx on public.booking_items (booking_id);

-- ---------------------------------------------------------------------
-- Schedule helpers
-- ---------------------------------------------------------------------

-- Opening window for a location on a local date, after closures.
-- opens_at/closes_at are null when the location is closed that day.
create or replace function public.location_day_window(
  p_location uuid, p_date date,
  out opens_at timestamptz, out closes_at timestamptz, out closed_reason text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
  c    public.location_closures%rowtype;
  h    public.location_hours%rowtype;
begin
  select timezone into v_tz from public.locations where id = p_location and is_active;
  if v_tz is null then
    closed_reason := 'Location not available';
    return;
  end if;

  select * into c from public.location_closures where location_id = p_location and date = p_date;
  if found then
    if c.all_day then
      closed_reason := coalesce(nullif(c.reason, ''), 'Closed');
      return;
    end if;
    opens_at  := (p_date + c.opens_at)  at time zone v_tz;
    closes_at := (p_date + c.closes_at) at time zone v_tz;
    return;
  end if;

  select * into h from public.location_hours
   where location_id = p_location and weekday = extract(dow from p_date)::smallint;
  if not found or h.is_closed then
    closed_reason := 'Closed';
    return;
  end if;
  opens_at  := (p_date + h.opens_at)  at time zone v_tz;
  closes_at := (p_date + h.closes_at) at time zone v_tz;
end;
$$;

-- True if a 30-minute slot starting at p_start is in the location's peak hours.
create or replace function public.is_peak_slot(p_location uuid, p_start timestamptz)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.locations l
      join public.location_peak_hours ph on ph.location_id = l.id
     where l.id = p_location
       and ph.weekday = extract(dow from (p_start at time zone l.timezone))::smallint
       and (p_start at time zone l.timezone)::time >= ph.starts_at
       and (p_start at time zone l.timezone)::time <  ph.ends_at
  );
$$;

-- Price in cents for one resource type for one 30-minute slot (null if no price set).
create or replace function public.slot_price_cents(p_location uuid, p_type public.resource_type, p_start timestamptz)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select case
           when pr.peak_cents is not null and public.is_peak_slot(p_location, p_start) then pr.peak_cents
           else pr.base_cents
         end
    from public.resource_prices pr
   where pr.location_id = p_location and pr.resource_type = p_type;
$$;

-- Turns unpaid holds whose time is up into 'expired' and frees their slots.
create or replace function public.expire_stale_holds()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with expired as (
    update public.bookings set status = 'expired'
     where status = 'pending' and hold_expires_at < now()
    returning id
  )
  update public.booking_items bi set active = false
    from expired e
   where bi.booking_id = e.id and bi.active;
end;
$$;

-- ---------------------------------------------------------------------
-- Customer-facing functions
-- ---------------------------------------------------------------------

-- Everything the booking page needs for one location and local date.
-- Public: contains no customer information.
create or replace function public.get_availability(p_location uuid, p_date date)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  w     record;
  v_tz  text;
  v_res jsonb;
begin
  perform public.expire_stale_holds();

  select timezone into v_tz from public.locations where id = p_location and is_active;
  if v_tz is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type)
                            order by r.sort_order, r.name), '[]'::jsonb)
    into v_res
    from public.resources r
   where r.location_id = p_location and r.is_active;

  select * into w from public.location_day_window(p_location, p_date);

  return jsonb_build_object(
    'location_id', p_location,
    'date', p_date,
    'timezone', v_tz,
    'closed', w.opens_at is null,
    'closed_reason', w.closed_reason,
    'resources', v_res,
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
                 'type', resource_type, 'base_cents', base_cents, 'peak_cents', peak_cents))
               from public.resource_prices where location_id = p_location), '[]'::jsonb),
    'slots', case when w.opens_at is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'starts_at', s,
               'time', to_char(s at time zone v_tz, 'HH24:MI'),
               'peak', public.is_peak_slot(p_location, s),
               'past', s <= now(),
               'free', coalesce((
                 select jsonb_agg(r.id order by r.sort_order, r.name)
                   from public.resources r
                  where r.location_id = p_location and r.is_active
                    and not exists (
                      select 1 from public.booking_items bi
                       where bi.resource_id = r.id and bi.active
                         and tstzrange(bi.starts_at, bi.ends_at, '[)') && tstzrange(s, s + interval '30 minutes', '[)'))
               ), '[]'::jsonb))
             order by s)
        from generate_series(w.opens_at, w.closes_at - interval '30 minutes', interval '30 minutes') s
    ), '[]'::jsonb) end
  );
end;
$$;

-- Reserves resources for a time window while the customer pays.
-- Returns { booking_id, total_cents, hold_expires_at }.
create or replace function public.create_booking_hold(
  p_location uuid, p_resource_ids uuid[], p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_days  constant int := 30;
  c_max_hours constant int := 4;
  c_hold      constant interval := interval '35 minutes';
  v_uid       uuid := auth.uid();
  v_tz        text;
  v_ids       uuid[];
  w           record;
  v_booking   uuid;
  v_total     int := 0;
  v_price     int;
  r           record;
  s           timestamptz;
begin
  if v_uid is null then
    raise exception 'Please sign in to book.' using errcode = '42501';
  end if;
  if not public.has_privilege('bookings_create', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;

  select timezone into v_tz from public.locations where id = p_location and is_active;
  if v_tz is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_resource_ids, '{}')) x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Pick at least one cage or the turf.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 10 then
    raise exception 'You can book up to 10 at once.' using errcode = '22023';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Pick a start time and length.' using errcode = '22023';
  end if;
  if extract(epoch from p_starts_at)::bigint % 1800 <> 0 or extract(epoch from p_ends_at)::bigint % 1800 <> 0 then
    raise exception 'Bookings start and end on the hour or half hour.' using errcode = '22023';
  end if;
  if p_ends_at - p_starts_at > make_interval(hours => c_max_hours) then
    raise exception 'Bookings can be up to % hours.', c_max_hours using errcode = '22023';
  end if;
  if p_starts_at <= now() then
    raise exception 'That time has already started. Pick a later time.' using errcode = '22023';
  end if;
  if p_starts_at > now() + make_interval(days => c_max_days) then
    raise exception 'You can book up to % days ahead.', c_max_days using errcode = '22023';
  end if;

  select * into w from public.location_day_window(p_location, (p_starts_at at time zone v_tz)::date);
  if w.opens_at is null then
    raise exception 'The location is closed that day.' using errcode = '22023';
  end if;
  if p_starts_at < w.opens_at or p_ends_at > w.closes_at then
    raise exception 'That time is outside opening hours.' using errcode = '22023';
  end if;

  if (select count(*) from public.resources
       where id = any (v_ids) and location_id = p_location and is_active) <> cardinality(v_ids) then
    raise exception 'One of those isn''t available to book.' using errcode = '22023';
  end if;

  perform public.expire_stale_holds();

  -- A customer has at most one unpaid hold; starting a new one releases the old.
  with mine as (
    update public.bookings set status = 'expired'
     where user_id = v_uid and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from mine where bi.booking_id = mine.id;

  insert into public.bookings (location_id, user_id, status, starts_at, ends_at, total_cents, hold_expires_at)
  values (p_location, v_uid, 'pending', p_starts_at, p_ends_at, 0, now() + c_hold)
  returning id into v_booking;

  for r in
    select id, type from public.resources where id = any (v_ids) order by sort_order, name
  loop
    v_price := 0;
    for s in select generate_series(p_starts_at, p_ends_at - interval '30 minutes', interval '30 minutes') loop
      v_price := v_price + coalesce(public.slot_price_cents(p_location, r.type, s), -1000000);
    end loop;
    if v_price < 0 then
      raise exception 'Prices aren''t set up for this location yet.' using errcode = '22023';
    end if;
    begin
      insert into public.booking_items (booking_id, resource_id, starts_at, ends_at, price_cents)
      values (v_booking, r.id, p_starts_at, p_ends_at, v_price);
    exception when exclusion_violation then
      raise exception 'Sorry, that was just booked by someone else. Pick another time or cage.' using errcode = '23P01';
    end;
    v_total := v_total + v_price;
  end loop;

  update public.bookings set total_cents = v_total where id = v_booking;

  return jsonb_build_object(
    'booking_id', v_booking,
    'total_cents', v_total,
    'hold_expires_at', now() + c_hold
  );
end;
$$;

-- Lets a customer drop their own unpaid hold (e.g. they backed out of payment).
create or replace function public.release_booking_hold(p_booking uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with b as (
    update public.bookings set status = 'expired'
     where id = p_booking and user_id = auth.uid() and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from b where bi.booking_id = b.id;
end;
$$;

-- The signed-in customer's bookings with location and resource names.
create or replace function public.my_bookings()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'status', b.status,
           'starts_at', b.starts_at,
           'ends_at', b.ends_at,
           'total_cents', b.total_cents,
           'refund_cents', b.refund_cents,
           'hold_expires_at', b.hold_expires_at,
           'created_at', b.created_at,
           'location', jsonb_build_object('id', l.id, 'name', l.name, 'timezone', l.timezone),
           'items', (select jsonb_agg(jsonb_build_object('name', r.name, 'type', r.type, 'price_cents', bi.price_cents)
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
-- Server-only functions (called by Edge Functions with the service role)
-- ---------------------------------------------------------------------

create or replace function public.set_booking_checkout_session(p_booking uuid, p_session text)
returns void
language sql security definer
set search_path = ''
as $$
  update public.bookings set stripe_checkout_session_id = p_session where id = p_booking;
$$;

-- Marks a booking paid. Returns 'confirmed', 'already_confirmed' or 'conflict'
-- (the hold lapsed and someone else took the slot; the caller must refund).
create or replace function public.confirm_booking_payment(
  p_booking uuid, p_session text, p_payment_intent text, p_amount_cents integer)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    return 'not_found';
  end if;
  if b.status = 'confirmed' then
    return 'already_confirmed';
  end if;
  if b.status = 'cancelled' then
    return 'conflict';
  end if;
  if b.status = 'expired' then
    begin
      update public.booking_items set active = true where booking_id = p_booking;
    exception when exclusion_violation then
      update public.bookings
         set stripe_checkout_session_id = coalesce(p_session, stripe_checkout_session_id),
             stripe_payment_intent_id = p_payment_intent
       where id = p_booking;
      return 'conflict';
    end;
  end if;

  update public.bookings
     set status = 'confirmed',
         confirmed_at = now(),
         hold_expires_at = null,
         stripe_checkout_session_id = coalesce(p_session, stripe_checkout_session_id),
         stripe_payment_intent_id = p_payment_intent,
         total_cents = coalesce(p_amount_cents, total_cents)
   where id = p_booking;
  return 'confirmed';
end;
$$;

create or replace function public.expire_booking(p_booking uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with b as (
    update public.bookings set status = 'expired'
     where id = p_booking and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from b where bi.booking_id = b.id;
end;
$$;

-- Records a cancellation (after any refund has been issued) and frees the slots.
create or replace function public.mark_booking_cancelled(p_booking uuid, p_refund_cents integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), refund_cents = greatest(coalesce(p_refund_cents, 0), 0)
   where id = p_booking and status in ('confirmed', 'pending', 'expired');
  update public.booking_items set active = false where booking_id = p_booking;
end;
$$;

-- ---------------------------------------------------------------------
-- Row level security & grants
-- ---------------------------------------------------------------------
alter table public.bookings      enable row level security;
alter table public.booking_items enable row level security;

create policy "read own bookings or all with bookings_view_all" on public.bookings for select to authenticated
  using (user_id = auth.uid() or public.has_privilege('bookings_view_all', location_id));
create policy "read own booking items or all with bookings_view_all" on public.booking_items for select to authenticated
  using (exists (
    select 1 from public.bookings b
     where b.id = booking_id
       and (b.user_id = auth.uid() or public.has_privilege('bookings_view_all', b.location_id))
  ));

-- Clients never write bookings directly; only through the functions above.
revoke insert, update, delete on public.bookings, public.booking_items from anon, authenticated;

revoke execute on function public.location_day_window(uuid, date) from public, anon, authenticated;
revoke execute on function public.expire_stale_holds() from public, anon, authenticated;
revoke execute on function public.set_booking_checkout_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.confirm_booking_payment(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.expire_booking(uuid) from public, anon, authenticated;
revoke execute on function public.mark_booking_cancelled(uuid, integer) from public, anon, authenticated;
revoke execute on function public.create_booking_hold(uuid, uuid[], timestamptz, timestamptz) from public, anon;
revoke execute on function public.release_booking_hold(uuid) from public, anon;
revoke execute on function public.my_bookings() from public, anon;

grant execute on function public.get_availability(uuid, date) to anon, authenticated;
grant execute on function public.is_peak_slot(uuid, timestamptz) to anon, authenticated;
grant execute on function public.slot_price_cents(uuid, public.resource_type, timestamptz) to anon, authenticated;
grant execute on function public.create_booking_hold(uuid, uuid[], timestamptz, timestamptz) to authenticated;
grant execute on function public.release_booking_hold(uuid) to authenticated;
grant execute on function public.my_bookings() to authenticated;

grant execute on function public.set_booking_checkout_session(uuid, text) to service_role;
grant execute on function public.confirm_booking_payment(uuid, text, text, integer) to service_role;
grant execute on function public.expire_booking(uuid) to service_role;
grant execute on function public.mark_booking_cancelled(uuid, integer) to service_role;
grant execute on function public.expire_stale_holds() to service_role;
