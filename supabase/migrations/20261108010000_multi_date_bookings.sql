-- =====================================================================
-- Multi-date and weekly-repeat bookings paid in one checkout
-- =====================================================================
-- Each date is still its own booking (so it can be cancelled and refunded
-- on its own), and bookings made together share a checkout_group that is
-- paid with a single Stripe Checkout session.
-- =====================================================================

alter table public.bookings add column checkout_group uuid;
create index bookings_checkout_group_idx on public.bookings (checkout_group);

-- One Checkout session now pays for several bookings.
alter table public.bookings drop constraint bookings_stripe_checkout_session_id_key;
create index bookings_checkout_session_idx on public.bookings (stripe_checkout_session_id);

-- ---------------------------------------------------------------------
-- Holds for one or more dates (same cages, same start time and length)
-- p_slots: [{ "starts_at": "...", "ends_at": "..." }, ...]
-- Returns { group_id, total_cents, hold_expires_at, bookings: [{ booking_id, starts_at, total_cents }] }
-- ---------------------------------------------------------------------
create or replace function public.create_booking_holds(p_location uuid, p_resource_ids uuid[], p_slots jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_days  constant int := 90;
  c_max_hours constant int := 4;
  c_max_dates constant int := 12;
  c_hold      constant interval := interval '35 minutes';
  v_uid       uuid := auth.uid();
  v_tz        text;
  v_ids       uuid[];
  v_group     uuid := gen_random_uuid();
  v_hold      timestamptz := now() + c_hold;
  v_total     int := 0;
  v_out       jsonb := '[]'::jsonb;
  v_slot      jsonb;
  v_start     timestamptz;
  v_end       timestamptz;
  v_label     text;
  w           record;
  v_booking   uuid;
  v_btotal    int;
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
  if (select count(*) from public.resources
       where id = any (v_ids) and location_id = p_location and is_active) <> cardinality(v_ids) then
    raise exception 'One of those isn''t available to book.' using errcode = '22023';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Pick at least one date.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > c_max_dates then
    raise exception 'You can book up to % dates at once.', c_max_dates using errcode = '22023';
  end if;

  perform public.expire_stale_holds();

  -- A customer has at most one unpaid checkout; starting a new one releases the old.
  with mine as (
    update public.bookings set status = 'expired'
     where user_id = v_uid and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from mine where bi.booking_id = mine.id;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_start := (v_slot ->> 'starts_at')::timestamptz;
    v_end   := (v_slot ->> 'ends_at')::timestamptz;
    v_label := to_char(v_start at time zone v_tz, 'Dy Mon FMDD');

    if v_start is null or v_end is null or v_end <= v_start then
      raise exception 'Pick a start time and length.' using errcode = '22023';
    end if;
    if extract(epoch from v_start)::bigint % 1800 <> 0 or extract(epoch from v_end)::bigint % 1800 <> 0 then
      raise exception 'Bookings start and end on the hour or half hour.' using errcode = '22023';
    end if;
    if v_end - v_start > make_interval(hours => c_max_hours) then
      raise exception 'Bookings can be up to % hours.', c_max_hours using errcode = '22023';
    end if;
    if v_start <= now() then
      raise exception '% has already started. Pick a later time.', v_label using errcode = '22023';
    end if;
    if v_start > now() + make_interval(days => c_max_days) then
      raise exception 'You can book up to % days ahead.', c_max_days using errcode = '22023';
    end if;

    select * into w from public.location_day_window(p_location, (v_start at time zone v_tz)::date);
    if w.opens_at is null then
      raise exception 'We''re closed on %. Remove that date and try again.', v_label using errcode = '22023';
    end if;
    if v_start < w.opens_at or v_end > w.closes_at then
      raise exception 'That time is outside opening hours on %.', v_label using errcode = '22023';
    end if;

    insert into public.bookings (location_id, user_id, status, starts_at, ends_at, total_cents, hold_expires_at, checkout_group)
    values (p_location, v_uid, 'pending', v_start, v_end, 0, v_hold, v_group)
    returning id into v_booking;

    v_btotal := 0;
    for r in select id, type, name from public.resources where id = any (v_ids) order by sort_order, name loop
      v_price := 0;
      for s in select generate_series(v_start, v_end - interval '30 minutes', interval '30 minutes') loop
        v_price := v_price + coalesce(public.slot_price_cents(p_location, r.type, s), -1000000);
      end loop;
      if v_price < 0 then
        raise exception 'Prices aren''t set up for this location yet.' using errcode = '22023';
      end if;
      begin
        insert into public.booking_items (booking_id, resource_id, starts_at, ends_at, price_cents)
        values (v_booking, r.id, v_start, v_end, v_price);
      exception when exclusion_violation then
        raise exception '% is already booked on %. Remove that date or pick another cage.', r.name, v_label
          using errcode = '23P01';
      end;
      v_btotal := v_btotal + v_price;
    end loop;

    update public.bookings set total_cents = v_btotal where id = v_booking;
    v_total := v_total + v_btotal;
    v_out := v_out || jsonb_build_object('booking_id', v_booking, 'starts_at', v_start, 'total_cents', v_btotal);
  end loop;

  return jsonb_build_object('group_id', v_group, 'total_cents', v_total, 'hold_expires_at', v_hold, 'bookings', v_out);
end;
$$;

-- The original single-date function now delegates, so older clients keep working.
create or replace function public.create_booking_hold(
  p_location uuid, p_resource_ids uuid[], p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.create_booking_holds(p_location, p_resource_ids,
         jsonb_build_array(jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at)));
  return jsonb_build_object(
    'booking_id', v -> 'bookings' -> 0 ->> 'booking_id',
    'group_id', v ->> 'group_id',
    'total_cents', (v ->> 'total_cents')::int,
    'hold_expires_at', v ->> 'hold_expires_at');
end;
$$;

-- Customer drops their own unpaid checkout (all its dates).
create or replace function public.release_checkout_group(p_group uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with b as (
    update public.bookings set status = 'expired'
     where checkout_group = p_group and user_id = auth.uid() and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from b where bi.booking_id = b.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Server-only (Edge Functions)
-- ---------------------------------------------------------------------
create or replace function public.set_group_checkout_session(p_group uuid, p_session text)
returns void
language sql security definer
set search_path = ''
as $$
  update public.bookings set stripe_checkout_session_id = p_session where checkout_group = p_group;
$$;

-- Confirms every booking in a paid checkout.
-- Returns [{ booking_id, result, total_cents }] where result is
-- 'confirmed' | 'already_confirmed' | 'conflict' (needs a refund).
create or replace function public.confirm_checkout_group(p_group uuid, p_session text, p_payment_intent text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b   record;
  res text;
  v_out jsonb := '[]'::jsonb;
begin
  for b in select id, total_cents from public.bookings where checkout_group = p_group order by starts_at loop
    res := public.confirm_booking_payment(b.id, p_session, p_payment_intent, null);
    v_out := v_out || jsonb_build_object('booking_id', b.id, 'result', res, 'total_cents', b.total_cents);
  end loop;
  return v_out;
end;
$$;

create or replace function public.expire_checkout_group(p_group uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with b as (
    update public.bookings set status = 'expired'
     where checkout_group = p_group and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from b where bi.booking_id = b.id;
end;
$$;

revoke execute on function public.create_booking_holds(uuid, uuid[], jsonb) from public, anon;
revoke execute on function public.release_checkout_group(uuid) from public, anon;
revoke execute on function public.set_group_checkout_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.confirm_checkout_group(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.expire_checkout_group(uuid) from public, anon, authenticated;

grant execute on function public.create_booking_holds(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.release_checkout_group(uuid) to authenticated;
grant execute on function public.set_group_checkout_session(uuid, text) to service_role;
grant execute on function public.confirm_checkout_group(uuid, text, text) to service_role;
grant execute on function public.expire_checkout_group(uuid) to service_role;
