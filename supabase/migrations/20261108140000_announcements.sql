-- =====================================================================
-- Announcements on the Home screen
-- =====================================================================
-- * Company-wide (location_id null) or for one location.
-- * Shown from starts_at; hidden after expires_at (if set); users can dismiss
--   them when dismissible. Either, both or neither.
-- * Who sees a location's messages: anyone with a booking there in the last
--   year or upcoming, a membership that covers it, or a staff role there.
--   While there's only one location, everyone sees its messages.
-- =====================================================================

insert into public.privileges (code, description) values
  ('announcements_manage', 'Post messages on customers'' Home screens');
insert into public.role_privileges (role_code, privilege_code) values ('ADMIN', 'announcements_manage');

create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) between 1 and 120),
  body        text not null default '' check (length(body) <= 2000),
  location_id uuid references public.locations (id) on delete cascade,
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz,
  dismissible boolean not null default true,
  archived    boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);

create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;
create policy "announcements: admins read" on public.announcements for select to authenticated
  using (public.has_privilege('announcements_manage'));
create policy "announcements: admins write" on public.announcements for all to authenticated
  using (public.has_privilege('announcements_manage')) with check (public.has_privilege('announcements_manage'));
revoke all on public.announcements, public.announcement_dismissals from anon;
grant select, insert, update, delete on public.announcements to authenticated;

create or replace function public.announcements_stamp()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.announcements_stamp() from public, anon, authenticated;
create trigger announcements_stamp before insert or update on public.announcements
  for each row execute function public.announcements_stamp();

-- Is a location relevant to this user?
create or replace function public.user_location_relevant(p_user uuid, p_location uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select count(*) from public.locations where is_active) <= 1
      or exists (select 1 from public.bookings b
                  where b.user_id = p_user and b.location_id = p_location
                    and b.status in ('confirmed', 'pending')
                    and b.ends_at > now() - interval '1 year')
      or exists (select 1 from public.memberships m join public.membership_tiers t on t.id = m.tier_id
                  where m.user_id = p_user and m.status in ('active', 'past_due')
                    and (t.scope = 'all' or t.location_id = p_location))
      or exists (select 1 from public.user_roles ur
                  where ur.user_id = p_user and (ur.location_id = p_location or
                        (ur.location_id is null and ur.role_code in ('SUPER_ADMIN', 'LOCATION_MANAGER'))));
$$;
revoke execute on function public.user_location_relevant(uuid, uuid) from public, anon, authenticated;

-- Messages for the signed-in user's Home screen, newest first.
create or replace function public.my_announcements()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'body', a.body, 'starts_at', a.starts_at, 'expires_at', a.expires_at,
           'dismissible', a.dismissible,
           'location_name', (select name from public.locations where id = a.location_id))
         order by a.starts_at desc), '[]'::jsonb)
    from public.announcements a
   where not a.archived
     and a.starts_at <= now()
     and (a.expires_at is null or a.expires_at > now())
     and not exists (select 1 from public.announcement_dismissals d where d.announcement_id = a.id and d.user_id = auth.uid())
     and (a.location_id is null or public.user_location_relevant(auth.uid(), a.location_id));
$$;

create or replace function public.dismiss_announcement(p_announcement uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.announcements where id = p_announcement and dismissible) then
    raise exception 'This message can''t be dismissed.' using errcode = '22023';
  end if;
  insert into public.announcement_dismissals (announcement_id, user_id) values (p_announcement, auth.uid())
  on conflict do nothing;
end;
$$;

-- Admin list with dismissal counts.
create or replace function public.admin_announcements()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('announcements_manage') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'title', a.title, 'body', a.body, 'location_id', a.location_id,
             'location_name', (select name from public.locations where id = a.location_id),
             'starts_at', a.starts_at, 'expires_at', a.expires_at, 'dismissible', a.dismissible,
             'archived', a.archived, 'created_at', a.created_at,
             'created_by', (select display_name from public.profiles where id = a.created_by),
             'dismissals', (select count(*) from public.announcement_dismissals d where d.announcement_id = a.id))
           order by a.starts_at desc)
      from public.announcements a), '[]'::jsonb);
end;
$$;

revoke execute on function public.my_announcements() from public, anon;
revoke execute on function public.dismiss_announcement(uuid) from public, anon;
revoke execute on function public.admin_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;
grant execute on function public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.admin_announcements() to authenticated;

update public.roles set description = 'Can view all users, assign their roles, and post Home screen messages.' where code = 'ADMIN';
