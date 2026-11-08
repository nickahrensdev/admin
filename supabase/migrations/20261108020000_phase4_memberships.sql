-- =====================================================================
-- Phase 4: membership tiers, Stripe subscriptions and member pricing
-- =====================================================================
-- * A tier is either for one location or for all locations, with a monthly
--   and (optionally) a yearly price.
-- * Benefits are set per tier AND per location: included cage minutes per
--   calendar month (no rollover; turf never uses them), a cage discount for
--   time beyond the included minutes, a turf discount, a booking window and
--   an optional cap on upcoming bookings.
-- * Stripe owns billing; the webhook mirrors each subscription into
--   memberships. Benefits apply only while status = 'active'.
-- * Non-members can book 30 days ahead; members get their tier's window.
-- * All prices are computed here (price_booking); the browser only shows
--   what quote_booking returns.
-- =====================================================================

insert into public.privileges (code, description) values
  ('memberships_manage', 'Create and edit membership tiers and see members');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.membership_tiers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) between 1 and 40),
  description         text not null default '' check (length(description) <= 300),
  scope               text not null check (scope in ('location', 'all')),
  location_id         uuid references public.locations (id) on delete cascade,
  monthly_price_cents integer not null check (monthly_price_cents >= 50),
  yearly_price_cents  integer check (yearly_price_cents is null or yearly_price_cents >= 50),
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  check ((scope = 'location') = (location_id is not null))
);

create table public.tier_location_benefits (
  tier_id                 uuid not null references public.membership_tiers (id) on delete cascade,
  location_id             uuid not null references public.locations (id) on delete cascade,
  included_cage_minutes   integer not null default 0 check (included_cage_minutes >= 0 and included_cage_minutes % 30 = 0),
  cage_discount_pct       integer not null default 0 check (cage_discount_pct between 0 and 100),
  turf_discount_pct       integer not null default 0 check (turf_discount_pct between 0 and 100),
  booking_window_days     integer not null default 90 check (booking_window_days between 1 and 365),
  max_upcoming_bookings   integer check (max_upcoming_bookings is null or max_upcoming_bookings >= 1),
  primary key (tier_id, location_id)
);

create table public.memberships (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  tier_id                uuid not null references public.membership_tiers (id),
  status                 text not null check (status in ('incomplete', 'active', 'past_due', 'canceled')),
  billing_interval       text not null check (billing_interval in ('month', 'year')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  stripe_subscription_id text unique,
  stripe_customer_id     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index memberships_user_idx on public.memberships (user_id);

alter table public.profiles add column stripe_customer_id text;

alter table public.bookings add column membership_id uuid references public.memberships (id);
alter table public.bookings add column discount_cents integer not null default 0;
alter table public.booking_items add column list_price_cents integer;
alter table public.booking_items add column included_minutes integer not null default 0;

-- ---------------------------------------------------------------------
-- Seed: two starter tiers (all editable in the app)
-- ---------------------------------------------------------------------
with loc as (select id from public.locations where slug = 'location-1'),
rookie as (
  insert into public.membership_tiers (name, description, scope, location_id, monthly_price_cents, yearly_price_cents, sort_order)
  select 'Rookie', 'Your home cage at one location: monthly cage time plus member pricing.', 'location', loc.id, 4900, 49000, 10 from loc
  returning id, location_id
),
allstar as (
  insert into public.membership_tiers (name, description, scope, monthly_price_cents, yearly_price_cents, sort_order)
  values ('All-Star', 'Every location, more cage time and bigger discounts.', 'all', 9900, 99000, 20)
  returning id
)
insert into public.tier_location_benefits (tier_id, location_id, included_cage_minutes, cage_discount_pct, turf_discount_pct, booking_window_days)
select rookie.id, rookie.location_id, 240, 10, 10, 90 from rookie
union all
select allstar.id, l.id, 480, 20, 20, 90 from allstar, public.locations l;

-- New locations get All-Star style benefits for every "all locations" tier.
create or replace function public.handle_new_location_benefits()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.tier_location_benefits (tier_id, location_id)
  select t.id, new.id from public.membership_tiers t where t.scope = 'all'
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_location_created_benefits
  after insert on public.locations
  for each row execute function public.handle_new_location_benefits();

-- New tiers get a benefits row for each location they cover.
create or replace function public.handle_new_tier()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.tier_location_benefits (tier_id, location_id)
  select new.id, l.id from public.locations l
   where new.scope = 'all' or l.id = new.location_id
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_tier_created
  after insert on public.membership_tiers
  for each row execute function public.handle_new_tier();

-- ---------------------------------------------------------------------
-- Member benefits & pricing
-- ---------------------------------------------------------------------

-- The best active membership benefits a user has at a location (or no row).
create or replace function public.member_benefits(p_uid uuid, p_location uuid)
returns table (membership_id uuid, tier_name text, included_cage_minutes int, cage_discount_pct int,
               turf_discount_pct int, booking_window_days int, max_upcoming_bookings int)
language sql stable security definer
set search_path = ''
as $$
  select m.id, t.name, b.included_cage_minutes, b.cage_discount_pct, b.turf_discount_pct,
         b.booking_window_days, b.max_upcoming_bookings
    from public.memberships m
    join public.membership_tiers t on t.id = m.tier_id
    join public.tier_location_benefits b on b.tier_id = t.id and b.location_id = p_location
   where m.user_id = p_uid
     and m.status = 'active'
     and (m.current_period_end is null or m.current_period_end > now())
     and (t.scope = 'all' or t.location_id = p_location)
   order by b.included_cage_minutes desc, b.cage_discount_pct desc, b.turf_discount_pct desc
   limit 1;
$$;

-- Prices a set of dates for the given resources and user.
-- p_slots: [{ starts_at, ends_at }]. Bookings in p_exclude_group don't count
-- towards included minutes already used (so re-quoting a hold is stable).
-- Returns { member, total_cents, discount_cents, dates: [{ starts_at, ends_at, total_cents,
--   discount_cents, included_minutes, items: [{ resource_id, name, type, list_cents, price_cents, included_minutes }] }] }
create or replace function public.price_booking(
  p_uid uuid, p_location uuid, p_resource_ids uuid[], p_slots jsonb, p_exclude_group uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz        text;
  m           record;
  v_month     text;
  v_used      jsonb := '{}'::jsonb; -- month -> minutes used so far
  v_slot      jsonb;
  v_start     timestamptz;
  v_end       timestamptz;
  r           record;
  s           timestamptz;
  v_list      int;
  v_slot_list int;
  v_price     int;
  v_incl      int;
  v_items     jsonb;
  v_dates     jsonb := '[]'::jsonb;
  v_total     int := 0;
  v_disc      int := 0;
  v_dtotal    int;
  v_ddisc     int;
  v_dincl     int;
  v_left      int;
begin
  select timezone into v_tz from public.locations where id = p_location;
  select * into m from public.member_benefits(p_uid, p_location);

  for v_slot in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    v_start := (v_slot ->> 'starts_at')::timestamptz;
    v_end   := (v_slot ->> 'ends_at')::timestamptz;
    v_month := to_char(v_start at time zone v_tz, 'YYYY-MM');

    -- Included minutes already used this calendar month (outside this request).
    if m.membership_id is not null and not (v_used ? v_month) then
      v_used := v_used || jsonb_build_object(v_month, coalesce((
        select sum(bi.included_minutes)
          from public.booking_items bi
          join public.bookings b on b.id = bi.booking_id
         where b.membership_id = m.membership_id
           and bi.active
           and b.status in ('pending', 'confirmed')
           and (p_exclude_group is null or b.checkout_group is distinct from p_exclude_group)
           and to_char(b.starts_at at time zone v_tz, 'YYYY-MM') = v_month), 0));
    end if;

    v_items := '[]'::jsonb;
    v_dtotal := 0; v_ddisc := 0; v_dincl := 0;
    for r in select id, name, type from public.resources where id = any (p_resource_ids) order by sort_order, name loop
      v_list := 0; v_price := 0; v_incl := 0;
      for s in select generate_series(v_start, v_end - interval '30 minutes', interval '30 minutes') loop
        v_slot_list := public.slot_price_cents(p_location, r.type, s);
        if v_slot_list is null then
          raise exception 'Prices aren''t set up for this location yet.' using errcode = '22023';
        end if;
        v_list := v_list + v_slot_list;
        if m.membership_id is null then
          v_price := v_price + v_slot_list;
        elsif r.type = 'batting_cage' then
          v_left := m.included_cage_minutes - (v_used ->> v_month)::int;
          if v_left >= 30 then
            v_incl := v_incl + 30;
            v_used := jsonb_set(v_used, array[v_month], to_jsonb((v_used ->> v_month)::int + 30));
          else
            v_price := v_price + round(v_slot_list * (100 - m.cage_discount_pct) / 100.0)::int;
          end if;
        else
          v_price := v_price + round(v_slot_list * (100 - m.turf_discount_pct) / 100.0)::int;
        end if;
      end loop;
      v_items := v_items || jsonb_build_object('resource_id', r.id, 'name', r.name, 'type', r.type,
                   'list_cents', v_list, 'price_cents', v_price, 'included_minutes', v_incl);
      v_dtotal := v_dtotal + v_price;
      v_ddisc := v_ddisc + (v_list - v_price);
      v_dincl := v_dincl + v_incl;
    end loop;

    v_dates := v_dates || jsonb_build_object('starts_at', v_start, 'ends_at', v_end, 'total_cents', v_dtotal,
                 'discount_cents', v_ddisc, 'included_minutes', v_dincl, 'items', v_items);
    v_total := v_total + v_dtotal;
    v_disc := v_disc + v_ddisc;
  end loop;

  return jsonb_build_object(
    'member', case when m.membership_id is null then null else jsonb_build_object(
      'membership_id', m.membership_id, 'tier_name', m.tier_name,
      'included_cage_minutes', m.included_cage_minutes,
      'cage_discount_pct', m.cage_discount_pct, 'turf_discount_pct', m.turf_discount_pct,
      'booking_window_days', m.booking_window_days) end,
    'total_cents', v_total,
    'discount_cents', v_disc,
    'dates', v_dates);
end;
$$;

-- Price preview for the signed-in user (no hold).
create or replace function public.quote_booking(p_location uuid, p_resource_ids uuid[], p_slots jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to book.' using errcode = '42501';
  end if;
  if coalesce(jsonb_array_length(p_slots), 0) > 12 or coalesce(cardinality(p_resource_ids), 0) > 10 then
    raise exception 'Too many dates or resources.' using errcode = '22023';
  end if;
  return public.price_booking(auth.uid(), p_location, p_resource_ids, p_slots, null);
end;
$$;

-- What the signed-in user's booking rules are at a location.
create or replace function public.my_booking_terms(p_location uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  m     record;
  v_tz  text;
  v_used int;
begin
  select timezone into v_tz from public.locations where id = p_location;
  select * into m from public.member_benefits(auth.uid(), p_location);
  if m.membership_id is null then
    return jsonb_build_object('member', false, 'booking_window_days', 30);
  end if;
  select coalesce(sum(bi.included_minutes), 0) into v_used
    from public.booking_items bi join public.bookings b on b.id = bi.booking_id
   where b.membership_id = m.membership_id and bi.active and b.status in ('pending', 'confirmed')
     and to_char(b.starts_at at time zone v_tz, 'YYYY-MM') = to_char(now() at time zone v_tz, 'YYYY-MM');
  return jsonb_build_object(
    'member', true,
    'tier_name', m.tier_name,
    'booking_window_days', m.booking_window_days,
    'included_cage_minutes', m.included_cage_minutes,
    'included_used_this_month', v_used,
    'cage_discount_pct', m.cage_discount_pct,
    'turf_discount_pct', m.turf_discount_pct,
    'max_upcoming_bookings', m.max_upcoming_bookings);
end;
$$;

-- ---------------------------------------------------------------------
-- Holds now use member pricing and booking windows
-- ---------------------------------------------------------------------
create or replace function public.create_booking_holds(p_location uuid, p_resource_ids uuid[], p_slots jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_public_days constant int := 30;
  c_max_hours   constant int := 4;
  c_max_dates   constant int := 12;
  c_hold        constant interval := interval '35 minutes';
  v_uid         uuid := auth.uid();
  v_tz          text;
  v_ids         uuid[];
  v_group       uuid := gen_random_uuid();
  v_hold        timestamptz := now() + c_hold;
  v_window      int;
  m             record;
  v_quote       jsonb;
  v_date        jsonb;
  v_item        jsonb;
  v_start       timestamptz;
  v_end         timestamptz;
  v_label       text;
  w             record;
  v_booking     uuid;
  v_out         jsonb := '[]'::jsonb;
  v_upcoming    int;
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

  select * into m from public.member_benefits(v_uid, p_location);
  v_window := coalesce(m.booking_window_days, c_public_days);

  perform public.expire_stale_holds();

  -- A customer has at most one unpaid checkout; starting a new one releases the old.
  with mine as (
    update public.bookings set status = 'expired'
     where user_id = v_uid and status = 'pending'
    returning id
  )
  update public.booking_items bi set active = false from mine where bi.booking_id = mine.id;

  if m.max_upcoming_bookings is not null then
    select count(*) into v_upcoming from public.bookings
     where user_id = v_uid and location_id = p_location and status = 'confirmed' and starts_at > now();
    if v_upcoming + jsonb_array_length(p_slots) > m.max_upcoming_bookings then
      raise exception 'Your membership allows up to % upcoming bookings here (you have %).',
        m.max_upcoming_bookings, v_upcoming using errcode = '22023';
    end if;
  end if;

  -- Validate every date before pricing.
  for v_date in select * from jsonb_array_elements(p_slots) loop
    v_start := (v_date ->> 'starts_at')::timestamptz;
    v_end   := (v_date ->> 'ends_at')::timestamptz;
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
    if v_start > now() + make_interval(days => v_window) then
      if m.membership_id is null then
        raise exception 'You can book up to % days ahead. Members can book up to 90 days ahead.', v_window using errcode = '22023';
      end if;
      raise exception 'You can book up to % days ahead.', v_window using errcode = '22023';
    end if;
    select * into w from public.location_day_window(p_location, (v_start at time zone v_tz)::date);
    if w.opens_at is null then
      raise exception 'We''re closed on %. Remove that date and try again.', v_label using errcode = '22023';
    end if;
    if v_start < w.opens_at or v_end > w.closes_at then
      raise exception 'That time is outside opening hours on %.', v_label using errcode = '22023';
    end if;
  end loop;

  v_quote := public.price_booking(v_uid, p_location, v_ids,
               (select jsonb_agg(e order by (e ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_slots) e), null);

  for v_date in select * from jsonb_array_elements(v_quote -> 'dates') loop
    v_start := (v_date ->> 'starts_at')::timestamptz;
    v_end   := (v_date ->> 'ends_at')::timestamptz;
    v_label := to_char(v_start at time zone v_tz, 'Dy Mon FMDD');

    insert into public.bookings (location_id, user_id, status, starts_at, ends_at, total_cents, discount_cents,
                                 hold_expires_at, checkout_group, membership_id)
    values (p_location, v_uid, 'pending', v_start, v_end, (v_date ->> 'total_cents')::int,
            (v_date ->> 'discount_cents')::int, v_hold, v_group, m.membership_id)
    returning id into v_booking;

    for v_item in select * from jsonb_array_elements(v_date -> 'items') loop
      begin
        insert into public.booking_items (booking_id, resource_id, starts_at, ends_at, price_cents, list_price_cents, included_minutes)
        values (v_booking, (v_item ->> 'resource_id')::uuid, v_start, v_end, (v_item ->> 'price_cents')::int,
                (v_item ->> 'list_cents')::int, (v_item ->> 'included_minutes')::int);
      exception when exclusion_violation then
        raise exception '% is already booked on %. Remove that date or pick another cage.', v_item ->> 'name', v_label
          using errcode = '23P01';
      end;
    end loop;

    v_out := v_out || jsonb_build_object('booking_id', v_booking, 'starts_at', v_start,
               'total_cents', (v_date ->> 'total_cents')::int);
  end loop;

  return jsonb_build_object('group_id', v_group, 'total_cents', (v_quote ->> 'total_cents')::int,
           'discount_cents', (v_quote ->> 'discount_cents')::int, 'hold_expires_at', v_hold, 'bookings', v_out);
end;
$$;

-- Confirms a checkout that costs nothing (all covered by included cage time).
create or replace function public.confirm_free_checkout(p_group uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bookings where checkout_group = p_group
              and (user_id is distinct from auth.uid() or status <> 'pending' or total_cents <> 0
                   or hold_expires_at <= now())) then
    raise exception 'This booking needs payment or has expired.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bookings where checkout_group = p_group) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  update public.bookings set status = 'confirmed', confirmed_at = now(), hold_expires_at = null
   where checkout_group = p_group;
end;
$$;

-- ---------------------------------------------------------------------
-- Memberships: customer views
-- ---------------------------------------------------------------------
create or replace function public.list_membership_tiers()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'description', t.description, 'scope', t.scope,
    'location', case when t.location_id is null then null
                     else (select jsonb_build_object('id', l.id, 'name', l.name) from public.locations l where l.id = t.location_id) end,
    'monthly_price_cents', t.monthly_price_cents, 'yearly_price_cents', t.yearly_price_cents,
    'benefits', (select coalesce(jsonb_agg(jsonb_build_object(
                   'location_id', b.location_id, 'location_name', l.name,
                   'included_cage_minutes', b.included_cage_minutes,
                   'cage_discount_pct', b.cage_discount_pct, 'turf_discount_pct', b.turf_discount_pct,
                   'booking_window_days', b.booking_window_days, 'max_upcoming_bookings', b.max_upcoming_bookings)
                   order by l.name), '[]'::jsonb)
                   from public.tier_location_benefits b join public.locations l on l.id = b.location_id
                  where b.tier_id = t.id and l.is_active))
    order by t.sort_order, t.monthly_price_cents), '[]'::jsonb)
    from public.membership_tiers t
   where t.is_active;
$$;

create or replace function public.my_membership()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select (select jsonb_build_object(
      'id', m.id, 'status', m.status, 'billing_interval', m.billing_interval,
      'current_period_end', m.current_period_end, 'cancel_at_period_end', m.cancel_at_period_end,
      'tier', jsonb_build_object('id', t.id, 'name', t.name, 'scope', t.scope,
                'location_name', (select name from public.locations where id = t.location_id)))
    from public.memberships m join public.membership_tiers t on t.id = m.tier_id
   where m.user_id = auth.uid() and m.status in ('active', 'past_due', 'incomplete')
   order by (m.status = 'active') desc, m.created_at desc
   limit 1);
$$;

-- Admin: everyone with a membership.
create or replace function public.admin_list_members()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('memberships_manage') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'status', m.status, 'billing_interval', m.billing_interval,
      'current_period_end', m.current_period_end, 'cancel_at_period_end', m.cancel_at_period_end,
      'tier_name', t.name, 'display_name', p.display_name, 'username', p.username::text, 'email', p.email)
      order by m.created_at desc), '[]'::jsonb)
    from public.memberships m
    join public.membership_tiers t on t.id = m.tier_id
    join public.profiles p on p.id = m.user_id
   where m.status <> 'incomplete');
end;
$$;

-- ---------------------------------------------------------------------
-- Server-only (Edge Functions with the service role)
-- ---------------------------------------------------------------------
create or replace function public.upsert_membership_from_stripe(
  p_user uuid, p_tier uuid, p_subscription text, p_customer text, p_status text, p_interval text,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text := case
    when p_status in ('active', 'trialing') then 'active'
    when p_status in ('past_due', 'unpaid') then 'past_due'
    when p_status in ('canceled', 'incomplete_expired') then 'canceled'
    else 'incomplete' end;
begin
  insert into public.memberships (user_id, tier_id, status, billing_interval, current_period_start, current_period_end,
                                  cancel_at_period_end, stripe_subscription_id, stripe_customer_id)
  values (p_user, p_tier, v_status, coalesce(p_interval, 'month'), p_period_start, p_period_end,
          coalesce(p_cancel_at_period_end, false), p_subscription, p_customer)
  on conflict (stripe_subscription_id) do update set
    status = excluded.status,
    billing_interval = excluded.billing_interval,
    current_period_start = coalesce(excluded.current_period_start, public.memberships.current_period_start),
    current_period_end = coalesce(excluded.current_period_end, public.memberships.current_period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, public.memberships.stripe_customer_id),
    updated_at = now();
  if p_customer is not null then
    update public.profiles set stripe_customer_id = p_customer where id = p_user and stripe_customer_id is null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- my_bookings: include member savings
-- ---------------------------------------------------------------------
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
-- RLS & grants
-- ---------------------------------------------------------------------
alter table public.membership_tiers       enable row level security;
alter table public.tier_location_benefits enable row level security;
alter table public.memberships            enable row level security;

create policy "read active tiers" on public.membership_tiers for select
  using (is_active or public.has_privilege('memberships_manage'));
create policy "manage tiers" on public.membership_tiers for all to authenticated
  using (public.has_privilege('memberships_manage'))
  with check (public.has_privilege('memberships_manage'));

create policy "read benefits" on public.tier_location_benefits for select using (true);
create policy "manage benefits" on public.tier_location_benefits for all to authenticated
  using (public.has_privilege('memberships_manage'))
  with check (public.has_privilege('memberships_manage'));

create policy "read own memberships or all with memberships_manage" on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_privilege('memberships_manage'));
revoke insert, update, delete on public.memberships from anon, authenticated;
revoke insert, update, delete on public.membership_tiers, public.tier_location_benefits from anon;

-- Customers must not be able to set their own Stripe customer id.
revoke update on public.profiles from authenticated;
grant update (username, display_name) on public.profiles to authenticated;

revoke execute on function public.member_benefits(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.price_booking(uuid, uuid, uuid[], jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.upsert_membership_from_stripe(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.handle_new_location_benefits() from public, anon, authenticated;
revoke execute on function public.handle_new_tier() from public, anon, authenticated;
revoke execute on function public.quote_booking(uuid, uuid[], jsonb) from public, anon;
revoke execute on function public.my_booking_terms(uuid) from public, anon;
revoke execute on function public.confirm_free_checkout(uuid) from public, anon;
revoke execute on function public.my_membership() from public, anon;
revoke execute on function public.admin_list_members() from public, anon;

grant execute on function public.list_membership_tiers() to anon, authenticated;
grant execute on function public.quote_booking(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.my_booking_terms(uuid) to authenticated;
grant execute on function public.confirm_free_checkout(uuid) to authenticated;
grant execute on function public.my_membership() to authenticated;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.upsert_membership_from_stripe(uuid, uuid, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.member_benefits(uuid, uuid) to service_role;
grant execute on function public.price_booking(uuid, uuid, uuid[], jsonb, uuid) to service_role;
