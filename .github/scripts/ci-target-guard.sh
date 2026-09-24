#!/usr/bin/env bash
# CI target guard: refuse to run the gates unless every credential in the
# environment points at the CI Supabase project and the Clerk DEVELOPMENT
# instance. Both CI jobs run it as a preflight, so the two cannot drift.
#
# Why: the gates create and delete rows and Clerk users. Until the CI project
# existed they did it in production's database, and the existing secret names
# (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL) still
# mean production for seed-demo.yml and screenshots.yml. One wrong paste into
# a CI secret would point the suites back at production and they would pass.
# This script turns "CI runs on the CI project" from an assumption about
# secrets nobody can read back into a checked fact.
#
# Reads (the names the code reads; ci.yml maps the CI_* secrets onto them):
#   BIS_CI_SUPABASE_REF                literal in ci.yml: the CI project's ref
#   NEXT_PUBLIC_SUPABASE_URL           literal in ci.yml
#   NEXT_PUBLIC_SUPABASE_ANON_KEY      literal in ci.yml (publishable, not secret)
#   SUPABASE_SERVICE_ROLE_KEY          from secret CI_SUPABASE_SECRET_KEY
#   SUPABASE_DB_URL                    from secret CI_SUPABASE_DB_URL
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  from secret NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
#   CLERK_SECRET_KEY                   from secret CLERK_SECRET_KEY
#
# Checks, all reported together, then the probe only if all of them passed:
#   1. every value above is present;
#   2. NEXT_PUBLIC_SUPABASE_URL is exactly https://$BIS_CI_SUPABASE_REF.supabase.co,
#      and the production ref appears in no Supabase value at all;
#   3. SUPABASE_DB_URL is a postgres URI whose USER is exactly
#      postgres.$BIS_CI_SUPABASE_REF (the Session pooler's form);
#   4. neither Clerk key is a live (production-instance) key;
#   5. the secret key is not a publishable key, and it opens the CI project's
#      REST API (HTTP 200), with the failure named by status.
#
# The probe runs last on purpose: the secret key is only ever sent to a host
# the static checks have already accepted.
#
# NEVER prints a value: every message names a variable, never its content.
# Tested by apps/web/ci/ci-target-guard.test.ts (collected by `pnpm check`).

# Tracing off before anything touches a value. `bash -x`, or SHELLOPTS=xtrace
# in the environment, would otherwise print every assignment below, including
# DERIVED strings such as `user:password@host` that GitHub's log masking (which
# matches whole secret values only) would not hide. The braces and redirect
# keep the `set +x` line itself out of the trace.
{ set +x; } 2>/dev/null

set -u

PROD_REF="tlbkbmlrfafquucsmsmm"
failed=0

fail() {
  echo "::error::$1"
  failed=1
}

# Where a missing value comes from, so the message names the fix.
source_of() {
  case "$1" in
    SUPABASE_SERVICE_ROLE_KEY) echo "repository secret CI_SUPABASE_SECRET_KEY" ;;
    SUPABASE_DB_URL) echo "repository secret CI_SUPABASE_DB_URL" ;;
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | CLERK_SECRET_KEY) echo "repository secret $1" ;;
    *) echo "a literal in the env block of .github/workflows/ci.yml" ;;
  esac
}

ref="${BIS_CI_SUPABASE_REF:-}"
url="${NEXT_PUBLIC_SUPABASE_URL:-}"
anon="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
key="${SUPABASE_SERVICE_ROLE_KEY:-}"
db="${SUPABASE_DB_URL:-}"
clerk_pk="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
clerk_sk="${CLERK_SECRET_KEY:-}"

# --- 1. present -------------------------------------------------------------
for name in BIS_CI_SUPABASE_REF NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY; do
  if [ -z "${!name:-}" ]; then
    fail "$name is empty or missing; it comes from $(source_of "$name")."
  fi
done

# --- 2. the CI project, never production -----------------------------------
for name in BIS_CI_SUPABASE_REF NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL; do
  value="${!name:-}"
  case "${value,,}" in
    *"$PROD_REF"*)
      fail "$name names the production Supabase project ($PROD_REF). CI must never run against production; use the CI project's value."
      ;;
  esac
done

if [ -n "$ref" ]; then
  if ! [[ "$ref" =~ ^[a-z0-9]{20}$ ]]; then
    fail "BIS_CI_SUPABASE_REF is not shaped like a Supabase project ref (20 lowercase letters and digits)."
  elif [ -n "$url" ] && [ "$url" != "https://$ref.supabase.co" ]; then
    fail "NEXT_PUBLIC_SUPABASE_URL is not exactly https://$ref.supabase.co (the project BIS_CI_SUPABASE_REF names)."
  fi
fi

# --- 3. the CI project's Session pooler user --------------------------------
if [ -n "$db" ] && [ -n "$ref" ]; then
  case "$db" in
    postgres://* | postgresql://*)
      rest="${db#*://}"
      userinfo="${rest%@*}"   # up to the LAST @, so an @ in the password cannot move it
      user="${userinfo%%:*}"
      if [ "$rest" = "$userinfo" ] || [ "$user" != "postgres.$ref" ]; then
        fail "SUPABASE_DB_URL does not log in as postgres.<BIS_CI_SUPABASE_REF>. It must be the CI project's Session pooler URI (Supabase dashboard > Connect > Session pooler), whose user carries the project ref; the direct db.<ref>.supabase.co URI is IPv6-only and unreachable from a runner."
      fi
      ;;
    *)
      fail "SUPABASE_DB_URL is not a postgres:// URI. It must be the CI project's Session pooler URI (Supabase dashboard > Connect > Session pooler)."
      ;;
  esac
fi

# --- 4. Clerk's development instance -----------------------------------------
case "$clerk_pk" in
  pk_live_*) fail "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a pk_live_ key: the production Clerk instance. CI creates and deletes Clerk users and must use the development instance's pk_test_ key." ;;
esac
case "$clerk_sk" in
  sk_live_*) fail "CLERK_SECRET_KEY is an sk_live_ key: the production Clerk instance. CI creates and deletes Clerk users and must use the development instance's sk_test_ key." ;;
esac

# --- 5. the key opens the CI project ------------------------------------------
case "$key" in
  sb_publishable_*) fail "SUPABASE_SERVICE_ROLE_KEY is a publishable key (sb_publishable_), not a secret key. Put the CI project's secret key (sb_secret_) in CI_SUPABASE_SECRET_KEY." ;;
esac

if [ "$failed" -ne 0 ]; then
  echo "CI target guard: refused. Nothing was sent to any server."
  exit 1
fi

# The key travels on stdin (`--header @-`), never on curl's command line,
# where any process on the machine could read it. `-q` must stay curl's FIRST
# argument: it stops curl reading ~/.curlrc (or $CURL_HOME/.curlrc), where a
# `verbose` line would print the request headers, key included.
probe="$url/rest/v1/agencies?select=id&limit=1"
status="$(printf 'apikey: %s\n' "$key" |
  curl -q --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 --retry 2 --header @- "$probe")" || true

case "$status" in
  200)
    echo "CI target guard: CI Supabase project $ref and the Clerk development instance, confirmed."
    exit 0
    ;;
  401)
    fail "The CI project's REST API answered 401 to SUPABASE_SERVICE_ROLE_KEY: the key belongs to another project, or was revoked. Fix: Supabase dashboard > project $ref > Project Settings > API Keys, copy a secret key (sb_secret_) into the repository secret CI_SUPABASE_SECRET_KEY."
    ;;
  403)
    fail "The CI project's REST API answered 403: the key was accepted but has no privilege on public.agencies. The project's grants are missing (its default privileges were not set before the migrations were pushed). Fix: re-apply the CI project's bootstrap grants, then re-run."
    ;;
  404)
    fail "The CI project's REST API answered 404 for public.agencies: the migrations have not been pushed to project $ref. Fix: push the migrations to the CI project, then re-run."
    ;;
  000 | "")
    fail "Could not reach https://$ref.supabase.co at all: the project is paused (Free projects pause after a week without traffic) or unreachable. Fix: Supabase dashboard > project $ref > Restore project, wait for it to come up, then re-run."
    ;;
  *)
    fail "The CI project's REST API answered $status: the project is paused, unreachable or unhealthy. Fix: check Supabase dashboard > project $ref; if it is paused, Restore project, then re-run."
    ;;
esac

echo "CI target guard: refused."
exit 1
