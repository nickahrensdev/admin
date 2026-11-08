-- =====================================================================
-- Admin to-dos: a simple checklist for super admins (setup steps, reminders).
-- =====================================================================

insert into public.privileges (code, description) values
  ('todos_manage', 'See and edit the admin to-do list');

create table public.admin_todos (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) between 1 and 200),
  notes      text not null default '' check (length(notes) <= 4000),
  done       boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  done_at    timestamptz,
  done_by    uuid references public.profiles (id) on delete set null
);

alter table public.admin_todos enable row level security;
create policy "todos: read" on public.admin_todos for select to authenticated
  using (public.has_privilege('todos_manage'));
create policy "todos: insert" on public.admin_todos for insert to authenticated
  with check (public.has_privilege('todos_manage'));
create policy "todos: update" on public.admin_todos for update to authenticated
  using (public.has_privilege('todos_manage')) with check (public.has_privilege('todos_manage'));
create policy "todos: delete" on public.admin_todos for delete to authenticated
  using (public.has_privilege('todos_manage'));
revoke all on public.admin_todos from anon;
grant select, insert, update, delete on public.admin_todos to authenticated;

-- Stamp who/when on create and completion.
create or replace function public.admin_todos_stamp()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif not new.done then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.admin_todos_stamp() from public, anon, authenticated;

create trigger admin_todos_stamp
  before insert or update on public.admin_todos
  for each row execute function public.admin_todos_stamp();

insert into public.admin_todos (title, notes, sort_order) values
  ('Turn on booking emails (confirmation, reminder, cancellation)',
   E'Emails are queued but not sent until these are set.\n\n'
   || E'1. In Resend, make sure your sending domain is verified (Domains). Sign-up emails already use it.\n'
   || E'2. In Supabase: Edge Functions → Secrets, add:\n'
   || E'   • RESEND_API_KEY = your Resend API key (the same one used as the SMTP password)\n'
   || E'   • EMAIL_FROM = The Yard <bookings@your-verified-domain.com>\n'
   || E'   • EMAIL_REPLY_TO (optional) = the inbox customers should reply to\n'
   || E'3. Make a test booking. The confirmation should arrive within a minute.\n\n'
   || E'Emails queued more than a day before the secrets are added are skipped, so nobody gets old news.',
   10);
