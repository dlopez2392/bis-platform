#!/usr/bin/env bash
# Starts verify's database: a throwaway Supabase stack inside this runner,
# built from the branch's own migration files, then hands its four values to
# the later steps through GITHUB_ENV.
#
# Why (2026-10-08): until this date every verify run, on every branch, ran the
# db suite against ONE shared cloud project (bis-ci), so verify was serialized
# repo-wide in one concurrency group and three or four queued runs meant the
# last waited about 45 minutes before it started. A stack per run shares
# nothing, so verify needs no repo-wide group. e2e still runs on the shared
# project (it signs in through real Clerk, which that project trusts).
#
# THE ORDER IS THE POINT, and it is the CI project's own order
# (docs/runbooks/ci-supabase-project.md sections 2 and 3):
#   1. start the stack from a workdir holding config.toml and NO migrations,
#      so `supabase start` applies none of them itself;
#   2. the bootstrap (packages/db/supabase/bootstrap/ci-project.sql), in one
#      transaction: production's default privileges, and the brand-logos
#      bucket. Grants attach when a table is CREATED, and the CLI starts a
#      stack with default privileges that grant the Data API roles nothing,
#      so this must come before the first CREATE TABLE. The bucket needs
#      storage's own schema, which exists once `supabase start` has returned;
#   3. the migrations, by `supabase db push`, the command that built the CI
#      project (packages/db/src/ci/push.ts), recorded in the same history table.
# Started any other way, the grant-pinning tests in the db suite would test a
# database neither the CI project nor production is.
#
# Needs: `supabase` on PATH (.github/scripts/ci-supabase-cli.sh puts the pinned
# one there), `psql` (on GitHub's ubuntu runners), Docker, RUNNER_TEMP,
# GITHUB_ENV, and the repository root as the working directory.
#
# Writes to GITHUB_ENV, only after every step above succeeded:
#   NEXT_PUBLIC_SUPABASE_URL       <- API_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  <- ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY      <- SERVICE_ROLE_KEY
#   SUPABASE_DB_URL                <- DB_URL
# The two keys are the CLI's legacy JWTs, signed with the local stack's
# default secret; they open nothing but this runner's stack. They are still
# never printed. ci-target-guard.sh --local-stack checks all four next.
#
# Tested by apps/web/ci/ci-local-supabase.test.ts (fake supabase and psql).

{ set +x; } 2>/dev/null
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is not set: this script runs on a GitHub Actions runner}"
: "${GITHUB_ENV:?GITHUB_ENV is not set: this script runs on a GitHub Actions runner}"

DB_DIR="packages/db/supabase"
BOOTSTRAP="$DB_DIR/bootstrap/ci-project.sql"

# Services no suite reaches. Kept: the database, kong (the API gateway every
# client goes through), postgrest, storage-api (demo-seed.test.ts uploads a
# logo) and gotrue. Nothing in `pnpm check` signs in (the db suite sets
# request.jwt.claims itself; the one Clerk-token test is the integration
# suite, which verify does not run), but with gotrue excluded CLI 2.109.1
# prints no ANON_KEY or SERVICE_ROLE_KEY at all (run 37813077940), and it
# costs no extra pull: `supabase start` pulls it anyway for the auth schema.
EXCLUDE="realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"

for tool in supabase psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::$tool is not on PATH. verify installs the Supabase CLI in the step before this one (.github/scripts/ci-supabase-cli.sh); psql ships with GitHub's ubuntu runners."
    exit 1
  fi
done

work="$RUNNER_TEMP/bis-local-supabase"
rm -rf "$work"
mkdir -p "$work/supabase/migrations"
cp "$DB_DIR/config.toml" "$work/supabase/config.toml"

started_at=$SECONDS
supabase start --workdir "$work" --exclude "$EXCLUDE"
start_seconds=$((SECONDS - started_at))

# KEY="value" lines; anything else the CLI prints is ignored. Values are read,
# never echoed: a missing one is named by its KEY.
api_url="" db_url="" anon_key="" service_key=""
unquote() { local v="$1"; v="${v#\"}"; v="${v%\"}"; printf '%s' "$v"; }
while IFS= read -r line; do
  case "$line" in
    API_URL=*) api_url="$(unquote "${line#API_URL=}")" ;;
    DB_URL=*) db_url="$(unquote "${line#DB_URL=}")" ;;
    ANON_KEY=*) anon_key="$(unquote "${line#ANON_KEY=}")" ;;
    SERVICE_ROLE_KEY=*) service_key="$(unquote "${line#SERVICE_ROLE_KEY=}")" ;;
  esac
done < <(supabase status --workdir "$work" -o env)

missing=""
[ -n "$api_url" ] || missing="$missing API_URL"
[ -n "$db_url" ] || missing="$missing DB_URL"
[ -n "$anon_key" ] || missing="$missing ANON_KEY"
[ -n "$service_key" ] || missing="$missing SERVICE_ROLE_KEY"
if [ -n "$missing" ]; then
  echo "::error::\`supabase status -o env\` printed no value for:$missing. Nothing was applied. If the pinned CLI renamed its status variables, map the new names here."
  exit 1
fi

# The major the stack runs must be the one config.toml names (and production
# runs; the bootstrap's notes on "all" privileges are Postgres 17's letters).
want_major="$(sed -nE 's/^major_version *= *([0-9]+).*/\1/p' "$DB_DIR/config.toml")"
got_num="$(psql "$db_url" -X -tA -c "show server_version_num" | tr -d '[:space:]')"
got_major=$((got_num / 10000))
if [ "$got_major" != "$want_major" ]; then
  echo "::error::The local stack runs Postgres $got_major, but $DB_DIR/config.toml names major_version $want_major. Nothing was applied."
  exit 1
fi

schema_at=$SECONDS
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$BOOTSTRAP"
supabase db push --local --workdir packages/db --yes
# PostgREST read its schema when the stack started, with no tables in it.
psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema'"
schema_seconds=$((SECONDS - schema_at))

{
  echo "NEXT_PUBLIC_SUPABASE_URL=$api_url"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon_key"
  echo "SUPABASE_SERVICE_ROLE_KEY=$service_key"
  echo "SUPABASE_DB_URL=$db_url"
} >> "$GITHUB_ENV"

echo "::notice::Local Supabase stack (Postgres $got_major): supabase start ${start_seconds}s, bootstrap and migrations ${schema_seconds}s."
