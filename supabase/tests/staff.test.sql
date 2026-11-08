-- Front desk: walk-ins, blocks, attendance, moves and swaps, staff reschedule
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.staff_day(tap.id('loc'), current_date)$$, 'permission', 'customers can''t see the schedule');

select tap.as_admin();
insert into public.locations (slug, name, timezone) values ('loc-2', 'Loc 2', 'America/Chicago');
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.throws($$select public.staff_day((select id from public.locations where slug = 'loc-2'), current_date)$$, 'permission',
                  'location manager only sees their own location');
select tap.is(jsonb_array_length(public.staff_locations()), 1, 'staff_locations lists only Location 1');

-- Walk-ins
select tap.set('w1', public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 120),
        null, 'Gary Guest', '555-0100', null, 'cash') -> 'bookings' -> 0 ->> 'booking_id');
select tap.is((select total_cents from public.bookings where id = tap.get('w1')::uuid), 10000, 'guest walk-in at list price');
select tap.set('w2', public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage2')], tap.slot(tap.at(2, '17:00'), 60),
        '00000000-0000-0000-0000-0000000000b1', null, null, null, 'comp') -> 'bookings' -> 0 ->> 'booking_id');
select tap.is((select total_cents from public.bookings where id = tap.get('w2')::uuid), 0, 'comp walk-in is free');
select tap.throws($$select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage3')], tap.slot(tap.at(2, '17:00'), 60), null, null, null, null, 'cash')$$,
                  'customer or enter a name', 'walk-in needs a customer');
select tap.throws($$select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage3')], tap.slot(tap.at(2, '17:00'), 60), null, 'X', null, null, null)$$,
                  'how they paid', 'walk-in needs a payment method');
select tap.throws($$select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage1')], tap.slot(tap.at(2, '18:00'), 60), null, 'X', null, null, 'cash')$$,
                  'already booked', 'walk-in can''t overlap');

-- Blocks
select tap.throws($$select public.staff_create_booking(tap.id('loc'), 'block', array[tap.id('turf')], tap.slot(tap.at(2, '17:00'), 60), null, null, null, null, null)$$,
                  'reason', 'blocks need a reason');
select tap.is(jsonb_array_length(public.staff_create_booking(tap.id('loc'), 'block', array[tap.id('turf')],
                 tap.slot(tap.at(2, '18:00'), 60) || tap.slot(tap.at(2, '18:00', 2), 60), null, null, null, 'Team rental', null) -> 'bookings'),
              2, 'weekly block creates one booking per week');
select tap.as_user('00000000-0000-0000-0000-0000000000c1');
select public.accept_waiver(public.active_waiver_id(), 'Cara Catcher');
select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('turf')], tap.slot(tap.at(2, '18:00'), 60))$$,
                  'already booked', 'customers can''t book over a block');

-- Attendance
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select public.staff_set_attendance(tap.get('w1')::uuid, 'checked_in');
select tap.ok((select checked_in_at is not null from public.bookings where id = tap.get('w1')::uuid), 'check in');
select public.staff_set_attendance(tap.get('w1')::uuid, 'no_show');
select tap.ok((select no_show and checked_in_at is null from public.bookings where id = tap.get('w1')::uuid), 'no-show clears check-in');

-- Moves: free cage, swap, and a swap that can't fit (nothing changes).
select public.staff_move_booking(tap.get('w1')::uuid, tap.id('cage1'), tap.id('cage5'));
select tap.is((select resource_id from public.booking_items where booking_id = tap.get('w1')::uuid), tap.id('cage5'), 'moved to a free cage');
select tap.throws($$select public.staff_move_booking(tap.get('w1')::uuid, tap.id('cage5'), tap.id('turf'))$$, 'same kind', 'can''t move a cage booking to turf');
-- Gary: cage5 5-7pm. Bob's comp: cage2 5-6pm. Swap Gary into cage2 → Bob moves to cage5.
select tap.is(jsonb_array_length(public.staff_move_booking(tap.get('w1')::uuid, tap.id('cage5'), tap.id('cage2')) -> 'swapped'), 1, 'swap reports who moved');
select tap.is((select resource_id from public.booking_items where booking_id = tap.get('w2')::uuid), tap.id('cage5'), 'the other booking took the vacated cage');
-- Holly: cage6 5:30-7:30pm; Ivy: cage5 7-8pm. Moving Bob (cage5 5-6) to cage6 would push Holly into cage5, where Ivy is at 7.
select tap.set('h1', public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage6')], tap.slot(tap.at(2, '17:30'), 120), null, 'Holly', null, null, 'cash') -> 'bookings' -> 0 ->> 'booking_id');
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage5')], tap.slot(tap.at(2, '19:00'), 60), null, 'Ivy', null, null, 'cash');
select tap.throws($$select public.staff_move_booking(tap.get('w2')::uuid, tap.id('cage5'), tap.id('cage6'))$$, 'doesn''t fit', 'impossible swap is refused');
select tap.is((select resource_id from public.booking_items where booking_id = tap.get('w2')::uuid and active), tap.id('cage5'), 'nothing moved after a refused swap');

-- Staff reschedule keeps the price and picks a free cage when needed.
select public.staff_reschedule_booking(tap.get('w1')::uuid, tap.at(3, '17:00'), tap.at(3, '18:30'));
select tap.is((select total_cents from public.bookings where id = tap.get('w1')::uuid), 10000, 'staff reschedule keeps the price');
select tap.is((select ends_at - starts_at from public.bookings where id = tap.get('w1')::uuid), interval '90 minutes', 'staff can change the length');

-- Staff cancellation record.
select tap.as_service();
select public.staff_mark_cancelled(tap.get('h1')::uuid, 4000, '00000000-0000-0000-0000-0000000000d1');
select tap.is((select cancelled_by from public.bookings where id = tap.get('h1')::uuid), '00000000-0000-0000-0000-0000000000d1'::uuid, 'records who cancelled');

-- My bookings shows the walk-in with its kind, the cage id and the address field.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is((select e ->> 'kind' from jsonb_array_elements(public.my_bookings()) e where e ->> 'id' = tap.get('w2')), 'walk_in', 'my_bookings includes the kind');
select tap.is((select (e -> 'items' -> 0 ->> 'resource_id')::uuid from jsonb_array_elements(public.my_bookings()) e where e ->> 'id' = tap.get('w2')),
              tap.id('cage5'), 'my_bookings includes resource ids');
select tap.ok((select (e -> 'location') ? 'address' from jsonb_array_elements(public.my_bookings()) e where e ->> 'id' = tap.get('w2')), 'my_bookings includes the address');

-- All bookings: staff see every booking at their locations, filtered and per customer.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.admin_bookings()$$, 'permission', 'customers can''t list all bookings');
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.ok((public.admin_bookings() ->> 'total')::int >= 2, 'the manager sees upcoming bookings at their location');
select tap.is((public.admin_bookings(p_user => '00000000-0000-0000-0000-0000000000b1') -> 'user' ->> 'username'), 'bob', 'by customer: their profile comes back');
select tap.ok((select bool_and(e -> 'customer' ->> 'id' = '00000000-0000-0000-0000-0000000000b1')
                 from jsonb_array_elements(public.admin_bookings(p_user => '00000000-0000-0000-0000-0000000000b1') -> 'bookings') e),
              'by customer: only their bookings');
select tap.is((public.admin_bookings(p_search => 'bob') -> 'bookings' -> 0 -> 'customer' ->> 'username'), 'bob', 'search finds a customer by name');
select tap.ok((select bool_and(e ->> 'kind' = 'block') from jsonb_array_elements(public.admin_bookings(p_kind => 'block') -> 'bookings') e),
              'filter by type');
select tap.throws($$select public.admin_bookings(p_status => 'nope')$$, 'Unknown status', 'bad status filter is rejected');
