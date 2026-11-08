-- My bookings: add the booking kind, the location's address (for directions)
-- and each item's resource id (for "Book again").
create or replace function public.my_bookings()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'kind', b.kind,
           'status', b.status,
           'starts_at', b.starts_at,
           'ends_at', b.ends_at,
           'total_cents', b.total_cents,
           'discount_cents', b.discount_cents,
           'refund_cents', b.refund_cents,
           'hold_expires_at', b.hold_expires_at,
           'created_at', b.created_at,
           'location', jsonb_build_object('id', l.id, 'name', l.name, 'timezone', l.timezone, 'address', l.address),
           'items', (select jsonb_agg(jsonb_build_object('resource_id', r.id, 'name', r.name, 'type', r.type,
                                                         'price_cents', bi.price_cents,
                                                         'included_minutes', bi.included_minutes)
                                      order by r.sort_order, r.name)
                       from public.booking_items bi join public.resources r on r.id = bi.resource_id
                      where bi.booking_id = b.id))
         order by b.starts_at desc), '[]'::jsonb)
    from public.bookings b
    join public.locations l on l.id = b.location_id
   where b.user_id = auth.uid()
     and b.status <> 'expired';
$$;

revoke execute on function public.my_bookings() from public, anon;
grant execute on function public.my_bookings() to authenticated;
