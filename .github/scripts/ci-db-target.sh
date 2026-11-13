# Target rules for the migration runner (sourced by migrations-apply.sh; plan
# docs/superpowers/plans/2026-11-13-migration-pipeline.md, D2, D3, D6).
#
# `db_target <target>` checks the environment for that target BEFORE anything
# connects, and on success sets:
#   DB_URL      the target database (env BIS_MIGRATIONS_DB_URL)
#   DB_RULES    bis-ci | production: which history rules apply (D1)
#   BISCI_URL   production rules only: bis-ci, read only, to compare against
#               (env BIS_MIGRATIONS_BISCI_DB_URL)
# On a refusal it prints ::error:: naming the VARIABLE (never its value) and
# returns 1.
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

DB_PROD_REF="tlbkbmlrfafquucsmsmm"

# A Supabase Session-pooler URL for user postgres.<ref>, database postgres, no
# query but sslmode=require. $3: the ports allowed, as a regex alternation.
_db_is_pooler() {
  [[ "$1" =~ ^postgres(ql)?://postgres\.$2:[A-Za-z0-9._~%-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com:($3)/postgres(\?sslmode=require)?$ ]]
}

_db_is_loopback() {
  [[ "$1" =~ ^postgres(ql)?://[A-Za-z0-9._~%-]+(:[A-Za-z0-9._~%-]*)?@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/[A-Za-z0-9_]+$ ]] || return 1
  case "${1,,}" in *"$DB_PROD_REF"*|*supabase*) return 1 ;; esac
}

_db_refuse() { echo "::error::$1 Nothing was read or applied."; return 1; }

db_target() {
  DB_URL="${BIS_MIGRATIONS_DB_URL:-}"
  BISCI_URL=""
  [ -n "$DB_URL" ] || { _db_refuse "BIS_MIGRATIONS_DB_URL is empty or missing: it names the database to apply to."; return 1; }
  case "$1" in
    bis-ci)
      DB_RULES="bis-ci"
      local ref="${BIS_CI_SUPABASE_REF:-}"
      case "${ref,,} ${DB_URL,,}" in
        *"$DB_PROD_REF"*) _db_refuse "BIS_CI_SUPABASE_REF or BIS_MIGRATIONS_DB_URL names the production project ($DB_PROD_REF); --target bis-ci applies to the CI project only."; return 1 ;;
      esac
      [[ "$ref" =~ ^[a-z0-9]{20}$ ]] || { _db_refuse "BIS_CI_SUPABASE_REF is missing or not a 20-character project ref."; return 1; }
      _db_is_pooler "$DB_URL" "$ref" "5432" || { _db_refuse "BIS_MIGRATIONS_DB_URL is not the CI project's Session pooler URI (user postgres.$ref on a *.pooler.supabase.com host, port 5432, database postgres, no query but sslmode=require)."; return 1; }
      ;;
    production)
      DB_RULES="production"
      [ "${GITHUB_ACTIONS:-}" = "true" ] || { _db_refuse "--target production runs only inside GitHub Actions (GITHUB_ACTIONS=true), in the production-migrations environment. By hand, production is the MCP procedure (runbook section 6)."; return 1; }
      _db_is_pooler "$DB_URL" "$DB_PROD_REF" "5432" || { _db_refuse "BIS_MIGRATIONS_DB_URL is not production's Session pooler URI (user postgres.$DB_PROD_REF, port 5432)."; return 1; }
      BISCI_URL="${BIS_MIGRATIONS_BISCI_DB_URL:-}"
      local ref="${BIS_CI_SUPABASE_REF:-}"
      [[ "$ref" =~ ^[a-z0-9]{20}$ ]] && [ "$ref" != "$DB_PROD_REF" ] || { _db_refuse "BIS_CI_SUPABASE_REF is missing or not the CI project's ref: production is compared with bis-ci first."; return 1; }
      _db_is_pooler "$BISCI_URL" "$ref" "5432|6543" || { _db_refuse "BIS_MIGRATIONS_BISCI_DB_URL is not the CI project's pooler URI: production applies only what bis-ci already holds."; return 1; }
      ;;
    local-as-bis-ci|local-as-production)
      DB_RULES="${1#local-as-}"
      _db_is_loopback "$DB_URL" || { _db_refuse "BIS_MIGRATIONS_DB_URL is not a loopback Postgres URL: --target $1 is for the runner's own tests."; return 1; }
      if [ "$DB_RULES" = "production" ]; then
        BISCI_URL="${BIS_MIGRATIONS_BISCI_DB_URL:-}"
        _db_is_loopback "$BISCI_URL" || { _db_refuse "BIS_MIGRATIONS_BISCI_DB_URL is not a loopback Postgres URL: --target $1 is for the runner's own tests."; return 1; }
      fi
      ;;
    *)
      echo "::error::Unknown target '$1': bis-ci, production, local-as-bis-ci or local-as-production."
      return 2 ;;
  esac
}
