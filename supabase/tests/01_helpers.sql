-- Tiny assertion helpers. Each test file runs in a transaction that is rolled
-- back, calls tap.plan-free assertions, and ends with tap.finish(), which
-- fails the file if any assertion failed.
create schema tap;
grant usage on schema tap to anon, authenticated, service_role;
create table tap.results (n serial, ok boolean, name text, detail text);
grant all on tap.results to anon, authenticated, service_role;
grant usage on sequence tap.results_n_seq to anon, authenticated, service_role;

create function tap.ok(p_ok boolean, p_name text, p_detail text default null) returns void
language plpgsql as $$
begin
  insert into tap.results (ok, name, detail) values (coalesce(p_ok, false), p_name, p_detail);
  if coalesce(p_ok, false) then
    raise notice 'ok - %', p_name;
  else
    raise warning 'NOT OK - % %', p_name, coalesce('(' || p_detail || ')', '');
  end if;
end $$;

create function tap.is(p_got anyelement, p_want anyelement, p_name text) returns void
language plpgsql as $$
begin
  perform tap.ok(p_got is not distinct from p_want, p_name, format('got %s, want %s', p_got, p_want));
end $$;

-- Runs p_sql and checks it fails with a message matching p_pattern (regex, case-insensitive).
create function tap.throws(p_sql text, p_pattern text, p_name text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform tap.ok(sqlerrm ~* p_pattern, p_name, sqlerrm);
    return;
  end;
  perform tap.ok(false, p_name, 'no error was raised');
end $$;

create function tap.lives(p_sql text, p_name text) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform tap.ok(true, p_name);
exception when others then
  perform tap.ok(false, p_name, sqlerrm);
end $$;

-- Act as a signed-in user (or anon with null) for the rest of the transaction.
create function tap.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user)::text end, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
end $$;

create function tap.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end $$;

create function tap.as_admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;

create function tap.finish() returns void
language plpgsql as $$
declare
  v_fail int;
  v_all int;
begin
  perform set_config('role', 'postgres', true);
  select count(*) filter (where not ok), count(*) into v_fail, v_all from tap.results;
  if v_fail > 0 then
    raise exception '% of % assertions failed', v_fail, v_all;
  end if;
  raise notice 'all % assertions passed', v_all;
end $$;

-- A local date N weeks ahead on a given weekday (0 = Sunday) at a local time, in the location's zone.
create function tap.at(p_dow int, p_time time, p_weeks int default 1, p_tz text default 'America/Chicago') returns timestamptz
language sql stable as $$
  select ((((now() at time zone p_tz)::date + ((p_dow - extract(dow from (now() at time zone p_tz))::int + 7) % 7) + 7 * p_weeks))
          + p_time) at time zone p_tz
$$;

create function tap.slot(p_start timestamptz, p_minutes int) returns jsonb
language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('starts_at', p_start, 'ends_at', p_start + make_interval(mins => p_minutes)))
$$;

-- Values shared between steps of a test (works across the roles a test switches between).
create table tap.vars (key text primary key, val text);
grant all on tap.vars to anon, authenticated, service_role;
create function tap.set(p_key text, p_val text) returns text language sql as $$
  insert into tap.vars values (p_key, p_val) on conflict (key) do update set val = excluded.val returning val
$$;
create function tap.get(p_key text) returns text language sql stable as $$ select val from tap.vars where key = p_key $$;
