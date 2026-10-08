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
#   STRIPE_SECRET_KEY                  from secret CI_STRIPE_SECRET_KEY (e2e job only; OPTIONAL)
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
#   6. STRIPE_SECRET_KEY, when set, is a Stripe TEST-mode secret key
#      (sk_test_ or rk_test_), never a live one. It is optional: only the e2e
#      job carries it, and the one spec that needs it skips itself loudly
#      without it. The guard never sends it anywhere.
#
# The probe runs last on purpose: the secret key is only ever sent to a host
# the static checks have already accepted.
#
# MODES (2026-10-08). The checks above are the DEFAULT, with no argument: the
# e2e job, which runs on the shared CI project. The verify job runs on a
# throwaway Supabase stack it starts inside its own runner
# (.github/scripts/ci-local-supabase.sh), so it has no CI-project value to
# check, and runs this script twice instead:
#
#   --before-local-stack  straight after checkout, before that stack exists.
#       The Clerk keys must be present and the development instance's (check
#       4), a Stripe key must be a test key (check 6), and NONE of the five
#       Supabase values above may be set at all: verify holds no cloud
#       project's credential, so one that is set leaked in from ci.yml's env
#       (they belong to e2e's job env) and would aim the suites at a shared
#       project. Sends nothing anywhere.
#   --local-stack  once the stack is up and has written its values to
#       GITHUB_ENV. The four values the code reads must all be present;
#       NEXT_PUBLIC_SUPABASE_URL must be exactly http://<loopback>:<port>
#       and SUPABASE_DB_URL a postgres URI on the loopback with no query
#       string (node-pg reads a `host=` there over the URI's own host);
#       production's ref may appear nowhere, Clerk is checked as above, and
#       the probe goes to that loopback API with the stack's service key.
#
# Any other argument, or more than one, is refused before anything is
# checked, so a typo can never select a weaker mode.
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

# --- mode ---------------------------------------------------------------------
# The argument is never echoed: it names a mode, and anything else is refused.
mode="ci-project"
if [ "$#" -gt 1 ]; then
  mode="unknown"
else
  case "${1:-}" in
    "") ;;
    --before-local-stack) mode="before-local-stack" ;;
    --local-stack) mode="local-stack" ;;
    *) mode="unknown" ;;
  esac
fi
if [ "$mode" = "unknown" ]; then
  echo "::error::ci-target-guard.sh takes no argument, --before-local-stack or --local-stack (one at most). Nothing was checked and nothing was sent."
  exit 1
fi

# Where a missing value comes from, so the message names the fix.
source_of() {
  case "$1" in
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | CLERK_SECRET_KEY) echo "repository secret $1"; return ;;
  esac
  if [ "$mode" = "local-stack" ]; then
    echo "the step that starts verify's local Supabase stack (.github/scripts/ci-local-supabase.sh), which writes it to GITHUB_ENV from \`supabase status\`"
    return
  fi
  case "$1" in
    SUPABASE_SERVICE_ROLE_KEY) echo "repository secret CI_SUPABASE_SECRET_KEY" ;;
    SUPABASE_DB_URL) echo "repository secret CI_SUPABASE_DB_URL" ;;
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
stripe_key="${STRIPE_SECRET_KEY:-}"

# --- 1. present -------------------------------------------------------------
case "$mode" in
  ci-project)
    required="BIS_CI_SUPABASE_REF NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY" ;;
  before-local-stack)
    required="NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY" ;;
  local-stack)
    required="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY" ;;
esac
for name in $required; do
  if [ -z "${!name:-}" ]; then
    fail "$name is empty or missing; it comes from $(source_of "$name")."
  fi
done

# --- 1b. before the local stack: no Supabase value at all ----------------------
if [ "$mode" = "before-local-stack" ]; then
  for name in BIS_CI_SUPABASE_REF NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL; do
    if [ -n "${!name:-}" ]; then
      fail "$name is set before verify's local Supabase stack exists. verify runs on a stack it starts inside its own runner and holds no cloud project's value; the CI project's values belong in the e2e job's env in .github/workflows/ci.yml, never the workflow-level env."
    fi
  done
fi

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

if [ "$mode" = "ci-project" ] && [ -n "$ref" ]; then
  if ! [[ "$ref" =~ ^[a-z0-9]{20}$ ]]; then
    fail "BIS_CI_SUPABASE_REF is not shaped like a Supabase project ref (20 lowercase letters and digits)."
  elif [ -n "$url" ] && [ "$url" != "https://$ref.supabase.co" ]; then
    fail "NEXT_PUBLIC_SUPABASE_URL is not exactly https://$ref.supabase.co (the project BIS_CI_SUPABASE_REF names)."
  fi
fi

# --- 2L. the local stack's API, on the runner's loopback ------------------------
# Exactly http://<loopback>:<port>, the form `supabase status` prints: no path
# (the probe appends one), no userinfo, no TLS (the local stack has none).
if [ "$mode" = "local-stack" ] && [ -n "$url" ]; then
  if ! [[ "$url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]{1,5}$ ]]; then
    fail "NEXT_PUBLIC_SUPABASE_URL is not the local stack's API: it must be exactly http://127.0.0.1:<port> (or localhost), as \`supabase status\` prints it. verify never runs on a cloud project."
  fi
fi

# --- 3L. the local stack's database, on the runner's loopback -------------------
# The WHOLE URL is anchored, as `supabase status` prints it: userinfo with no
# @ / ? # in it, the loopback host, an optional port, a database name, and
# nothing after. Taking the host "after the last @" let an @ in the path or
# the fragment carry a loopback address while the real host was elsewhere
# (PR #200 review); and a query string can carry host=, which node-pg obeys.
if [ "$mode" = "local-stack" ] && [ -n "$db" ]; then
  if ! [[ "$db" =~ ^postgres(ql)?://[^@/?#]+@(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/[A-Za-z0-9_]+$ ]]; then
    fail "SUPABASE_DB_URL is not the local stack's database: it must be a postgres:// URI on 127.0.0.1 (or localhost) with no query string, as \`supabase status\` prints it. verify never connects to a cloud project."
  fi
fi

# --- 3. the CI project's Session pooler user --------------------------------
if [ "$mode" = "ci-project" ] && [ -n "$db" ] && [ -n "$ref" ]; then
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

# --- 6. Stripe test mode (optional) --------------------------------------------
# CI creates Stripe products and prices (e2e/plans.spec.ts). A live key would
# create them in the LIVE Stripe account, beside real customers' billing.
if [ -n "$stripe_key" ]; then
  case "$stripe_key" in
    sk_live_* | rk_live_*)
      fail "STRIPE_SECRET_KEY is a live-mode Stripe key. CI creates products and prices and must use a test-mode key (sk_test_). Put the Stripe TEST secret key in the repository secret CI_STRIPE_SECRET_KEY."
      ;;
    sk_test_* | rk_test_*) ;;
    *)
      fail "STRIPE_SECRET_KEY is not a Stripe test-mode secret key (sk_test_ or rk_test_). Put the Stripe TEST secret key in the repository secret CI_STRIPE_SECRET_KEY."
      ;;
  esac
fi

if [ "$failed" -ne 0 ]; then
  echo "CI target guard: refused. Nothing was sent to any server."
  exit 1
fi

if [ "$mode" = "before-local-stack" ]; then
  echo "CI target guard: no cloud Supabase value in scope before verify's local stack starts, and the Clerk development instance, confirmed. The stack's own values are checked by --local-stack once it is up."
  exit 0
fi

# The key travels on stdin (`--header @-`), never on curl's command line,
# where any process on the machine could read it. `-q` must stay curl's FIRST
# argument: it stops curl reading ~/.curlrc (or $CURL_HOME/.curlrc), where a
# `verbose` line would print the request headers, key included.
probe="$url/rest/v1/agencies?select=id&limit=1"

if [ "$mode" = "local-stack" ]; then
  # The local stack's service key is a JWT, which PostgREST reads from the
  # Authorization header; the gateway wants it as apikey too, as supabase-js
  # sends it.
  status="$(printf 'apikey: %s\nAuthorization: Bearer %s\n' "$key" "$key" |
    curl -q --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --max-time 20 --retry 2 --header @- "$probe")" || true

  case "$status" in
    200)
      echo "CI target guard: verify's local Supabase stack on this runner's loopback, and the Clerk development instance, confirmed."
      exit 0
      ;;
    401)
      fail "The local stack's REST API answered 401 to SUPABASE_SERVICE_ROLE_KEY: it is not this local stack's service-role key. .github/scripts/ci-local-supabase.sh maps it from \`supabase status\`; check which variable it read."
      ;;
    403)
      fail "The local stack's REST API answered 403: the key was accepted but has no privilege on public.agencies. The bootstrap's default privileges (packages/db/supabase/bootstrap/ci-project.sql) did not take effect before the migrations; see the step that starts the stack."
      ;;
    404)
      fail "The local stack's REST API answered 404 for public.agencies: the migrations were not applied to the local stack. See the step that starts it."
      ;;
    000 | "")
      fail "Could not reach the local stack's API at all: \`supabase start\` did not finish, or the stack has stopped. See the step that starts it."
      ;;
    *)
      fail "The local stack's REST API answered $status: the stack is unhealthy. See the step that starts it."
      ;;
  esac
  echo "CI target guard: refused."
  exit 1
fi

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
