-- =====================================================================
-- Rescheduling bookings
-- =====================================================================
-- * Customers (reschedule_booking, through the reschedule-booking Edge
--   Function): online bookings starting 24+ hours from now can move to
--   another date/time of the same length. It's repriced at the new time: if
--   it costs less the difference is refunded; if it costs more it's refused
--   (cancel for a full refund and rebook instead).
-- * Front desk (staff_reschedule_booking): any confirmed booking or blocked
--   time, any length, price unchanged.
-- * Cages: the same ones when they're free at the new time, otherwise free
--   ones of the same kind.
-- * Refund accounting: refund_cents now accumulates, so a later cancellation
--   only refunds what's still held (total_cents - refund_cents).
-- =====================================================================

create or replace function public.mark_booking_cancelled(p_booking uuid, p_refund_cents integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(),
         refund_cents = refund_cents + greatest(coalesce(p_refund_cents, 0), 0)
   where id = p_booking and status in ('confirmed', 'pending', 'expired');
  update public.booking_items set active = false where booking_id = p_booking;
end;
$$;

create or replace function public.staff_mark_cancelled(p_booking uuid, p_refund_cents integer, p_by uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(),
         refund_cents = refund_cents + greatest(coalesce(p_refund_cents, 0), 0),
         cancelled_by = p_by
   where id = p_booking and status in ('confirmed', 'pending');
  update public.booking_items set active = false where booking_id = p_booking;
end;
$$;

-- Picks cages for a booking at a new time: the same ones where free, else free
-- ones of the same kind. The booking's own items must be inactive when called.
create or replace function public.pick_resources_for_move(p_booking uuid, p_starts timestamptz, p_ends timestamptz)
returns uuid[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_loc    uuid;
  v_out    uuid[] := '{}';
  it       record;
  v_pick   uuid;
begin
  select location_id into v_loc from public.bookings where id = p_booking;
  for it in
    select bi.resource_id, r.type, r.name
      from public.booking_items bi join public.resources r on r.id = bi.resource_id
     where bi.booking_id = p_booking
     order by r.sort_order, r.name
  loop
    select r.id into v_pick
      from public.resources r
     where r.location_id = v_loc and r.is_active and r.type = it.type
       and not (r.id = any (v_out))
       and not exists (select 1 from public.booking_items x
                        where x.resource_id = r.id and x.active
                          and x.starts_at < p_ends and x.ends_at > p_starts)
     order by (r.id = it.resource_id) desc, r.sort_order, r.name
     limit 1;
    if v_pick is null then
      raise exception 'There isn''t a free % at that time.', case when it.type = 'turf' then 'turf area' else 'cage' end
        using errcode = '23P01';
    end if;
    v_out := v_out || v_pick;
  end loop;
  return v_out;
end;
$$;

-- Checks a time window against opening hours (raises a friendly error).
create or replace function public.check_open_window(p_location uuid, p_starts timestamptz, p_ends timestamptz)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_label text;
  w       record;
begin
  select timezone into v_tz from public.locations where id = p_location;
  v_label := to_char(p_starts at time zone v_tz, 'Dy Mon FMDD');
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'Pick a start time and length.' using errcode = '22023';
  end if;
  if extract(epoch from p_starts)::bigint % 1800 <> 0 or extract(epoch from p_ends)::bigint % 1800 <> 0 then
    raise exception 'Times start and end on the hour or half hour.' using errcode = '22023';
  end if;
  select * into w from public.location_day_window(p_location, (p_starts at time zone v_tz)::date);
  if w.opens_at is null then
    raise exception 'We''re closed on %.', v_label using errcode = '22023';
  end if;
  if p_starts < w.opens_at or p_ends > w.closes_at then
    raise exception 'That time is outside opening hours on %.', v_label using errcode = '22023';
  end if;
end;
$$;

-- Customer reschedule (internal). p_dry_run = true only works out the result.
-- Returns { starts_at, ends_at, resources, held_cents, new_cents, refund_cents }.
-- Customers call reschedule_preview; applying goes through the reschedule-booking
-- Edge Function so the refund and the change happen together.
create or replace function public.reschedule_booking_core(p_user uuid, p_booking uuid, p_starts_at timestamptz, p_dry_run boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_public_days constant int := 30;
  b        record;
  m        record;
  v_uid    uuid := p_user;
  v_ends   timestamptz;
  v_res    uuid[];
  v_quote  jsonb;
  v_date   jsonb;
  v_item   jsonb;
  v_held   int;
  v_new    int;
  v_window int;
  v_out    jsonb;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.user_id is distinct from v_uid then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if b.kind <> 'online' then
    raise exception 'This booking was made at the front desk. Please contact us to change it.' using errcode = '22023';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be changed.' using errcode = '22023';
  end if;
  if b.starts_at <= now() + interval '24 hours' then
    raise exception 'Bookings can be changed up to 24 hours before they start.' using errcode = '22023';
  end if;

  v_ends := p_starts_at + (b.ends_at - b.starts_at);
  if p_starts_at = b.starts_at then
    raise exception 'That''s the time you already have.' using errcode = '22023';
  end if;
  if p_starts_at <= now() then
    raise exception 'Pick a time in the future.' using errcode = '22023';
  end if;
  select * into m from public.member_benefits(v_uid, b.location_id);
  v_window := coalesce(m.booking_window_days, c_public_days);
  if p_starts_at > now() + make_interval(days => v_window) then
    raise exception 'You can book up to % days ahead.', v_window using errcode = '22023';
  end if;
  perform public.check_open_window(b.location_id, p_starts_at, v_ends);

  v_held := b.total_cents - b.refund_cents;

  begin
    -- Free this booking's own cages while working out the new ones.
    update public.booking_items set active = false where booking_id = b.id;
    v_res := public.pick_resources_for_move(b.id, p_starts_at, v_ends);
    v_quote := public.price_booking(v_uid, b.location_id, v_res,
                 jsonb_build_array(jsonb_build_object('starts_at', p_starts_at, 'ends_at', v_ends)), null);
    v_date := v_quote -> 'dates' -> 0;
    v_new := (v_date ->> 'total_cents')::int;
    if v_new > v_held then
      raise exception 'That time costs % more. Cancel this booking for a full refund and book the new time instead.',
        to_char((v_new - v_held) / 100.0, 'FM$999,990.00') using errcode = '22023';
    end if;

    v_out := jsonb_build_object(
      'starts_at', p_starts_at, 'ends_at', v_ends,
      'resources', (select jsonb_agg(r.name order by r.sort_order, r.name) from public.resources r where r.id = any (v_res)),
      'held_cents', v_held, 'new_cents', v_new, 'refund_cents', v_held - v_new);

    if p_dry_run then
      raise exception using errcode = 'YD001'; -- undo the trial changes
    end if;

    delete from public.booking_items where booking_id = b.id;
    for v_item in select * from jsonb_array_elements(v_date -> 'items') loop
      insert into public.booking_items (booking_id, resource_id, starts_at, ends_at, price_cents, list_price_cents, included_minutes)
      values (b.id, (v_item ->> 'resource_id')::uuid, p_starts_at, v_ends, (v_item ->> 'price_cents')::int,
              (v_item ->> 'list_cents')::int, (v_item ->> 'included_minutes')::int);
    end loop;
    update public.bookings
       set starts_at = p_starts_at, ends_at = v_ends,
           refund_cents = refund_cents + (v_held - v_new),
           discount_cents = (v_date ->> 'discount_cents')::int,
           membership_id = m.membership_id,
           reminder_queued_at = null
     where id = b.id;
  exception when sqlstate 'YD001' then
    null;
  end;
  return v_out;
end;
$$;

-- Front desk reschedule: any confirmed booking or blocked time, any length, same price.
create or replace function public.staff_reschedule_booking(p_booking uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  b      record;
  v_tz   text;
  v_res  uuid[];
  v_old  record;
  i      int := 0;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if not public.has_privilege('bookings_manage', b.location_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be changed.' using errcode = '22023';
  end if;
  select timezone into v_tz from public.locations where id = b.location_id;
  if p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'That''s longer than 12 hours.' using errcode = '22023';
  end if;
  if (p_starts_at at time zone v_tz)::date < (now() at time zone v_tz)::date or p_ends_at <= now() then
    raise exception 'Pick a time that isn''t over yet.' using errcode = '22023';
  end if;
  perform public.check_open_window(b.location_id, p_starts_at, p_ends_at);

  update public.booking_items set active = false where booking_id = b.id;
  v_res := public.pick_resources_for_move(b.id, p_starts_at, p_ends_at);

  -- Keep each item's price; give it the new cage and time.
  for v_old in
    select bi.id from public.booking_items bi join public.resources r on r.id = bi.resource_id
     where bi.booking_id = b.id order by r.sort_order, r.name
  loop
    i := i + 1;
    update public.booking_items
       set resource_id = v_res[i], starts_at = p_starts_at, ends_at = p_ends_at, active = true
     where id = v_old.id;
  end loop;
  update public.bookings
     set starts_at = p_starts_at, ends_at = p_ends_at, reminder_queued_at = null,
         checked_in_at = null, no_show = false
   where id = b.id;

  return jsonb_build_object(
    'starts_at', p_starts_at, 'ends_at', p_ends_at,
    'resources', (select jsonb_agg(r.name order by r.sort_order, r.name) from public.resources r where r.id = any (v_res)));
end;
$$;

revoke execute on function public.pick_resources_for_move(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.check_open_window(uuid, timestamptz, timestamptz) from public, anon, authenticated;
create or replace function public.reschedule_preview(p_booking uuid, p_starts_at timestamptz)
returns jsonb
language sql security definer
set search_path = ''
as $$ select public.reschedule_booking_core(auth.uid(), p_booking, p_starts_at, true) $$;

revoke execute on function public.reschedule_booking_core(uuid, uuid, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.reschedule_preview(uuid, timestamptz) from public, anon;
revoke execute on function public.staff_reschedule_booking(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_booking_core(uuid, uuid, timestamptz, boolean) to service_role;
grant execute on function public.reschedule_preview(uuid, timestamptz) to authenticated;
grant execute on function public.staff_reschedule_booking(uuid, timestamptz, timestamptz) to authenticated;
