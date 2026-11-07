-- =====================================================================
-- Phase 2: opening hours, closures, pricing and peak hours per location
-- =====================================================================
-- Times are local to the location (locations.timezone) and always fall on
-- :00 or :30, because bookings use 30-minute slots. Prices are stored in
-- cents, per 30 minutes. Weekday numbers: 0 = Sunday … 6 = Saturday.
-- =====================================================================

create or replace function public.is_half_hour(t time)
returns boolean
language sql immutable
set search_path = ''
as $$
  select t is null or (extract(minute from t) in (0, 30) and extract(second from t) = 0);
$$;

-- ---------------------------------------------------------------------
-- Weekly opening hours (one interval per weekday)
-- ---------------------------------------------------------------------
create table public.location_hours (
  location_id uuid not null references public.locations (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  is_closed   boolean not null default false,
  opens_at    time,
  closes_at   time,
  primary key (location_id, weekday),
  check (public.is_half_hour(opens_at) and public.is_half_hour(closes_at)),
  check (is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

-- ---------------------------------------------------------------------
-- One-day closures and special hours (holidays, events)
-- ---------------------------------------------------------------------
create table public.location_closures (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  date        date not null,
  all_day     boolean not null default true,
  -- When all_day is false the location is open only between these times.
  opens_at    time,
  closes_at   time,
  reason      text not null default '' check (length(reason) <= 80),
  created_at  timestamptz not null default now(),
  unique (location_id, date),
  check (public.is_half_hour(opens_at) and public.is_half_hour(closes_at)),
  check (all_day or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);
create index location_closures_date_idx on public.location_closures (location_id, date);

-- ---------------------------------------------------------------------
-- Prices per resource type (per 30 minutes) and peak hours
-- ---------------------------------------------------------------------
create table public.resource_prices (
  location_id   uuid not null references public.locations (id) on delete cascade,
  resource_type public.resource_type not null,
  base_cents    integer not null check (base_cents >= 0 and base_cents <= 100000),
  peak_cents    integer check (peak_cents >= 0 and peak_cents <= 100000),
  primary key (location_id, resource_type)
);

create table public.location_peak_hours (
  location_id uuid not null references public.locations (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  starts_at   time not null,
  ends_at     time not null,
  primary key (location_id, weekday),
  check (public.is_half_hour(starts_at) and public.is_half_hour(ends_at)),
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------
-- Defaults for every location (existing and new)
-- ---------------------------------------------------------------------
create or replace function public.seed_location_defaults(p_location uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Mon–Fri 3pm–10pm, Sat–Sun 8am–8pm
  insert into public.location_hours (location_id, weekday, is_closed, opens_at, closes_at)
  select p_location, d,
         false,
         case when d in (0, 6) then time '08:00' else time '15:00' end,
         case when d in (0, 6) then time '20:00' else time '22:00' end
    from generate_series(0, 6) d
  on conflict do nothing;

  -- Peak 2pm–8pm every day
  insert into public.location_peak_hours (location_id, weekday, starts_at, ends_at)
  select p_location, d, time '14:00', time '20:00' from generate_series(0, 6) d
  on conflict do nothing;

  -- Per 30 minutes: cage $20 ($25 peak), turf $45 ($55 peak)
  insert into public.resource_prices (location_id, resource_type, base_cents, peak_cents) values
    (p_location, 'batting_cage', 2000, 2500),
    (p_location, 'turf',         4500, 5500)
  on conflict do nothing;
end;
$$;

create or replace function public.handle_new_location()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.seed_location_defaults(new.id);
  return new;
end;
$$;

create trigger on_location_created
  after insert on public.locations
  for each row execute function public.handle_new_location();

do $$
declare r record;
begin
  for r in select id from public.locations loop
    perform public.seed_location_defaults(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row level security: anyone can read (customers need hours and prices);
-- only locations_manage for that location can change anything.
-- ---------------------------------------------------------------------
alter table public.location_hours      enable row level security;
alter table public.location_closures   enable row level security;
alter table public.resource_prices     enable row level security;
alter table public.location_peak_hours enable row level security;

create policy "read hours"      on public.location_hours      for select using (true);
create policy "read closures"   on public.location_closures   for select using (true);
create policy "read prices"     on public.resource_prices     for select using (true);
create policy "read peak hours" on public.location_peak_hours for select using (true);

create policy "manage hours" on public.location_hours for all to authenticated
  using (public.has_privilege('locations_manage', location_id))
  with check (public.has_privilege('locations_manage', location_id));
create policy "manage closures" on public.location_closures for all to authenticated
  using (public.has_privilege('locations_manage', location_id))
  with check (public.has_privilege('locations_manage', location_id));
create policy "manage prices" on public.resource_prices for all to authenticated
  using (public.has_privilege('locations_manage', location_id))
  with check (public.has_privilege('locations_manage', location_id));
create policy "manage peak hours" on public.location_peak_hours for all to authenticated
  using (public.has_privilege('locations_manage', location_id))
  with check (public.has_privilege('locations_manage', location_id));

revoke insert, update, delete on public.location_hours, public.location_closures,
  public.resource_prices, public.location_peak_hours from anon;

revoke execute on function public.seed_location_defaults(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_location()        from public, anon, authenticated;
