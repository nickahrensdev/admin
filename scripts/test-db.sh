#!/usr/bin/env bash
# Runs the database tests against a throwaway database.
# Connects with the standard PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD);
# defaults to postgres@localhost:5432. TEST_DB names the database (yard_test).
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB="${TEST_DB:-yard_test}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -d "$DB" -f supabase/tests/00_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  err=$($PSQL -d "$DB" -f "$f" 2>&1 >/dev/null) || { echo "Migration failed: $f"; echo "$err"; exit 1; }
done
$PSQL -d "$DB" -f supabase/tests/01_helpers.sql -f supabase/tests/02_seed.sql >/dev/null

pass=0; fail=0; failed=()
for f in supabase/tests/*.test.sql; do
  name=$(basename "$f")
  if out=$($PSQL -d "$DB" -c "begin" -c "truncate tap.results, tap.vars" -f "$f" -c "select tap.finish()" -c "rollback" 2>&1); then
    n=$(grep -c "ok - " <<<"$out" || true)
    echo "✔ $name ($n checks)"
    pass=$((pass + 1))
  else
    echo "✘ $name"
    grep -E "NOT OK|ERROR|assertions failed" <<<"$out" | sed 's/^/    /'
    fail=$((fail + 1)); failed+=("$name")
  fi
done
echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
