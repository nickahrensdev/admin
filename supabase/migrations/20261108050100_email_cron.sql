-- Runs the send-emails Edge Function every minute (Supabase pg_cron + pg_net).
-- The function only sends what's already queued, so the call needs no secret.
-- Skipped where the extensions aren't available (local test databases).
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net not available; booking emails must be triggered another way.';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  perform cron.schedule(
    'send-booking-emails',
    '* * * * *',
    $cmd$
      select net.http_post(
        url := 'https://cemnqswodgaqmctqbogo.supabase.co/functions/v1/send-emails',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
    $cmd$
  );
end
$outer$;
