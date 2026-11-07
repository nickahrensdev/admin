-- =====================================================================
-- Phase 1: profiles, roles & privileges, locations & resources
-- =====================================================================
-- Access model
--   * A user has one or more roles (user_roles). A role assignment is either
--     global (location_id is null) or scoped to one location.
--   * A role grants one or more privileges (role_privileges).
--   * SUPER_ADMIN passes every privilege check.
--   * Every check runs in the database (RLS + security definer functions);
--     the front end only uses the same rules to decide what to show.
-- =====================================================================

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------
-- Roles and privileges (reference data)
-- ---------------------------------------------------------------------
create table public.privileges (
  code        text primary key,
  description text not null default ''
);

create table public.roles (
  code        text primary key,
  description text not null default '',
  sort_order  int  not null default 0
);

create table public.role_privileges (
  role_code      text not null references public.roles (code) on delete cascade,
  privilege_code text not null references public.privileges (code) on delete cascade,
  primary key (role_code, privilege_code)
);

insert into public.privileges (code, description) values
  ('home_view',          'Open the home page'),
  ('profile_view',       'View own profile'),
  ('profile_edit',       'Edit own profile'),
  ('users_view',         'View all users and their roles'),
  ('users_manage_roles', 'Assign roles to users'),
  ('locations_manage',   'Create and edit locations and their resources');

insert into public.roles (code, description, sort_order) values
  ('APP_USER',    'Default role given to every user at sign up.', 10),
  ('ADMIN',       'Can view all users and assign their roles.', 20),
  ('SUPER_ADMIN', 'Full access to every page and feature, including ones added later. Only a super admin can grant or remove this role.', 30);

insert into public.role_privileges (role_code, privilege_code) values
  ('APP_USER', 'home_view'),
  ('APP_USER', 'profile_view'),
  ('APP_USER', 'profile_edit'),
  ('ADMIN',    'users_view'),
  ('ADMIN',    'users_manage_roles');
-- SUPER_ADMIN needs no rows: it passes every check (see has_privilege).

-- ---------------------------------------------------------------------
-- Locations and bookable resources
-- ---------------------------------------------------------------------
create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null check (length(trim(name)) > 0),
  timezone   text not null default 'America/Chicago',
  address    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create type public.resource_type as enum ('batting_cage', 'turf');

create table public.resources (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  type        public.resource_type not null,
  name        text not null check (length(trim(name)) > 0),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (location_id, name)
);
create index resources_location_idx on public.resources (location_id);

-- ---------------------------------------------------------------------
-- Profiles (one per auth user) and role assignments
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     extensions.citext not null unique
               check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  email        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_code   text not null references public.roles (code),
  location_id uuid references public.locations (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique nulls not distinct (user_id, role_code, location_id)
);
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------

-- True if the signed-in user has the privilege. A location-scoped role
-- only counts when p_location matches its location.
create or replace function public.has_privilege(p_privilege text, p_location uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and (ur.location_id is null or ur.location_id = p_location)
      and (
        ur.role_code = 'SUPER_ADMIN'
        or exists (
          select 1 from public.role_privileges rp
          where rp.role_code = ur.role_code and rp.privilege_code = p_privilege
        )
      )
  );
$$;

create or replace function public.is_super_admin(p_user uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user and role_code = 'SUPER_ADMIN' and location_id is null
  );
$$;

-- Everything the front end needs about the signed-in user in one call.
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
      end, '[]'::jsonb)
  );
$$;

-- Lets the sign-up form check a username before creating the account.
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles where lower(username::text) = lower(trim(p_username))
  );
$$;

-- ---------------------------------------------------------------------
-- New users: create profile, give APP_USER, bootstrap the first super admin
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_username text := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_display  text := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if v_username = '' then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;
  if v_display = '' then
    v_display := v_username;
  end if;

  insert into public.profiles (id, username, display_name, email)
  values (new.id, v_username, v_display, coalesce(new.email, ''));

  insert into public.user_roles (user_id, role_code) values (new.id, 'APP_USER');

  -- The very first account becomes super admin so someone can manage roles.
  perform pg_advisory_xact_lock(hashtext('the-yard:super-admin'));
  if not exists (select 1 from public.user_roles where role_code = 'SUPER_ADMIN') then
    insert into public.user_roles (user_id, role_code) values (new.id, 'SUPER_ADMIN');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step with the confirmed auth email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Admin: list users, set roles
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (id uuid, username text, display_name text, email text, roles text[], created_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('users_view') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;

  return query
    select p.id, p.username::text, p.display_name, p.email,
           coalesce(array_agg(ur.role_code order by r.sort_order)
                    filter (where ur.role_code is not null), '{}'),
           p.created_at
      from public.profiles p
      left join public.user_roles ur on ur.user_id = p.id and ur.location_id is null
      left join public.roles r on r.code = ur.role_code
     group by p.id
     order by p.created_at;
end;
$$;

-- Replaces a user's global roles. Location-scoped roles are left alone.
create or replace function public.set_user_roles(p_user uuid, p_roles text[])
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_roles     text[];
  v_had_super boolean;
  v_has_super boolean;
begin
  if not public.has_privilege('users_manage_roles') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct r), '{}') into v_roles
    from unnest(coalesce(p_roles, '{}')) as r;

  if cardinality(v_roles) = 0 then
    raise exception 'A user must have at least one role.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_roles) r where r not in (select code from public.roles)) then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext('the-yard:super-admin'));

  v_had_super := public.is_super_admin(p_user);
  v_has_super := 'SUPER_ADMIN' = any (v_roles);

  if v_had_super <> v_has_super and not public.is_super_admin() then
    raise exception 'Only a super admin can grant or remove SUPER_ADMIN.' using errcode = '42501';
  end if;
  if v_had_super and not v_has_super and not exists (
    select 1 from public.user_roles
     where role_code = 'SUPER_ADMIN' and location_id is null and user_id <> p_user
  ) then
    raise exception 'There must always be at least one super admin.' using errcode = '22023';
  end if;

  delete from public.user_roles
   where user_id = p_user and location_id is null and role_code <> all (v_roles);
  insert into public.user_roles (user_id, role_code)
    select p_user, r from unnest(v_roles) r
  on conflict do nothing;

  return v_roles;
end;
$$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.privileges      enable row level security;
alter table public.roles           enable row level security;
alter table public.role_privileges enable row level security;
alter table public.locations       enable row level security;
alter table public.resources       enable row level security;
alter table public.profiles        enable row level security;
alter table public.user_roles      enable row level security;

-- Reference data: readable by everyone, changed only through migrations.
create policy "read privileges"      on public.privileges      for select using (true);
create policy "read roles"           on public.roles           for select using (true);
create policy "read role_privileges" on public.role_privileges for select using (true);

-- Locations & resources: public can see active ones; managers see and edit all.
create policy "read active locations" on public.locations for select
  using (is_active or public.has_privilege('locations_manage', id));
create policy "manage locations insert" on public.locations for insert to authenticated
  with check (public.has_privilege('locations_manage'));
create policy "manage locations update" on public.locations for update to authenticated
  using (public.has_privilege('locations_manage', id))
  with check (public.has_privilege('locations_manage', id));
create policy "manage locations delete" on public.locations for delete to authenticated
  using (public.has_privilege('locations_manage'));

create policy "read active resources" on public.resources for select
  using (
    (is_active and exists (select 1 from public.locations l where l.id = location_id and l.is_active))
    or public.has_privilege('locations_manage', location_id)
  );
create policy "manage resources insert" on public.resources for insert to authenticated
  with check (public.has_privilege('locations_manage', location_id));
create policy "manage resources update" on public.resources for update to authenticated
  using (public.has_privilege('locations_manage', location_id))
  with check (public.has_privilege('locations_manage', location_id));
create policy "manage resources delete" on public.resources for delete to authenticated
  using (public.has_privilege('locations_manage', location_id));

-- Profiles: you see your own; users_view sees everyone. You edit your own
-- username/display name if you have profile_edit (email changes go through auth).
create policy "read own or all with users_view" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_privilege('users_view'));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid() and public.has_privilege('profile_edit'))
  with check (id = auth.uid());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, display_name) on public.profiles to authenticated;

-- Role assignments: readable by the user and by users_view; changed only via set_user_roles().
create policy "read own roles or all with users_view" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_privilege('users_view'));
revoke insert, update, delete on public.user_roles from anon, authenticated;

-- Reference tables are read-only to clients.
revoke insert, update, delete on public.privileges, public.roles, public.role_privileges from anon, authenticated;

-- Function access
revoke execute on function public.handle_new_user()          from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.admin_list_users()         from public, anon;
revoke execute on function public.set_user_roles(uuid, text[]) from public, anon;
revoke execute on function public.my_access()                from public, anon;
grant  execute on function public.admin_list_users()          to authenticated;
grant  execute on function public.set_user_roles(uuid, text[]) to authenticated;
grant  execute on function public.my_access()                 to authenticated;
grant  execute on function public.username_available(text)    to anon, authenticated;
grant  execute on function public.has_privilege(text, uuid)   to anon, authenticated;
grant  execute on function public.is_super_admin(uuid)        to authenticated;

-- ---------------------------------------------------------------------
-- Seed: Location 1 with 8 batting cages and 1 turf area
-- ---------------------------------------------------------------------
with loc as (
  insert into public.locations (slug, name, timezone)
  values ('location-1', 'The Yard — Location 1', 'America/Chicago')
  returning id
)
insert into public.resources (location_id, type, name, sort_order)
select loc.id, 'batting_cage'::public.resource_type, 'Cage ' || n, n from loc, generate_series(1, 8) as n
union all
select loc.id, 'turf'::public.resource_type, 'Turf', 100 from loc;
