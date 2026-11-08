-- Staff tools round 2: mark paid, activity log, closure impact, emailing a day's customers, dashboard, user flags
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.set('g', public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60),
        null, 'Gary Guest', '555-0100', null, 'cash') -> 'bookings' -> 0 ->> 'booking_id');
select tap.set('c', public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage2')], tap.slot(tap.at(2, '17:00'), 60),
        '00000000-0000-0000-0000-0000000000b1', null, null, null, 'comp') -> 'bookings' -> 0 ->> 'booking_id');

-- Mark paid
select public.staff_mark_paid(tap.get('g')::uuid, true, 'card');
select tap.ok((select paid_at is not null and payment_method = 'card' from public.bookings where id = tap.get('g')::uuid), 'walk-in marked paid by card');
select tap.throws($$select public.staff_mark_paid(tap.get('c')::uuid, true)$$, 'something to collect', 'comp walk-ins have nothing to collect');
select tap.is((select (e ->> 'paid_at') is not null from jsonb_array_elements(public.staff_day(tap.id('loc'), (tap.at(2, '17:00') at time zone 'America/Chicago')::date) -> 'bookings') e
                where e ->> 'id' = tap.get('g')), true, 'the day shows it paid');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.staff_mark_paid(tap.get('g')::uuid, false)$$, 'not found', 'customers can''t mark payments');

-- Activity log
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select public.staff_set_attendance(tap.get('g')::uuid, 'checked_in');
select public.staff_move_booking(tap.get('g')::uuid, tap.id('cage1'), tap.id('cage5'));
select tap.is((select array_agg(e ->> 'action' order by ord) from jsonb_array_elements(public.booking_history(tap.get('g')::uuid)) with ordinality x(e, ord)),
              array['created', 'paid', 'checked_in', 'moved'], 'history records each step');
select tap.is((select e ->> 'actor' from jsonb_array_elements(public.booking_history(tap.get('g')::uuid)) e where e ->> 'action' = 'moved'),
              'Dana Desk', 'and who did it');
select tap.is((select e -> 'details' ->> 'to' from jsonb_array_elements(public.booking_history(tap.get('g')::uuid)) e where e ->> 'action' = 'moved'),
              'Cage 5', 'moves record the new cage');
select tap.ok((public.admin_activity() ->> 'total')::int >= 4, 'activity page lists staff actions');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is(jsonb_array_length(public.booking_history(tap.get('g')::uuid)), 0, 'customers see no staff history');
select tap.throws($$select public.admin_activity()$$, 'permission', 'customers can''t open the activity log');

-- Closure impact (needs locations_manage: super admin)
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.is(jsonb_array_length(public.closure_impact(tap.id('loc'), array[(tap.at(2, '17:00') at time zone 'America/Chicago')::date], true)), 2,
              'closing the whole day affects both bookings');
select tap.is(jsonb_array_length(public.closure_impact(tap.id('loc'), array[(tap.at(2, '17:00') at time zone 'America/Chicago')::date], false, '15:00', '19:00')), 0,
              'shorter hours that still cover them affect none');
select tap.is(jsonb_array_length(public.closure_impact(tap.id('loc'), array[(tap.at(2, '17:00') at time zone 'America/Chicago')::date], false, '15:00', '17:30')), 2,
              'closing at 5:30 affects the 5–6 PM bookings');
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.throws($$select public.closure_impact(tap.id('loc'), array[current_date], true)$$, 'permission', 'front desk can''t manage closures');

-- Email a day's customers (Bob has the comp booking; the guest has no account)
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.is(public.queue_customer_notice(tap.id('loc'), (tap.at(2, '17:00') at time zone 'America/Chicago')::date, '', '', true), 1, 'preview counts customers with accounts');
select tap.is(public.queue_customer_notice(tap.id('loc'), (tap.at(2, '17:00') at time zone 'America/Chicago')::date, 'Closed early', 'Storm coming.'), 1, 'queues one email');
select tap.as_admin();
select tap.is((select payload ->> 'subject' from public.email_outbox where kind = 'notice'), 'Closed early', 'with the subject');
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.throws($$select public.queue_customer_notice(tap.id('loc'), current_date, ' ', 'x')$$, 'subject and a message', 'needs a subject');

-- Dashboard and user flags
select tap.ok(public.admin_dashboard() ? 'attention', 'dashboard loads for the owner');
select tap.ok((select bool_or((e ->> 'waiver_signed')::boolean) from jsonb_array_elements(public.admin_user_flags()) e), 'user flags include waivers');
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.throws($$select public.admin_dashboard()$$, 'permission', 'front desk can''t open the owner dashboard');
select tap.throws($$select public.admin_user_flags()$$, 'permission', 'front desk can''t list user flags');

-- Phone on profiles: your own only
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
update public.profiles set phone = '555-0199' where id = '00000000-0000-0000-0000-0000000000b1';
select tap.is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), '555-0199', 'customers can set their phone');
