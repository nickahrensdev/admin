-- Fix: creating blocked time could fail with 'record "m" is not assigned yet'
-- (depending on the database connection), because the membership lookup only
-- ran for walk-ins. Found by the automated database tests.
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

  -- Always assign m (no row for blocks/guests), so the insert below can read it.
  select * into m from public.member_benefits(case when p_kind = 'walk_in' then p_user end, p_location);
  if p_kind = 'walk_in' then
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
