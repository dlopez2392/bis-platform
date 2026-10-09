#!/usr/bin/env bash
# Starts a CI job's database: a throwaway Supabase stack inside this runner,
# built from the branch's own migration files, then hands its four values to
# the later steps through GITHUB_ENV. Both CI jobs run it: verify with no
# argument, e2e with --trust-clerk-dev-instance (below).
#
# Why (2026-10-08): until this date every verify run, on every branch, ran the
# db suite against ONE shared cloud project (bis-ci), so verify was serialized
# repo-wide in one concurrency group and three or four queued runs meant the
# last waited about 45 minutes before it started. A stack per run shares
# nothing, so verify needs no repo-wide group. e2e followed the same day, for
# the same reason: its own repo-wide queue, and specs that timed out under
# contention on the shared project.
#
# --trust-clerk-dev-instance (e2e only). e2e signs in for real: every
# in-account page reads through userDb(), which sends the Clerk session token
# as the Bearer, and PostgREST must verify it, as bis-ci does through its
# Third-Party Auth entry for the Clerk development instance. CLI 2.109.1 does
# the same for a local stack whose config.toml enables
# [auth.third_party.clerk]: at `supabase start` it fetches
# https://<domain>/.well-known/openid-configuration, then its jwks_uri, and
# hands PostgREST those keys plus the stack's own secret as one JWKS
# (PGRST_JWT_SECRET). Kong passes any Bearer that is not an `sb_` key through
# untouched. [External: read from the supabase/cli source at tag v2.109.1,
# pkg/config ResolveJWKS and internal/start.] The domain is the instance's
# Frontend API, which NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY carries
# (pk_test_ + base64 of "<domain>$"), so the stack trusts exactly the instance
# the app signs in with, and only a development instance's
# (*.clerk.accounts.dev) is accepted. The edit is made to the COPY of
# config.toml in the workdir, never the repository's. After the start, the
# running PostgREST's JWKS is read back (docker inspect) and must hold an RSA
# key whose kid is a Clerk instance id (`ins_…`): the stack's own secret is an
# `oct` key, and the kid is what ties the RSA key to Clerk rather than to
# whatever issuer answered. Without the flag nothing about Clerk is touched.
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
# one there), `psql` (on GitHub's ubuntu runners), Docker (`docker` on PATH,
# also used to turn off Kong's upstream keep-alive, see KONG below),
# RUNNER_TEMP, GITHUB_ENV, and the repository root as the working directory.
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

# The argument is never echoed: it names a mode, and anything else is refused
# before anything starts, so a typo can never hand e2e verify's stack.
trust_clerk=0
if [ "$#" -eq 1 ] && [ "$1" = "--trust-clerk-dev-instance" ]; then
  trust_clerk=1
elif [ "$#" -ne 0 ]; then
  echo "::error::ci-local-supabase.sh takes no argument (verify) or --trust-clerk-dev-instance (e2e), once. Nothing was started."
  exit 1
fi

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

for tool in supabase psql docker; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::$tool is not on PATH. verify installs the Supabase CLI in the step before this one (.github/scripts/ci-supabase-cli.sh); psql ships with GitHub's ubuntu runners."
    exit 1
  fi
done

# The Clerk development instance's Frontend API domain, from its publishable
# key, before anything starts. Never printed: the key (a repository secret,
# which GitHub masks); printed: the domain (public, served to every browser).
clerk_domain=""
if [ "$trust_clerk" = 1 ]; then
  pk="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
  case "$pk" in
    "")
      echo "::error::NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is empty or missing; it comes from repository secret NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. The stack would not trust any Clerk session. Nothing was started."
      exit 1 ;;
    pk_live_*)
      echo "::error::NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a pk_live_ key: the production Clerk instance. The e2e stack trusts the development instance only. Nothing was started."
      exit 1 ;;
    pk_test_*) ;;
    *)
      echo "::error::NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a Clerk development instance's publishable key (pk_test_). Nothing was started."
      exit 1 ;;
  esac
  b64="${pk#pk_test_}"
  while [ $(( ${#b64} % 4 )) -ne 0 ]; do b64="$b64="; done
  decoded="$(printf '%s' "$b64" | base64 -d 2>/dev/null || true)"
  candidate="${decoded%\$}"
  if [ "$decoded" = "$candidate" ] || ! [[ "$candidate" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)*\.clerk\.accounts\.dev$ ]]; then
    echo "::error::NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY does not name a Clerk development instance: it must decode to \"<name>.clerk.accounts.dev\$\". Nothing was started."
    exit 1
  fi
  clerk_domain="$candidate"
fi

work="$RUNNER_TEMP/bis-local-supabase"
rm -rf "$work"
mkdir -p "$work/supabase/migrations"
cp "$DB_DIR/config.toml" "$work/supabase/config.toml"

if [ "$trust_clerk" = 1 ]; then
  # In the copy only: [auth.third_party.clerk] gets `enabled = true` and the
  # domain, in place of its `enabled = false` and commented example. Then read
  # back: the table must hold exactly those two settings, or nothing starts.
  cfg="$work/supabase/config.toml"
  awk -v domain="$clerk_domain" '
    /^\[/ { in_clerk = ($0 == "[auth.third_party.clerk]") }
    in_clerk && /^#? *domain *=/ { next }
    in_clerk && /^enabled *=/ { print "enabled = true"; print "domain = \"" domain "\""; done = 1; next }
    { print }
    END { if (!done) exit 3 }
  ' "$DB_DIR/config.toml" > "$cfg" || {
    echo "::error::$DB_DIR/config.toml has no [auth.third_party.clerk] table with an enabled line to switch on. Nothing was started."
    exit 1
  }
  got="$(awk '/^\[/ { in_clerk = ($0 == "[auth.third_party.clerk]"); next } in_clerk && /^[a-z_]+ *=/ { print }' "$cfg")"
  want="$(printf 'enabled = true\ndomain = "%s"' "$clerk_domain")"
  if [ "$got" != "$want" ]; then
    echo "::error::The stack's copy of config.toml does not enable [auth.third_party.clerk] for $clerk_domain exactly. Nothing was started."
    exit 1
  fi
fi

started_at=$SECONDS
supabase start --workdir "$work" --exclude "$EXCLUDE"
start_seconds=$((SECONDS - started_at))

# KONG: NO UPSTREAM KEEP-ALIVE. Run 37813770089 (2026-10-08) passed 1580 of
# 1581 db tests; the one failure was a POST answered by Kong's own 502, "An
# invalid response was received from the upstream server". Kong 2.8.1 keeps
# an idle upstream connection up to 60s; PostgREST v14.14 (what CLI 2.109.1
# runs) closes idle ones sooner, and after a HEAD response (every
# `{ count: 'exact', head: true }`) closes without saying so. nginx retries a
# dead pooled connection only for idempotent methods, so a POST or PATCH
# fails, on a different test each run. [External: supabase/cli issue #6674
# and its thread. Fixed upstream in PostgREST v14.15, i.e. CLI >= 2.110.0,
# which also moved the CLI's database commands to a new implementation, so a
# bump is its own change.] With pool size 0 (Kong: "disables upstream
# keepalive connections") every proxied request opens its own loopback
# connection, and none can land on one PostgREST already closed.
#
# The file edit and reload are not trusted: the RUNNING node's configuration
# is read back from Kong's admin API (inside the container only) until it
# says 0, and anything else stops the job here, before any schema exists.
project_id="$(sed -nE 's/^project_id *= *"([^"]+)".*/\1/p' "$DB_DIR/config.toml")"
kong="supabase_kong_${project_id}"
docker exec "$kong" sh -c "sed -i 's/^upstream_keepalive_pool_size = .*/upstream_keepalive_pool_size = 0/' /usr/local/kong/.kong_env && kong reload"
pool=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  admin="$(docker exec "$kong" sh -c "curl -fsS http://127.0.0.1:8001/ 2>/dev/null || wget -qO- http://127.0.0.1:8001/" || true)"
  pool="$(printf '%s' "$admin" | grep -oE '"upstream_keepalive_pool_size": ?[0-9]+' | grep -oE '[0-9]+$' || true)"
  [ "$pool" = "0" ] && break
  sleep 1
done
if [ "$pool" != "0" ]; then
  echo "::error::Kong ($kong) still reports upstream_keepalive_pool_size=${pool:-<unreadable>} after the reload, so POSTs through it can fail with a sporadic 502. Nothing was applied. If the pinned CLI changed how Kong is built, see this script's KONG note."
  exit 1
fi

# CLERK: what the RUNNING PostgREST verifies tokens with, not what the config
# file says. Its JWKS must hold an RSA key whose kid is Clerk's shape, the
# instance id (`ins_` + letters and digits), in the SAME key object: "some
# RSA key" would prove only that some issuer's key got there (review M-5,
# 2026-10-08). The stack's own secret is an `oct` key. A JWK is a flat object,
# so each `{…}` with no brace inside it is one key, judged on its own.
trust_note=""
if [ "$trust_clerk" = 1 ]; then
  rest="supabase_rest_${project_id}"
  jwks="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$rest" 2>/dev/null | sed -n 's/^PGRST_JWT_SECRET=//p' || true)"
  # `|| true` inside: with pipefail, grep finding nothing would end the script
  # here, silently, instead of at the message below.
  clerk_keys=0
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    if printf '%s' "$key" | grep -qE '"kty" *: *"RSA"' \
      && printf '%s' "$key" | grep -qE '"kid" *: *"ins_[A-Za-z0-9]+"'; then
      clerk_keys=$((clerk_keys + 1))
    fi
  done < <(printf '%s' "$jwks" | grep -oE '\{[^{}]*\}' || true)
  if [ "$clerk_keys" -lt 1 ]; then
    echo "::error::PostgREST ($rest) holds no RSA key with a Clerk instance kid (ins_...) in PGRST_JWT_SECRET, so it would refuse every Clerk session token ($clerk_domain) and every in-account page would come back empty. Nothing was applied. If the pinned CLI changed how it hands third-party keys to PostgREST, see this script's header."
    exit 1
  fi
  trust_note=" PostgREST trusts the Clerk development instance $clerk_domain ($clerk_keys RSA key(s) with a Clerk kid)."
fi

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

echo "::notice::Local Supabase stack (Postgres $got_major): supabase start ${start_seconds}s, bootstrap and migrations ${schema_seconds}s.${trust_note}"
