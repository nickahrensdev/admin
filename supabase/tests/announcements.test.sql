-- Home screen messages
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.announcements (title, dismissible) values ('Everyone, dismissible', true);
insert into public.announcements (title, location_id, dismissible, expires_at) values ('Loc 1, auto-hide', tap.id('loc'), false, now() + interval '2 days');
insert into public.announcements (title, starts_at) values ('Scheduled', now() + interval '1 day');
insert into public.announcements (title, starts_at, expires_at) values ('Ended', now() - interval '2 days', now() - interval '1 day');
insert into public.announcements (title, archived) values ('Archived', true);

select tap.as_user('00000000-0000-0000-0000-0000000000c1');
select tap.is((select array_agg(a ->> 'title' order by a ->> 'title') from jsonb_array_elements(public.my_announcements()) a),
              array['Everyone, dismissible', 'Loc 1, auto-hide'], 'only current messages show (one location: everyone sees its messages)');
select tap.throws($$select public.dismiss_announcement((select (a ->> 'id')::uuid from jsonb_array_elements(public.my_announcements()) a where a ->> 'title' = 'Loc 1, auto-hide'))$$,
                  'can''t be dismissed', 'non-dismissible messages stay');
select public.dismiss_announcement((select (a ->> 'id')::uuid from jsonb_array_elements(public.my_announcements()) a where a ->> 'title' = 'Everyone, dismissible'));
select tap.is(jsonb_array_length(public.my_announcements()), 1, 'dismissed message is gone for that user');
select tap.as_user('00000000-0000-0000-0000-0000000000b1');
select tap.is(jsonb_array_length(public.my_announcements()), 2, '…but not for others');
select tap.throws($$insert into public.announcements (title) values ('nope')$$, 'row-level security', 'customers can''t post');
select tap.is((select count(*)::int from public.announcements), 0, 'customers can''t read the admin table directly');

-- With a second location, its messages only reach people connected to it.
select tap.as_admin();
insert into public.locations (slug, name, timezone) values ('loc-2', 'Loc 2', 'America/Chicago');
insert into public.announcements (title, location_id) select 'Loc 2 news', id from public.locations where slug = 'loc-2';
select tap.as_user('00000000-0000-0000-0000-0000000000c1');
select tap.ok(not exists (select 1 from jsonb_array_elements(public.my_announcements()) a where a ->> 'title' = 'Loc 2 news'),
              'location messages skip unrelated customers');
select tap.as_user('00000000-0000-0000-0000-0000000000a1');
select tap.ok(exists (select 1 from jsonb_array_elements(public.my_announcements()) a where a ->> 'title' = 'Loc 2 news'),
              'staff with all-location roles see them');
