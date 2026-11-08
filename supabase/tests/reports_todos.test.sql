-- Reports and admin to-dos
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60), null, 'A', null, null, 'cash');
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage2')], tap.slot(tap.at(2, '17:00'), 60), null, 'B', null, null, 'card');
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage3')], tap.slot(tap.at(2, '17:00'), 60), null, 'C', null, null, 'comp');
select public.staff_create_booking(tap.id('loc'), 'block', array[tap.id('turf')], tap.slot(tap.at(2, '17:00'), 60), null, null, null, 'Lesson', null);
select tap.throws($$select public.report_summary(current_date, current_date + 30)$$, 'permission', 'reports are super admin only');

select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.set('r', public.report_summary((tap.at(2, '17:00') at time zone 'America/Chicago')::date, (tap.at(2, '17:00') at time zone 'America/Chicago')::date)::text);
select tap.is((tap.get('r')::jsonb -> 'revenue' ->> 'net_cents')::int, 10000, 'net revenue = cash + card');
select tap.is((tap.get('r')::jsonb -> 'bookings' ->> 'confirmed')::int, 3, 'blocks aren''t counted as sessions');
select tap.is((tap.get('r')::jsonb -> 'revenue' ->> 'comp_value_cents')::int, 5000, 'comps reported at list value');
select tap.is((select (u ->> 'blocked_hours')::numeric from jsonb_array_elements(tap.get('r')::jsonb -> 'utilization') u where u ->> 'type' = 'turf'), 1.0,
              'blocked turf time reported');
select tap.throws($$select public.report_summary(current_date, current_date - 1)$$, 'valid date range', 'bad ranges refused');

-- To-dos: super admin only.
select tap.ok((select count(*) from public.admin_todos) >= 1, 'seeded to-do present');
insert into public.admin_todos (title) values ('Test todo');
update public.admin_todos set done = true where title = 'Test todo';
select tap.ok((select done_at is not null and done_by = auth.uid() from public.admin_todos where title = 'Test todo'), 'completion is stamped');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is((select count(*)::int from public.admin_todos), 0, 'customers can''t see to-dos');
