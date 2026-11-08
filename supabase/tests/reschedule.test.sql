-- Customer rescheduling
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.set('b', public.create_booking_holds(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 60)) -> 'bookings' -> 0 ->> 'booking_id');
select tap.as_service();
select public.confirm_checkout_group((select checkout_group from public.bookings where id = tap.get('b')::uuid), 'cs_r', 'pi_r');

-- Cage 1 is taken at 8pm by someone else.
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage1')], tap.slot(tap.at(2, '20:00'), 60), null, 'Other', null, null, 'cash');

select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.set('p', public.reschedule_preview(tap.get('b')::uuid, tap.at(2, '20:00'))::text);
select tap.is((tap.get('p')::jsonb ->> 'refund_cents')::int, 1000, 'off-peak move refunds the $10 difference');
select tap.is(tap.get('p')::jsonb -> 'resources' ->> 0, 'Cage 2', 'a free cage is picked when the old one is taken');
select tap.is((select count(*)::int from public.booking_items where booking_id = tap.get('b')::uuid and active), 1, 'preview changes nothing');
select tap.throws($$select public.reschedule_booking_core(auth.uid(), tap.get('b')::uuid, tap.at(2, '20:00'), false)$$, 'permission',
                  'customers can''t apply without the refund step');

select tap.as_service();
select public.reschedule_booking_core('00000000-0000-0000-0000-0000000000b1', tap.get('b')::uuid, tap.at(2, '20:00'), false);
select tap.is((select refund_cents from public.bookings where id = tap.get('b')::uuid), 1000, 'refund recorded');
select tap.is((select starts_at from public.bookings where id = tap.get('b')::uuid), tap.at(2, '20:00'), 'booking moved');

select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.reschedule_preview(tap.get('b')::uuid, tap.at(2, '17:00'))$$, 'costs \$10\.00 more', 'moving to a pricier time is refused');

-- Within 24 hours: not allowed.
select tap.as_admin();
update public.bookings set starts_at = now() + interval '3 hours', ends_at = now() + interval '4 hours' where id = tap.get('b')::uuid;
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.reschedule_preview(tap.get('b')::uuid, tap.at(3, '20:00'))$$, '24 hours', 'no changes within 24 hours');

-- Walk-ins can't be rescheduled online.
select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.set('w', public.staff_create_booking(tap.id('loc'), 'walk_in', array[tap.id('cage3')], tap.slot(tap.at(4, '17:00'), 60),
        '00000000-0000-0000-0000-0000000000b1', null, null, null, 'cash') -> 'bookings' -> 0 ->> 'booking_id');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$select public.reschedule_preview(tap.get('w')::uuid, tap.at(4, '18:00'))$$, 'front desk', 'walk-ins are changed at the desk');
