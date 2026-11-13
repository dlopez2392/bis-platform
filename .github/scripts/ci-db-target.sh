# Target rules for the migration runner (sourced by migrations-apply.sh, whose
# --check is the bis-ci history check since ci-migrations-applied.sh retired
# in PR 4; plan
# docs/superpowers/plans/2026-11-13-migration-pipeline.md, D2, D3, D6).
#
# `db_target <target>` checks the environment for that target BEFORE anything
# connects, and on success sets:
#   DB_CONN, DB_PASS        the target database (env BIS_MIGRATIONS_DB_URL),
#                           as a connection string WITHOUT the password and the
#                           password, decoded, for PGPASSWORD: psql's command
#                           line, which `ps` shows, never carries it
#   DB_RULES                bis-ci | production: which history rules apply (D1)
#   DB_TLS                  require for the hosted targets, empty on loopback
#   BISCI_CONN, BISCI_PASS  production rules only: bis-ci, read only, to compare
#                           against (env BIS_MIGRATIONS_BISCI_DB_URL)
# On a refusal it prints ::error:: naming the VARIABLE (never its value) and
# returns 1 (2 for an unknown target).
#
#   bis-ci               the CI project's Session pooler URL, user
#                        postgres.<BIS_CI_SUPABASE_REF>, port 5432 (a session,
#                        for the one transaction per file); production's ref
#                        nowhere.
#   production           production's Session pooler URL, user
#                        postgres.tlbkbmlrfafquucsmsmm, port 5432; only inside
#                        GitHub Actions (GITHUB_ACTIONS=true); and bis-ci's URL
#                        beside it (5432 or 6543: it is only read).
#   local-as-bis-ci,     a loopback Postgres (127.0.0.1, localhost or [::1]),
#   local-as-production  for the runner's own tests: the same rules as the
#                        real target, never a remote host, never production's
#                        ref, never a Supabase host.
#
# A password must be valid percent-encoding: unreserved characters and %XX,
# never %00. psql echoes a password it cannot decode back in its own error
# ("invalid percent-encoded token: ..."), so a bad one is refused here.

DB_PROD_REF="tlbkbmlrfafquucsmsmm"

# Splits a postgres URL into _P_USER, _P_PASS (still encoded), _P_HOST,
# _P_PORT, _P_DB and _P_QUERY. Returns 1 on anything outside that shape.
_db_parse() {
  local rest userinfo
  _P_USER="" _P_PASS="" _P_HOST="" _P_PORT="" _P_DB="" _P_QUERY=""
  [[ "$1" =~ ^postgres(ql)?://(.*)$ ]] || return 1
  rest="${BASH_REMATCH[2]}"
  [[ "$rest" == *@* ]] || return 1
  userinfo="${rest%%@*}"; rest="${rest#*@}"
  if [[ "$userinfo" == *:* ]]; then _P_USER="${userinfo%%:*}"; _P_PASS="${userinfo#*:}"; else _P_USER="$userinfo"; fi
  [[ "$_P_USER" =~ ^[A-Za-z0-9._~-]+$ ]] || return 1
  if [ -n "$_P_PASS" ]; then
    [[ "$_P_PASS" =~ ^([A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$ ]] || return 1
    [[ "${_P_PASS,,}" != *%00* ]] || return 1
  fi
  [[ "$rest" =~ ^([a-z0-9.-]+|\[::1\])(:([0-9]+))?/([A-Za-z0-9_]+)(\?(.*))?$ ]] || return 1
  _P_HOST="${BASH_REMATCH[1]}"; _P_PORT="${BASH_REMATCH[3]}"; _P_DB="${BASH_REMATCH[4]}"; _P_QUERY="${BASH_REMATCH[6]}"
}

# A Supabase Session-pooler URL for user postgres.<ref> with a password,
# database postgres, no query but sslmode=require. $3: the ports allowed, as a
# regex alternation.
_db_is_pooler() {
  _db_parse "$1" || return 1
  [ "$_P_USER" = "postgres.$2" ] && [ -n "$_P_PASS" ] \
    && [[ "$_P_HOST" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com$ ]] \
    && [[ "$_P_PORT" =~ ^($3)$ ]] && [ "$_P_DB" = "postgres" ] \
    && { [ -z "$_P_QUERY" ] || [ "$_P_QUERY" = "sslmode=require" ]; }
}

_db_is_loopback() {
  _db_parse "$1" || return 1
  [[ "$_P_HOST" =~ ^(127\.0\.0\.1|localhost|\[::1\])$ ]] && [ -z "$_P_QUERY" ] || return 1
  case "${1,,}" in *"$DB_PROD_REF"*|*supabase*) return 1 ;; esac
}

# After a successful _db_is_*: the connection string without the password, and
# the password decoded.
_db_conn() { _DB_CONN="postgresql://$_P_USER@$_P_HOST${_P_PORT:+:$_P_PORT}/$_P_DB"; _DB_PASS="$(printf '%b' "${_P_PASS//%/\\x}")"; }

_db_refuse() { echo "::error::$1 Nothing was read or applied."; return 1; }

db_target() {
  local url="${BIS_MIGRATIONS_DB_URL:-}" bisci="${BIS_MIGRATIONS_BISCI_DB_URL:-}" ref="${BIS_CI_SUPABASE_REF:-}"
  DB_CONN="" DB_PASS="" DB_TLS="" BISCI_CONN="" BISCI_PASS=""
  if [ -z "$url" ] && [ "$1" = "production" ]; then
    # ci.yml maps secrets.PROD_MIGRATIONS_DB_URL here. An absent secret reads
    # as empty, so this is what a missing environment or secret looks like.
    _db_refuse "PROD_MIGRATIONS_DB_URL is not set: it is a secret of the production-migrations environment only, which the owner creates by hand (plan section 3; runbook section 6). Never a repository secret."
    return 1
  fi
  [ -n "$url" ] || { _db_refuse "BIS_MIGRATIONS_DB_URL is empty or missing: it names the database to apply to."; return 1; }
  case "$1" in
    bis-ci)
      DB_RULES="bis-ci"; DB_TLS="require"
      case "${ref,,} ${url,,}" in
        *"$DB_PROD_REF"*) _db_refuse "BIS_CI_SUPABASE_REF or BIS_MIGRATIONS_DB_URL names the production project ($DB_PROD_REF); --target bis-ci applies to the CI project only."; return 1 ;;
      esac
      [[ "$ref" =~ ^[a-z0-9]{20}$ ]] || { _db_refuse "BIS_CI_SUPABASE_REF is missing or not a 20-character project ref."; return 1; }
      _db_is_pooler "$url" "$ref" "5432" || { _db_refuse "BIS_MIGRATIONS_DB_URL is not the CI project's Session pooler URI (user postgres.$ref on a *.pooler.supabase.com host, port 5432, database postgres, a percent-encoded password, no query but sslmode=require)."; return 1; }
      _db_conn; DB_CONN="$_DB_CONN"; DB_PASS="$_DB_PASS"
      ;;
    production)
      DB_RULES="production"; DB_TLS="require"
      [ "${GITHUB_ACTIONS:-}" = "true" ] || { _db_refuse "--target production runs only inside GitHub Actions (GITHUB_ACTIONS=true), in the production-migrations environment. By hand, production is the MCP procedure (runbook section 6)."; return 1; }
      _db_is_pooler "$url" "$DB_PROD_REF" "5432" || { _db_refuse "BIS_MIGRATIONS_DB_URL is not production's Session pooler URI (user postgres.$DB_PROD_REF on a *.pooler.supabase.com host, port 5432, a percent-encoded password)."; return 1; }
      _db_conn; DB_CONN="$_DB_CONN"; DB_PASS="$_DB_PASS"
      [[ "$ref" =~ ^[a-z0-9]{20}$ ]] && [ "$ref" != "$DB_PROD_REF" ] || { _db_refuse "BIS_CI_SUPABASE_REF is missing or not the CI project's ref: production is compared with bis-ci first."; return 1; }
      _db_is_pooler "$bisci" "$ref" "5432|6543" || { _db_refuse "BIS_MIGRATIONS_BISCI_DB_URL is not the CI project's pooler URI: production applies only what bis-ci already holds."; return 1; }
      _db_conn; BISCI_CONN="$_DB_CONN"; BISCI_PASS="$_DB_PASS"
      ;;
    local-as-bis-ci|local-as-production)
      DB_RULES="${1#local-as-}"
      _db_is_loopback "$url" || { _db_refuse "BIS_MIGRATIONS_DB_URL is not a loopback Postgres URL (with a percent-encoded password, no query): --target $1 is for the runner's own tests."; return 1; }
      _db_conn; DB_CONN="$_DB_CONN"; DB_PASS="$_DB_PASS"
      if [ "$DB_RULES" = "production" ]; then
        _db_is_loopback "$bisci" || { _db_refuse "BIS_MIGRATIONS_BISCI_DB_URL is not a loopback Postgres URL: --target $1 is for the runner's own tests."; return 1; }
        _db_conn; BISCI_CONN="$_DB_CONN"; BISCI_PASS="$_DB_PASS"
      fi
      ;;
    *)
      echo "::error::Unknown target '$1': bis-ci, production, local-as-bis-ci or local-as-production."
      return 2 ;;
  esac
}
