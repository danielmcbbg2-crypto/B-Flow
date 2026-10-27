#!/usr/bin/env bash
# Applies the migrations to a scratch database on a local Postgres and runs the RLS tests.
# Connection comes from the standard PG* variables, e.g.
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGOPTIONS='-c client_min_messages=error'
# Only ever a throwaway local database: it drops and recreates npm_test, so refuse anything that
# isn't this machine (a socket directory or localhost), whatever the PG* variables say.
case "${PGHOST:-localhost}" in
  /*|localhost|127.0.0.1|::1) ;;
  *) echo "Refusing to run: PGHOST=${PGHOST} is not a local database. The DB tests only run against a local Postgres." >&2; exit 1 ;;
esac
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d npm_test -f "$f"
done
TEST_DATABASE_URL="postgresql:///npm_test?host=${PGHOST:-localhost}&port=${PGPORT:-5432}&user=${PGUSER:-postgres}" \
  npx tsx --test supabase/tests/rls.test.ts
