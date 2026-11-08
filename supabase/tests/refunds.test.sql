-- Cancellations and refund accounting
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.set('b', public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60)) -> 'bookings' -> 0 ->> 'booking_id');
select tap.as_service();
select public.confirm_checkout_group((select checkout_group from public.bookings where id = tap.get('b')::uuid), 'cs_1', 'pi_1');

-- Customers can't call the service-only functions.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.mark_booking_cancelled(tap.get('b')::uuid, 0)$$, 'permission', 'customers can''t mark cancellations');
select tap.throws($$update public.bookings set status = 'cancelled' where id = tap.get('b')::uuid$$, 'permission', 'customers can''t edit bookings');

-- Refunds accumulate (e.g. a reschedule refund, then a cancellation).
select tap.as_admin();
update public.bookings set refund_cents = 1000 where id = tap.get('b')::uuid;
select tap.as_service();
select public.mark_booking_cancelled(tap.get('b')::uuid, 4000);
select tap.is((select refund_cents from public.bookings where id = tap.get('b')::uuid), 5000, 'refunds add up');
select tap.is((select count(*)::int from public.booking_items where booking_id = tap.get('b')::uuid and active), 0, 'cancelled booking frees its cages');

-- Expired holds free the cage.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.set('h', public.create_booking_holds(tap.id('loc'), array[tap.id('cage2')], tap.slot(tap.at(2, '17:00'), 60)) -> 'bookings' -> 0 ->> 'booking_id');
select tap.as_admin();
update public.bookings set hold_expires_at = now() - interval '1 minute' where id = tap.get('h')::uuid;
select public.expire_stale_holds();
select tap.is((select status::text from public.bookings where id = tap.get('h')::uuid), 'expired', 'stale hold expires');
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.lives($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage2')], tap.slot(tap.at(2, '17:00'), 60))$$,
                 'the expired slot can be booked again');
