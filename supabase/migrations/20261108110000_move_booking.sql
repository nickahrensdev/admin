-- Front desk: move a booking (or blocked time) from one cage to another of the
-- same kind (cage → cage, turf → turf), keeping the time and price.
create or replace function public.staff_move_booking(p_booking uuid, p_from uuid, p_to uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  b      record;
  r_from record;
  r_to   record;
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

  select id, name, type, location_id into r_from from public.resources where id = p_from;
  select id, name, type, location_id, is_active into r_to from public.resources where id = p_to;
  if r_to.id is null or r_to.location_id <> b.location_id or not r_to.is_active then
    raise exception 'Pick a cage at this location.' using errcode = '22023';
  end if;
  if r_from.id is null or not exists (select 1 from public.booking_items
                                       where booking_id = p_booking and resource_id = p_from and active) then
    raise exception 'That cage isn''t part of this booking.' using errcode = '22023';
  end if;
  if r_to.type <> r_from.type then
    raise exception 'Bookings can only move between the same kind (cage to cage, turf to turf).' using errcode = '22023';
  end if;
  if exists (select 1 from public.booking_items where booking_id = p_booking and resource_id = p_to and active) then
    raise exception '% is already part of this booking.', r_to.name using errcode = '22023';
  end if;

  begin
    update public.booking_items set resource_id = p_to
     where booking_id = p_booking and resource_id = p_from and active;
  exception when exclusion_violation then
    raise exception '% is already booked during that time.', r_to.name using errcode = '23P01';
  end;
end;
$$;

revoke execute on function public.staff_move_booking(uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_move_booking(uuid, uuid, uuid) to authenticated;
