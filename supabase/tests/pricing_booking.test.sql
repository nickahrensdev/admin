-- Prices, validation and overlap protection for online bookings
select tap.as_user('00000000-0000-0000-0000-0000000000b1');

-- Defaults: cage $20 / $25 peak per 30 min; turf $45 / $55; peak 2-8pm.
select tap.is((public.quote_booking(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60)) ->> 'total_cents')::int,
              5000, '1 hr cage at peak = $50');
select tap.is((public.quote_booking(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '20:00'), 60)) ->> 'total_cents')::int,
              4000, '1 hr cage off-peak = $40');
select tap.is((public.quote_booking(tap.id('loc'), array[tap.id('turf')], tap.slot(tap.at(2, '19:30'), 60)) ->> 'total_cents')::int,
              5500 + 4500, 'turf across the peak boundary is priced per half hour');

select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:15'), 60))$$,
                  'hour or half hour', 'times must be on the half hour');
select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '09:00'), 60))$$,
                  'outside opening hours', 'weekday mornings are closed');
select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '15:00'), 300))$$,
                  'up to 4 hours', 'max 4 hours');
select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00', 6), 60))$$,
                  '30 days ahead', 'non-members book up to 30 days ahead');

-- Hold, then someone else can't take the same cage; overlapping holds conflict.
select tap.lives($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60))$$, 'hold created');
select tap.is((select status::text from public.bookings where user_id = auth.uid() order by created_at desc limit 1), 'pending', 'new booking is a pending hold');
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.throws($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:30'), 60))$$,
                  'already booked', 'overlapping booking on the same cage is refused');
select tap.lives($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage2')], tap.slot(tap.at(2, '17:30'), 60))$$,
                 'another cage at the same time is fine');

-- One unpaid checkout per customer: a new hold releases the old one.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select public.create_booking_holds(tap.id('loc'), array[tap.id('cage3')], tap.slot(tap.at(3, '17:00'), 60));
select tap.is((select count(*)::int from public.bookings where user_id = auth.uid() and status = 'pending'), 1, 'only the latest hold stays pending');

-- Availability hides held cages from everyone.
select tap.as_user(null);
select tap.ok(not ((select s -> 'free' from jsonb_array_elements(public.get_availability(tap.id('loc'), (tap.at(3, '17:00') at time zone 'America/Chicago')::date) -> 'slots') s
                    where s ->> 'time' = '17:00') ? tap.id('cage3')::text), 'held cage shows as taken');

-- Multi-date checkout groups confirm together.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.set('group', public.create_booking_holds(tap.id('loc'), array[tap.id('cage4')],
          tap.slot(tap.at(4, '17:00'), 60) || tap.slot(tap.at(4, '17:00', 2), 60)) ->> 'group_id');
select tap.as_service();
select public.confirm_checkout_group(tap.get('group')::uuid, 'cs_test', 'pi_test');
select tap.is((select count(*)::int from public.bookings where checkout_group = tap.get('group')::uuid and status = 'confirmed'), 2,
              'both dates confirmed by one payment');
