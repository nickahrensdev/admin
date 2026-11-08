-- Member pricing, included cage time, booking window, tier sync and scheduled changes
select tap.as_service();
-- Bob joins Rookie (Location 1: 4 hrs/month included, 10% off cages and turf, 90-day window).
select public.upsert_membership_from_stripe('00000000-0000-0000-0000-0000000000b1', tap.id('rookie'), 'sub_bob', 'cus_bob', 'active', 'month',
                                            now() - interval '5 days', now() + interval '25 days', false);

select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is((public.my_booking_terms(tap.id('loc')) ->> 'member')::boolean, true, 'Bob is a member at Location 1');

-- 2 hrs inside the paid period: fully included.
select tap.set('q', public.quote_booking(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00'), 120))::text);
select tap.is((tap.get('q')::jsonb ->> 'total_cents')::int, 0, 'included cage time makes it free');
select tap.is((tap.get('q')::jsonb -> 'dates' -> 0 ->> 'included_minutes')::int, 120, '120 included minutes used');

-- 5 hrs (two sessions) in the same month: 4 hrs included, 1 hr at 10% off ($25 peak → $22.50 → $23 rounded per slot).
select tap.set('q', public.quote_booking(tap.id('loc'), array[tap.id('cage1')],
        tap.slot(tap.at(2, '16:00'), 180) || tap.slot(tap.at(3, '16:00'), 120))::text);
select tap.is((select sum((d ->> 'included_minutes')::int)::int from jsonb_array_elements(tap.get('q')::jsonb -> 'dates') d), 240,
              'included minutes cap at 4 hrs');
select tap.ok((tap.get('q')::jsonb ->> 'total_cents')::int between 4400 and 4600, 'the remaining hour is discounted, not free',
              tap.get('q')::jsonb ->> 'total_cents');

-- Turf is never included, only discounted (1 hr peak turf = $110 → $99).
select tap.is((public.quote_booking(tap.id('loc'), array[tap.id('turf')], tap.slot(tap.at(2, '17:00'), 60)) ->> 'total_cents')::int,
              9900, 'turf: 10% off, no included time');

-- After the paid period ends, included time doesn't apply (member discount still does).
select tap.is((public.quote_booking(tap.id('loc'), array[tap.id('cage1')], tap.slot(tap.at(2, '17:00', 5), 60)) ->> 'total_cents')::int,
              4500, 'sessions after renewal are discounted but not included');

-- Members can book beyond 30 days.
select tap.lives($$select public.create_booking_holds(tap.id('loc'), array[tap.id('cage2')], tap.slot(tap.at(2, '17:00', 6), 60))$$,
                 'members can book 6 weeks ahead');

-- A fully included checkout confirms without payment.
select tap.set('g', public.create_booking_holds(tap.id('loc'), array[tap.id('cage3')], tap.slot(tap.at(2, '17:00'), 60)) ->> 'group_id');
select tap.lives($$select public.confirm_free_checkout(tap.get('g')::uuid)$$, 'free checkout confirms');
select tap.is((select status::text from public.bookings where checkout_group = tap.get('g')::uuid), 'confirmed', 'booking confirmed');

-- Someone else can't confirm Bob's free checkout.
select tap.set('g2', public.create_booking_holds(tap.id('loc'), array[tap.id('cage4')], tap.slot(tap.at(3, '17:00'), 30)) ->> 'group_id');
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.throws($$select public.confirm_free_checkout(tap.get('g2')::uuid)$$, 'needs payment|expired', 'other users can''t confirm it');

-- Tier changes from Stripe update the tier; scheduled changes clear once they happen.
select tap.as_service();
select public.set_membership_pending('sub_bob', tap.id('allstar'), 'year', now() + interval '25 days');
select public.upsert_membership_from_stripe('00000000-0000-0000-0000-0000000000b1', tap.id('rookie'), 'sub_bob', 'cus_bob', 'active', 'month',
                                            now() - interval '5 days', now() + interval '25 days', false);
select tap.ok((select pending_tier_id is not null from public.memberships where stripe_subscription_id = 'sub_bob'), 'pending change kept before it happens');
select public.upsert_membership_from_stripe('00000000-0000-0000-0000-0000000000b1', tap.id('allstar'), 'sub_bob', 'cus_bob', 'active', 'year',
                                            now(), now() + interval '1 year', false);
select tap.is((select t.name from public.memberships m join public.membership_tiers t on t.id = m.tier_id where m.stripe_subscription_id = 'sub_bob'),
              'All-Star', 'tier follows Stripe');
select tap.ok((select pending_tier_id is null from public.memberships where stripe_subscription_id = 'sub_bob'), 'pending change cleared once applied');

-- Statuses map to the app's states; canceled members lose benefits.
select public.upsert_membership_from_stripe('00000000-0000-0000-0000-0000000000b1', tap.id('allstar'), 'sub_bob', 'cus_bob', 'canceled', 'year',
                                            now(), now() + interval '1 year', false);
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is((public.my_booking_terms(tap.id('loc')) ->> 'member')::boolean, false, 'canceled membership gives no benefits');

-- Tier visibility: hidden tiers aren't listed to customers.
select tap.as_admin();
update public.membership_tiers set is_active = false where id = tap.id('allstar');
select tap.as_user(null);
select tap.ok(not exists (select 1 from jsonb_array_elements(public.list_membership_tiers()) t where t ->> 'name' = 'All-Star'),
              'hidden tier is not offered');
