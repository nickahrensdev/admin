-- Shared fixtures (after migrations). Fixed ids so tests can refer to them.
--   ...a1  Nick  first account → SUPER_ADMIN
--   ...b1  Bob   customer, signed waiver
--   ...c1  Cara  customer, no waiver
--   ...d1  Dana  LOCATION_MANAGER at Location 1 only
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'nick@test.local', '{"username":"nick","display_name":"Nick Admin"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'bob@test.local',  '{"username":"bob","display_name":"Bob Batter"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'cara@test.local', '{"username":"cara","display_name":"Cara Catcher"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'dana@test.local', '{"username":"dana","display_name":"Dana Desk"}');

insert into public.user_roles (user_id, role_code, location_id)
select '00000000-0000-0000-0000-0000000000d1', 'LOCATION_MANAGER', id from public.locations where slug = 'location-1';

insert into public.waiver_acceptances (user_id, waiver_id, signer_name, source)
select u, public.active_waiver_id(), 'Signed', 'app'
  from unnest(array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
                    '00000000-0000-0000-0000-0000000000d1']::uuid[]) u;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Handy lookups for tests.
create table tap.ids (key text primary key, id uuid);
insert into tap.ids
select 'loc', id from public.locations where slug = 'location-1'
union all select 'cage' || sort_order, id from public.resources where type = 'batting_cage'
union all select 'turf', id from public.resources where type = 'turf'
union all select 'rookie', id from public.membership_tiers where name = 'Rookie'
union all select 'allstar', id from public.membership_tiers where name = 'All-Star';
grant select on tap.ids to anon, authenticated, service_role;
create function tap.id(p_key text) returns uuid language sql stable as $$ select id from tap.ids where key = p_key $$;
