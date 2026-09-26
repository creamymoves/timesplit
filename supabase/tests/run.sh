#!/usr/bin/env bash
# Apply shim + migrations + tests to a scratch database. Usage: DATABASE_URL=postgres://... supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to a scratch Postgres database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/shim_supabase.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/lifecycle_test.sql | grep -E 'PASSED|ERROR'
