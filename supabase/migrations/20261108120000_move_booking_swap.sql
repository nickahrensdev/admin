-- Front desk moves: if the target cage is already booked at that time, the
-- bookings there swap into the cage being vacated (all in one step).
drop function public.staff_move_booking(uuid, uuid, uuid);

create or replace function public.staff_move_booking(p_booking uuid, p_from uuid, p_to uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b        record;
  r_from   record;
  r_to     record;
  o        record;
  v_item   uuid;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_tz     text;
  v_swapped jsonb := '[]'::jsonb;
begin
  select id, location_id, status, ends_at into b from public.bookings where id = p_booking;
  if b.id is null then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if not public.has_privilege('bookings_manage', b.location_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be moved.' using errcode = '22023';
  end if;
  if b.ends_at <= now() then
    raise exception 'This booking is already over.' using errcode = '22023';
  end if;

  select id, name, type into r_from from public.resources where id = p_from;
  select id, name, type, location_id, is_active into r_to from public.resources where id = p_to;
  if r_to.id is null or r_to.location_id <> b.location_id or not r_to.is_active then
    raise exception 'Pick a cage at this location.' using errcode = '22023';
  end if;
  select id, starts_at, ends_at into v_item, v_starts, v_ends
    from public.booking_items where booking_id = p_booking and resource_id = p_from and active;
  if r_from.id is null or v_item is null then
    raise exception 'That cage isn''t part of this booking.' using errcode = '22023';
  end if;
  if r_to.type <> r_from.type then
    raise exception 'Bookings can only move between the same kind (cage to cage, turf to turf).' using errcode = '22023';
  end if;
  if exists (select 1 from public.booking_items where booking_id = p_booking and resource_id = p_to and active) then
    raise exception '% is already part of this booking.', r_to.name using errcode = '22023';
  end if;
  select timezone into v_tz from public.locations where id = b.location_id;

  -- Step 1: take this booking out of its cage for a moment.
  update public.booking_items set active = false where id = v_item;

  -- Step 2: anything in the target cage at that time swaps into the vacated cage.
  for o in
    select bi.id as item_id, bi.booking_id, bi.starts_at, bi.ends_at, bk.kind, bk.note, bk.guest_name, p.display_name
      from public.booking_items bi
      join public.bookings bk on bk.id = bi.booking_id
      left join public.profiles p on p.id = bk.user_id
     where bi.resource_id = p_to and bi.active
       and bi.starts_at < v_ends and bi.ends_at > v_starts
     for update of bi
  loop
    if exists (select 1 from public.booking_items where booking_id = o.booking_id and resource_id = p_from and active) then
      raise exception 'Can''t swap: % already uses % too.',
        coalesce(o.display_name, o.guest_name, o.note, 'the other booking'), r_from.name using errcode = '22023';
    end if;
    begin
      update public.booking_items set resource_id = p_from where id = o.item_id;
    exception when exclusion_violation then
      raise exception 'Can''t swap: % (% – %) doesn''t fit in % because it''s booked then too.',
        coalesce(o.display_name, o.guest_name, o.note, 'the other booking'),
        to_char(o.starts_at at time zone v_tz, 'FMHH12:MI AM'), to_char(o.ends_at at time zone v_tz, 'FMHH12:MI AM'),
        r_from.name using errcode = '23P01';
    end;
    v_swapped := v_swapped || jsonb_build_object(
      'booking_id', o.booking_id,
      'who', case when o.kind = 'block' then coalesce(o.note, 'Blocked time') else coalesce(o.display_name, o.guest_name, 'Walk-in') end);
  end loop;

  -- Step 3: put this booking in the target cage.
  update public.booking_items set resource_id = p_to, active = true where id = v_item;

  return jsonb_build_object('from', r_from.name, 'to', r_to.name, 'swapped', v_swapped);
end;
$$;

revoke execute on function public.staff_move_booking(uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_move_booking(uuid, uuid, uuid) to authenticated;
