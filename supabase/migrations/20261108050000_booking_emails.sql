-- =====================================================================
-- Booking emails
-- =====================================================================
-- * email_outbox: one row per email to send. Triggers on bookings queue a
--   confirmation when a booking is confirmed (online, free, or a walk-in for
--   a customer with an account) and a cancellation when one is cancelled.
--   Reminders are queued about 24 hours before the session.
-- * The send-emails Edge Function (run every minute by pg_cron, see the next
--   migration) claims rows, sends them through Resend and marks them sent.
--   Bookings paid in one checkout are sent as one email.
-- =====================================================================

create table public.email_outbox (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('confirmation', 'cancellation', 'reminder')),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  checkout_group uuid,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz,
  attempts       integer not null default 0,
  sent_at        timestamptz,
  skipped_reason text,
  last_error     text
);
create index email_outbox_pending_idx on public.email_outbox (created_at)
  where sent_at is null and skipped_reason is null;

alter table public.bookings add column reminder_queued_at timestamptz;

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- ---------------------------------------------------------------------
-- Queue on status changes
-- ---------------------------------------------------------------------
create or replace function public.queue_booking_email()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.user_id is null or new.kind = 'block' then
    return new;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    v_kind := 'confirmation';
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled' then
    v_kind := 'cancellation';
  end if;
  if v_kind is not null then
    insert into public.email_outbox (kind, booking_id, checkout_group, user_id)
    values (v_kind, new.id, new.checkout_group, new.user_id);
  end if;
  return new;
end;
$$;

create trigger bookings_queue_email
  after insert or update of status on public.bookings
  for each row execute function public.queue_booking_email();

-- ---------------------------------------------------------------------
-- Used by the send-emails Edge Function (service role only)
-- ---------------------------------------------------------------------

-- Queues reminders for confirmed sessions starting within 24 hours
-- (not for ones booked less than a day ahead, or starting within 2 hours).
create or replace function public.email_queue_reminders()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  n integer;
begin
  with due as (
    update public.bookings b
       set reminder_queued_at = now()
     where b.status = 'confirmed'
       and b.user_id is not null
       and b.kind <> 'block'
       and b.reminder_queued_at is null
       and b.starts_at > now() + interval '2 hours'
       and b.starts_at <= now() + interval '24 hours'
       and coalesce(b.confirmed_at, b.created_at) < b.starts_at - interval '20 hours'
    returning b.id, b.checkout_group, b.user_id
  )
  insert into public.email_outbox (kind, booking_id, checkout_group, user_id)
  select 'reminder', id, checkout_group, user_id from due;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Claims up to p_limit emails and returns everything needed to write them.
create or replace function public.email_claim(p_limit integer default 25)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- Don't send stale news (e.g. if email was switched on late) or reminders for sessions that changed.
  update public.email_outbox o
     set skipped_reason = 'stale'
   where o.sent_at is null and o.skipped_reason is null
     and o.kind in ('confirmation', 'cancellation') and o.created_at < now() - interval '24 hours';
  update public.email_outbox o
     set skipped_reason = 'booking changed'
    from public.bookings b
   where b.id = o.booking_id and o.sent_at is null and o.skipped_reason is null
     and o.kind = 'reminder' and (b.status <> 'confirmed' or b.starts_at <= now());
  update public.email_outbox o
     set skipped_reason = 'gave up'
   where o.sent_at is null and o.skipped_reason is null and o.attempts >= 5;

  select array_agg(id) into v_ids
    from (select id from public.email_outbox
           where sent_at is null and skipped_reason is null
             and (claimed_at is null or claimed_at < now() - interval '10 minutes')
           order by created_at
           limit greatest(1, least(coalesce(p_limit, 25), 100))
           for update skip locked) x;
  if v_ids is null then
    return '[]'::jsonb;
  end if;

  update public.email_outbox set claimed_at = now(), attempts = attempts + 1 where id = any (v_ids);

  return (
    select jsonb_agg(jsonb_build_object(
             'id', o.id,
             'kind', o.kind,
             'checkout_group', o.checkout_group,
             'to', p.email,
             'name', p.display_name,
             'booking', jsonb_build_object(
               'id', b.id,
               'kind', b.kind,
               'status', b.status,
               'starts_at', b.starts_at,
               'ends_at', b.ends_at,
               'total_cents', b.total_cents,
               'discount_cents', b.discount_cents,
               'refund_cents', b.refund_cents,
               'payment_method', b.payment_method,
               'paid_online', b.stripe_payment_intent_id is not null,
               'location', jsonb_build_object('name', l.name, 'timezone', l.timezone, 'address', l.address),
               'items', (select jsonb_agg(jsonb_build_object('name', r.name, 'included_minutes', bi.included_minutes)
                                          order by r.sort_order, r.name)
                           from public.booking_items bi join public.resources r on r.id = bi.resource_id
                          where bi.booking_id = b.id)))
           order by b.starts_at)
      from public.email_outbox o
      join public.bookings b on b.id = o.booking_id
      join public.locations l on l.id = b.location_id
      join public.profiles p on p.id = o.user_id
     where o.id = any (v_ids));
end;
$$;

-- Marks emails sent, or records an error so they're retried later.
create or replace function public.email_mark(p_ids uuid[], p_error text default null)
returns void
language sql security definer
set search_path = ''
as $$
  update public.email_outbox
     set sent_at    = case when p_error is null then now() end,
         last_error = p_error,
         claimed_at = case when p_error is null then claimed_at end
   where id = any (p_ids);
$$;

revoke execute on function public.queue_booking_email() from public, anon, authenticated;
revoke execute on function public.email_queue_reminders() from public, anon, authenticated;
revoke execute on function public.email_claim(integer) from public, anon, authenticated;
revoke execute on function public.email_mark(uuid[], text) from public, anon, authenticated;
grant execute on function public.email_queue_reminders() to service_role;
grant execute on function public.email_claim(integer) to service_role;
grant execute on function public.email_mark(uuid[], text) to service_role;
grant select, insert, update on public.email_outbox to service_role;
