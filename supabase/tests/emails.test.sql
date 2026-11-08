-- Booking email queue
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.set('g', public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')],
        tap.slot(tap.at(2, '17:00'), 60) || tap.slot(tap.at(2, '17:00', 2), 60)) ->> 'group_id');
select tap.as_admin();
select tap.is((select count(*)::int from public.email_outbox), 0, 'nothing queued for an unpaid hold');

select tap.as_service();
select public.confirm_checkout_group(tap.get('g')::uuid, 'cs_e', 'pi_e');
select tap.is((select count(*)::int from public.email_outbox where kind = 'confirmation'), 2, 'one confirmation row per date');

-- Claim groups by checkout and returns the details; the sender sends one email per group.
select tap.set('c', public.email_claim(25)::text);
select tap.is(jsonb_array_length(tap.get('c')::jsonb), 2, 'both rows claimed');
select tap.is((select count(distinct j ->> 'checkout_group')::int from jsonb_array_elements(tap.get('c')::jsonb) j), 1, 'same checkout group');
select tap.is(tap.get('c')::jsonb -> 0 ->> 'to', 'bob@test.local', 'addressed to the customer');
select tap.is(jsonb_array_length(public.email_claim(25)), 0, 'claimed rows aren''t handed out twice');
select public.email_mark(array(select (j ->> 'id')::uuid from jsonb_array_elements(tap.get('c')::jsonb) j), null);
select tap.is((select count(*)::int from public.email_outbox where sent_at is not null), 2, 'marked sent');

-- Cancellation queues a notice; blocks and guest walk-ins don't email anyone.
select public.mark_booking_cancelled((select id from public.bookings where checkout_group = tap.get('g')::uuid order by starts_at desc limit 1), 5000);
select tap.is((select count(*)::int from public.email_outbox where kind = 'cancellation'), 1, 'cancellation notice queued');
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select public.staff_create_booking(tap.id('loc'), 'block', array[tap.id('turf')], tap.slot(tap.at(3, '17:00'), 60), null, null, null, 'Lesson', null);
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage5')], tap.slot(tap.at(3, '17:00'), 60), null, 'Guest', null, null, 'cash');
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage6')], tap.slot(tap.at(3, '17:00'), 60), '00000000-0000-0000-0000-0000000000b1', null, null, null, 'cash');
select tap.as_admin();
select tap.is((select count(*)::int from public.email_outbox where kind = 'confirmation' and sent_at is null), 1,
              'only the walk-in for an account holder gets a confirmation');

-- Reminders: ~24h ahead, not for last-minute bookings.
insert into public.bookings (location_id, user_id, status, kind, starts_at, ends_at, total_cents, confirmed_at, created_at)
values (tap.id('loc'), '00000000-0000-0000-0000-0000000000b1', 'confirmed', 'online', now() + interval '20 hours', now() + interval '21 hours', 4000, now() - interval '3 days', now() - interval '3 days'),
       (tap.id('loc'), '00000000-0000-0000-0000-0000000000b1', 'confirmed', 'online', now() + interval '10 hours', now() + interval '11 hours', 4000, now() - interval '1 hour', now() - interval '1 hour'),
       (tap.id('loc'), '00000000-0000-0000-0000-0000000000b1', 'confirmed', 'online', now() + interval '3 days', now() + interval '3 days 1 hour', 4000, now() - interval '3 days', now() - interval '3 days');
select tap.as_service();
select tap.is(public.email_queue_reminders(), 1, 'one reminder due (booked days ago, starts within 24h; not for one booked 11h ahead)');
select tap.is(public.email_queue_reminders(), 0, 'reminders are queued once');

-- Stale news is skipped instead of sent late.
select tap.as_admin();
update public.email_outbox set created_at = now() - interval '2 days' where kind = 'cancellation';
select tap.as_service();
select public.email_claim(25);
select tap.is((select skipped_reason from public.email_outbox where kind = 'cancellation'), 'stale', 'old cancellation notice skipped');

-- Price-change notices aren't tied to a booking.
select public.queue_price_change_email('00000000-0000-0000-0000-0000000000b1', '{"tier":"Rookie","old_cents":4900,"new_cents":5900,"interval":"month","effective_at":"2030-01-01T00:00:00Z"}');
select tap.ok(exists (select 1 from jsonb_array_elements(public.email_claim(25)) j where j ->> 'kind' = 'price_change' and j -> 'booking' = 'null'::jsonb),
              'price-change notice claimed without a booking');

-- Customers can't read or claim the queue.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.email_claim(5)$$, 'permission', 'customers can''t claim emails');
select tap.throws($$select count(*) from public.email_outbox$$, 'permission', 'customers can''t read the outbox');
