-- Browser-test fixtures.
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
