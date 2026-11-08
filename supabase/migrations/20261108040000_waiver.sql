-- =====================================================================
-- Liability waiver
-- =====================================================================
-- * waivers: versioned text; exactly one version is active. Editing creates
--   a new version, and everyone signs the new one before their next booking.
-- * waiver_acceptances: who signed which version, their typed name, minors
--   they signed for, and where (sign up, in the app, or at the desk).
-- * Online bookings require a signed copy of the active waiver (trigger on
--   bookings). Staff see "No waiver" on the front desk and can record a
--   paper waiver.
-- =====================================================================

insert into public.privileges (code, description) values
  ('waiver_manage', 'Edit the liability waiver and see who has signed');

create table public.waivers (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique,
  title      text not null check (length(trim(title)) between 1 and 120),
  body       text not null check (length(body) between 50 and 20000),
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create unique index waivers_one_active on public.waivers ((true)) where is_active;

create table public.waiver_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  waiver_id    uuid not null references public.waivers (id),
  signer_name  text not null check (length(trim(signer_name)) between 2 and 100),
  participants text check (participants is null or length(participants) <= 300),
  source       text not null check (source in ('signup', 'app', 'desk')),
  recorded_by  uuid references public.profiles (id) on delete set null,
  accepted_at  timestamptz not null default now(),
  unique (user_id, waiver_id)
);
create index waiver_acceptances_user_idx on public.waiver_acceptances (user_id);

insert into public.waivers (version, title, body, is_active) values
  (1, 'Release of Liability and Assumption of Risk', 'By creating an account, booking, or using The Yard''s facilities, equipment or services, I agree to the following.

1. Assumption of risk. I understand that baseball and softball training involves inherent risks, including being struck by batted, thrown or machine-pitched balls, bats or other equipment; collisions; slips, trips and falls; and muscle, joint and other injuries, some of which may be serious. I knowingly and voluntarily accept these risks.

2. Rules and safe use. I will follow posted rules and staff instructions, use protective equipment such as a batting helmet when appropriate, stay inside my reserved area, use pitching machines and other equipment only as directed, and stop using any area or equipment that appears unsafe and tell staff.

3. Release. To the fullest extent permitted by law, I release The Yard, its owners, employees and agents from any claims for injury, illness, death, or loss of or damage to property arising from my use of the facility, except where caused by their gross negligence or willful misconduct.

4. Indemnity. I agree to cover any claims, costs or damages that result from my own actions or from my breaking these rules.

5. Medical care. I am physically able to take part. If I am injured, I authorize staff to arrange emergency medical care, and I am responsible for any resulting costs.

6. Minors. If I am signing for a participant under 18, I confirm that I am their parent or legal guardian and agree to these terms on their behalf and my own.

7. General. This agreement applies to every visit until I sign an updated version. If any part is found unenforceable, the rest still applies.

I have read this waiver, understand it, and sign it voluntarily.', true);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.active_waiver_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$ select id from public.waivers where is_active $$;

-- True when there's no active waiver, or the user signed it.
create or replace function public.has_signed_waiver(p_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.active_waiver_id() is null
      or exists (select 1 from public.waiver_acceptances
                  where user_id = p_user and waiver_id = public.active_waiver_id());
$$;

-- Public: the waiver people sign.
create or replace function public.current_waiver()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('id', id, 'version', version, 'title', title, 'body', body)
    from public.waivers where is_active;
$$;

create or replace function public.my_waiver_status()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'required', public.active_waiver_id() is not null,
    'signed', public.has_signed_waiver(auth.uid()),
    'current', (select jsonb_build_object('accepted_at', a.accepted_at, 'signer_name', a.signer_name,
                                          'participants', a.participants, 'version', w.version)
                  from public.waiver_acceptances a join public.waivers w on w.id = a.waiver_id
                 where a.user_id = auth.uid() and w.is_active),
    'last_signed_at', (select max(accepted_at) from public.waiver_acceptances where user_id = auth.uid()));
$$;

create or replace function public.accept_waiver(p_waiver uuid, p_signer_name text, p_participants text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_signer_name, ''));
  v_part text := nullif(trim(coalesce(p_participants, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  if p_waiver is distinct from public.active_waiver_id() then
    raise exception 'The waiver was just updated. Please review the new version.' using errcode = '22023';
  end if;
  if length(v_name) < 2 then
    raise exception 'Type your full name to sign.' using errcode = '22023';
  end if;
  insert into public.waiver_acceptances (user_id, waiver_id, signer_name, participants, source)
  values (auth.uid(), p_waiver, left(v_name, 100), left(v_part, 300), 'app')
  on conflict (user_id, waiver_id) do nothing;
end;
$$;

-- Signed during sign up: the sign-up form passes the waiver in user metadata.
create or replace function public.handle_new_user_waiver()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_waiver uuid;
  v_name   text := trim(coalesce(new.raw_user_meta_data ->> 'waiver_signer', ''));
begin
  begin
    v_waiver := (new.raw_user_meta_data ->> 'waiver_id')::uuid;
  exception when others then
    v_waiver := null;
  end;
  if v_waiver is not null and v_waiver = public.active_waiver_id() and length(v_name) >= 2 then
    insert into public.waiver_acceptances (user_id, waiver_id, signer_name, participants, source)
    values (new.id, v_waiver, left(v_name, 100),
            left(nullif(trim(coalesce(new.raw_user_meta_data ->> 'waiver_participants', '')), ''), 300), 'signup')
    on conflict (user_id, waiver_id) do nothing;
  end if;
  return new;
end;
$$;

-- Runs after on_auth_user_created (triggers fire in name order), so the profile exists.
create trigger on_auth_user_created_waiver
  after insert on auth.users
  for each row execute function public.handle_new_user_waiver();

-- Online bookings need a signed waiver.
create or replace function public.require_waiver_for_booking()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.kind = 'online' and new.user_id is not null and not public.has_signed_waiver(new.user_id) then
    raise exception 'Please sign the waiver before booking.' using errcode = '22023', hint = 'waiver_required';
  end if;
  return new;
end;
$$;

create trigger bookings_require_waiver
  before insert on public.bookings
  for each row execute function public.require_waiver_for_booking();

-- ---------------------------------------------------------------------
-- Staff and admin
-- ---------------------------------------------------------------------

-- A customer signed a paper waiver at the desk.
create or replace function public.staff_record_waiver(p_user uuid, p_signer_name text, p_participants text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_signer_name, ''));
begin
  if not exists (select 1 from public.locations l where public.has_privilege('bookings_manage', l.id)) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if public.active_waiver_id() is null then
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;
  if length(v_name) < 2 then
    raise exception 'Enter the name of the person who signed.' using errcode = '22023';
  end if;
  insert into public.waiver_acceptances (user_id, waiver_id, signer_name, participants, source, recorded_by)
  values (p_user, public.active_waiver_id(), left(v_name, 100),
          left(nullif(trim(coalesce(p_participants, '')), ''), 300), 'desk', auth.uid())
  on conflict (user_id, waiver_id) do nothing;
end;
$$;

-- Versions with signature counts, and the latest signatures.
create or replace function public.admin_waiver_overview()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_privilege('waiver_manage') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'version', w.version, 'title', w.title, 'body', w.body, 'is_active', w.is_active,
               'created_at', w.created_at,
               'created_by', (select display_name from public.profiles where id = w.created_by),
               'signatures', (select count(*) from public.waiver_acceptances a where a.waiver_id = w.id))
             order by w.version desc)
        from public.waivers w), '[]'::jsonb),
    'accounts', (select count(*) from public.profiles),
    'recent', coalesce((
      select jsonb_agg(x order by (x ->> 'accepted_at') desc)
        from (select jsonb_build_object(
                       'accepted_at', a.accepted_at, 'signer_name', a.signer_name, 'participants', a.participants,
                       'source', a.source, 'version', w.version,
                       'username', p.username, 'display_name', p.display_name) as x
                from public.waiver_acceptances a
                join public.waivers w on w.id = a.waiver_id
                join public.profiles p on p.id = a.user_id
               order by a.accepted_at desc
               limit 25) s), '[]'::jsonb));
end;
$$;

-- Publishes a new version; everyone signs it before their next booking.
create or replace function public.admin_publish_waiver(p_title text, p_body text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not public.has_privilege('waiver_manage') then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 or length(coalesce(p_body, '')) < 50 then
    raise exception 'Add a title and the full waiver text (at least 50 characters).' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('the-yard:waiver'));
  select coalesce(max(version), 0) + 1 into v_version from public.waivers;
  update public.waivers set is_active = false where is_active;
  insert into public.waivers (version, title, body, is_active, created_by)
  values (v_version, trim(p_title), p_body, true, auth.uid());
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------
-- Front desk: show whether customers have signed
-- ---------------------------------------------------------------------
create or replace function public.staff_find_customers(p_location uuid, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if not public.has_privilege('bookings_manage', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if length(q) < 2 then
    return '[]'::jsonb;
  end if;
  q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(x order by x ->> 'display_name')
      from (select jsonb_build_object(
                     'id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', p.email,
                     'member_tier', (select mb.tier_name from public.member_benefits(p.id, p_location) mb),
                     'waiver_ok', public.has_signed_waiver(p.id)) as x
              from public.profiles p
             where p.username::text ilike q or p.display_name ilike q or p.email ilike q
             order by p.display_name
             limit 8) s), '[]'::jsonb);
end;
$$;

create or replace function public.staff_day(p_location uuid, p_date date, p_include_cancelled boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tz      text;
  w         record;
  v_from    timestamptz;
  v_to      timestamptz;
begin
  if not public.has_privilege('bookings_view_all', p_location) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  select timezone into v_tz from public.locations where id = p_location;
  if v_tz is null then
    raise exception 'Location not found.' using errcode = 'P0002';
  end if;

  perform public.expire_stale_holds();

  select * into w from public.location_day_window(p_location, p_date);
  v_from := p_date::timestamp at time zone v_tz;
  v_to   := (p_date + 1)::timestamp at time zone v_tz;

  return jsonb_build_object(
    'location_id', p_location,
    'date', p_date,
    'timezone', v_tz,
    'opens_at', w.opens_at,
    'closes_at', w.closes_at,
    'closed_reason', w.closed_reason,
    'can_manage', public.has_privilege('bookings_manage', p_location),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type) order by r.sort_order, r.name)
        from public.resources r where r.location_id = p_location and r.is_active), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id,
               'kind', b.kind,
               'status', b.status,
               'starts_at', b.starts_at,
               'ends_at', b.ends_at,
               'total_cents', b.total_cents,
               'discount_cents', b.discount_cents,
               'refund_cents', b.refund_cents,
               'payment_method', b.payment_method,
               'paid_online', b.stripe_payment_intent_id is not null,
               'checked_in_at', b.checked_in_at,
               'no_show', b.no_show,
               'note', b.note,
               'guest_name', b.guest_name,
               'guest_phone', b.guest_phone,
               'created_at', b.created_at,
               'hold_expires_at', b.hold_expires_at,
               'customer', case when p.id is null then null else jsonb_build_object(
                 'id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', p.email,
                 'waiver_ok', public.has_signed_waiver(p.id)) end,
               'member_tier', (select t.name from public.memberships m
                                 join public.membership_tiers t on t.id = m.tier_id
                                where m.id = b.membership_id),
               'created_by', (select cb.display_name from public.profiles cb where cb.id = b.created_by),
               'included_minutes', (select coalesce(sum(bi.included_minutes), 0)
                                      from public.booking_items bi where bi.booking_id = b.id),
               'resource_ids', (select jsonb_agg(bi.resource_id order by r.sort_order, r.name)
                                  from public.booking_items bi join public.resources r on r.id = bi.resource_id
                                 where bi.booking_id = b.id))
             order by b.starts_at, b.created_at)
        from public.bookings b
        left join public.profiles p on p.id = b.user_id
       where b.location_id = p_location
         and b.starts_at < v_to and b.ends_at > v_from
         and (b.status in ('pending', 'confirmed') or (p_include_cancelled and b.status = 'cancelled'))
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- RLS & grants
-- ---------------------------------------------------------------------
alter table public.waivers            enable row level security;
alter table public.waiver_acceptances enable row level security;
create policy "read active waiver" on public.waivers for select using (is_active or public.has_privilege('waiver_manage'));
create policy "read own acceptances" on public.waiver_acceptances for select to authenticated
  using (user_id = auth.uid() or public.has_privilege('waiver_manage'));
revoke insert, update, delete on public.waivers, public.waiver_acceptances from anon, authenticated;

revoke execute on function public.active_waiver_id() from public;
revoke execute on function public.has_signed_waiver(uuid) from public, anon;
revoke execute on function public.handle_new_user_waiver() from public, anon, authenticated;
revoke execute on function public.require_waiver_for_booking() from public, anon, authenticated;
revoke execute on function public.my_waiver_status() from public, anon;
revoke execute on function public.accept_waiver(uuid, text, text) from public, anon;
revoke execute on function public.staff_record_waiver(uuid, text, text) from public, anon;
revoke execute on function public.admin_waiver_overview() from public, anon;
revoke execute on function public.admin_publish_waiver(text, text) from public, anon;

grant execute on function public.active_waiver_id() to anon, authenticated, service_role;
grant execute on function public.has_signed_waiver(uuid) to authenticated, service_role;
grant execute on function public.current_waiver() to anon, authenticated;
grant execute on function public.my_waiver_status() to authenticated;
grant execute on function public.accept_waiver(uuid, text, text) to authenticated;
grant execute on function public.staff_record_waiver(uuid, text, text) to authenticated;
grant execute on function public.admin_waiver_overview() to authenticated;
grant execute on function public.admin_publish_waiver(text, text) to authenticated;
