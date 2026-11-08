#!/usr/bin/env bash
# Starts what the browser tests need: a fresh database, PostgREST and the test
# proxy on :3012, and a build of the app pointed at it (dist-e2e/).
#   POSTGREST_BIN  path to the postgrest binary (default: postgrest on PATH)
#   PG* variables  as for scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=yard_e2e
PSQL="psql -X -q -v ON_ERROR_STOP=1"

$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
$PSQL -d "$DB" -f supabase/tests/00_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do $PSQL -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "Migration failed: $f"; exit 1; }; done
$PSQL -d "$DB" -f tests/e2e/seed.sql >/dev/null

if [ "$PGHOST" = "${PGHOST#/}" ]; then
  export PGRST_DB_URI="postgres://$PGUSER${PGPASSWORD:+:$PGPASSWORD}@$PGHOST:$PGPORT/$DB"
else
  export PGRST_DB_URI="postgres://$PGUSER@/$DB?host=$PGHOST&port=$PGPORT"
fi
for f in /tmp/yard-e2e-postgrest.pid /tmp/yard-e2e-proxy.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
done
nohup "${POSTGREST_BIN:-postgrest}" tests/e2e/postgrest.conf > /tmp/e2e-postgrest.log 2>&1 &
echo $! > /tmp/yard-e2e-postgrest.pid
nohup python3 tests/e2e/proxy.py > /tmp/e2e-proxy.log 2>&1 &
echo $! > /tmp/yard-e2e-proxy.pid
sleep 1
kill -0 "$(cat /tmp/yard-e2e-postgrest.pid)" 2>/dev/null || { echo "PostgREST didn't start (is port 3011 in use?)"; cat /tmp/e2e-postgrest.log; exit 1; }
kill -0 "$(cat /tmp/yard-e2e-proxy.pid)" 2>/dev/null || { echo "Test proxy didn't start (is port 3012 in use?)"; cat /tmp/e2e-proxy.log; exit 1; }
for i in $(seq 1 30); do curl -sf http://127.0.0.1:3012/rest/v1/locations?select=id >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:3012/rest/v1/locations?select=id >/dev/null || { echo "API didn't start"; cat /tmp/e2e-postgrest.log; exit 1; }

VITE_SUPABASE_URL=http://127.0.0.1:3012 npx vite build --outDir dist-e2e --emptyOutDir >/dev/null
echo "Browser-test stack is up (API :3012, app build in dist-e2e/)."
