-- Liability waiver
select tap.as_user('00000000-0000-0000-0000-0000000000c1');
select tap.is((public.my_waiver_status() ->> 'signed')::boolean, false, 'Cara has not signed');
select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60))$$,
                  'sign the waiver', 'online booking needs a signed waiver');
select tap.throws($$select public.accept_waiver(gen_random_uuid(), 'Cara C')$$, 'updated', 'must sign the current version');
select tap.throws($$select public.accept_waiver(public.active_waiver_id(), 'C')$$, 'full name', 'needs a real name');
select tap.lives($$select public.accept_waiver(public.active_waiver_id(), 'Cara Catcher', 'Kid (10)')$$, 'signs the waiver');
select tap.lives($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60))$$,
                 'can book after signing');

-- Sign-up path: waiver in user metadata is recorded by the trigger.
select tap.as_admin();
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e1', 'eve@test.local',
  jsonb_build_object('username', 'eve', 'waiver_id', public.active_waiver_id(), 'waiver_signer', 'Eve E'));
select tap.is((select source from public.waiver_acceptances where user_id = '00000000-0000-0000-0000-0000000000e1'), 'signup',
              'waiver signed at sign up is recorded');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e2', 'fay@test.local',
  '{"username":"fay","waiver_id":"not-a-uuid","waiver_signer":"Fay"}');
select tap.ok(exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000e2'), 'bad waiver metadata doesn''t block sign up');

-- A new version means everyone signs again; desk can record paper waivers.
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.lives($$select public.admin_publish_waiver('Release v2', repeat('Updated terms. ', 10))$$, 'admin publishes a new version');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is((public.my_waiver_status() ->> 'signed')::boolean, false, 'Bob must sign the new version');
select tap.throws($$select public.admin_publish_waiver('x', repeat('y', 60))$$, 'permission', 'customers can''t edit the waiver');
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.lives($$select public.staff_record_waiver('00000000-0000-0000-0000-0000000000b1', 'Bob (paper)')$$, 'front desk records a paper waiver');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is((public.my_waiver_status() ->> 'signed')::boolean, true, 'paper waiver counts');
