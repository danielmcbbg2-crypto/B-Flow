#!/usr/bin/env bash
# Applies the migration to a scratch database on a local Postgres and runs the RLS tests.
# Connection comes from the standard PG* variables, e.g.
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGOPTIONS='-c client_min_messages=error'
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase-stub.sql
psql -q -v ON_ERROR_STOP=1 -d npm_test -f supabase/migrations/20261014000000_init.sql
TEST_DATABASE_URL="postgresql:///npm_test?host=${PGHOST:-localhost}&port=${PGPORT:-5432}&user=${PGUSER:-postgres}" \
  npx tsx --test supabase/tests/rls.test.ts
