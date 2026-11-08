-- Roles and privileges
select tap.as_admin();
select tap.ok(public.is_super_admin('00000000-0000-0000-0000-0000000000a1'), 'first account is super admin');
select tap.ok(not public.is_super_admin('00000000-0000-0000-0000-0000000000b1'), 'later accounts are not super admin');
select tap.ok(exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000b1' and role_code = 'APP_USER'),
              'new accounts get APP_USER');

select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.ok(public.has_privilege('bookings_create'), 'customer can book');
select tap.ok(not public.has_privilege('users_view'), 'customer cannot view users');
select tap.throws($$select public.admin_list_users()$$, 'permission', 'customer cannot list users');
select tap.throws($$select public.set_user_roles('00000000-0000-0000-0000-0000000000b1', array['ADMIN'])$$, 'permission', 'customer cannot change roles');

select tap.as_user('00000000-0000-0000-0000-0000000000d1');
select tap.ok(public.has_privilege('bookings_manage', tap.id('loc')), 'location manager manages their location');
select tap.ok(not public.has_privilege('bookings_manage'), 'location manager has no global front desk privilege');
select tap.is((public.my_access() -> 'location_privileges' -> 0 -> 'privileges') ? 'bookings_manage', true, 'my_access lists location privileges');

select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.ok(public.has_privilege('reports_view') and public.has_privilege('anything_new'), 'super admin passes every check');
select tap.throws($$select public.set_user_roles('00000000-0000-0000-0000-0000000000a1', array['APP_USER'])$$, 'at least one super admin',
                  'the last super admin cannot be removed');
select tap.throws($$select public.set_user_roles('00000000-0000-0000-0000-0000000000b1', array[]::text[])$$, 'at least one role',
                  'a user keeps at least one role');
select tap.lives($$select public.set_user_location_roles('00000000-0000-0000-0000-0000000000b1', 'LOCATION_MANAGER', array[tap.id('loc')])$$,
                 'admin can give a location role');
select tap.throws($$select public.set_user_location_roles('00000000-0000-0000-0000-0000000000b1', 'SUPER_ADMIN', array[tap.id('loc')])$$,
                  'can''t be given per location', 'SUPER_ADMIN cannot be location-scoped');

-- An ADMIN (not super) cannot grant SUPER_ADMIN.
select tap.as_admin();
insert into public.user_roles (user_id, role_code) values ('00000000-0000-0000-0000-0000000000c1', 'ADMIN');
select tap.as_user('00000000-0000-0000-0000-0000000000c1');
select tap.throws($$select public.set_user_roles('00000000-0000-0000-0000-0000000000b1', array['APP_USER','SUPER_ADMIN'])$$,
                  'only a super admin', 'admins cannot grant SUPER_ADMIN');

-- Profiles: customers can't set their own Stripe customer id.
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.throws($$update public.profiles set stripe_customer_id = 'cus_x' where id = auth.uid()$$, 'permission', 'stripe_customer_id is read-only');
