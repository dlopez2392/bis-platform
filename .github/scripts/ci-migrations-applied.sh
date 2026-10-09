#!/usr/bin/env bash
# Refuses an e2e run whose branch carries a migration the CI project (bis-ci)
# has not been given.
#
# Why (2026-10-08, PR #200 review). CLAUDE.md: every new migration goes to the
# CI project FIRST (ci-project-setup.yml, push-dry-run then push), then
# production, then a parity check. Until verify moved to a stack inside its own
# runner, verify's db suite ran ON the CI project, so a branch whose migration
# had not reached it went red there, and that rule was enforced by accident.
# verify now builds its database from the branch's own files and passes either
# way, so without this a branch could merge, and deploy, a migration bis-ci
# never received. This step is now what enforces "CI project first".
#
# What it checks: every packages/db/supabase/migrations/<version>_<name>.sql in
# the checked-out tree has its <version> (the numeric prefix, which is what
# `supabase db push` records and keys on) in bis-ci's
# supabase_migrations.schema_migrations. A version bis-ci holds that this tree
# does not (another branch applied its migration first) is reported and is
# NOT a failure. It does not check production: e2e holds no production
# credential, and must not.
#
# Reads BIS_CI_SUPABASE_REF and BIS_CI_SUPABASE_DB_URL: the CI project's ref
# (a literal) and Session pooler URI (repository secret CI_SUPABASE_DB_URL),
# which ci.yml gives THIS STEP ALONE. Never SUPABASE_DB_URL: since 2026-10-08
# the e2e job runs on a throwaway stack in its own runner, the app's
# SUPABASE_DB_URL is that stack's, and the job holds no CI-project value for
# the app at all. Nothing ahead of this step checks the URL against bis-ci any
# more (the e2e guard now refuses every cloud value), so it is checked HERE,
# before psql sees it: production's ref nowhere, and exactly the form
#   postgres[ql]://postgres.<ref>:<password>@<host>.pooler.supabase.com:<5432|6543>/postgres[?sslmode=require]
# (the form packages/db/src/ci/target.ts accepts for the same secret). The
# read runs in ONE READ-ONLY TRANSACTION sent as one command (see the psql
# call for why one, not a session setting): this is a check, and bis-ci is
# shared with Vercel Preview and the screenshot capture. Never prints the URL.
# Needs bash and psql. A history it cannot read is a FAILURE, never a skip.
#
# Tested by apps/web/ci/ci-migrations-applied.test.ts (fake psql).

{ set +x; } 2>/dev/null
set -uo pipefail

MIGRATIONS_DIR="packages/db/supabase/migrations"
FIX="Push it to the CI project from this branch: gh workflow run ci-project-setup.yml --ref <this branch> -f step=push-dry-run (it must list exactly the new file), then -f step=push; then production, then parity (docs/runbooks/ci-supabase-project.md, section 6). Then re-run this job."

PROD_REF="tlbkbmlrfafquucsmsmm"
ref="${BIS_CI_SUPABASE_REF:-}"
db_url="${BIS_CI_SUPABASE_DB_URL:-}"
if [ -z "$ref" ]; then
  echo "::error::BIS_CI_SUPABASE_REF is empty or missing: it is a literal in this step's env in .github/workflows/ci.yml, the CI project's ref. Nothing was checked."
  exit 1
fi
if [ -z "$db_url" ]; then
  echo "::error::BIS_CI_SUPABASE_DB_URL is empty or missing: this step's env in .github/workflows/ci.yml maps the repository secret CI_SUPABASE_DB_URL onto it. Nothing was checked."
  exit 1
fi
case "${ref,,} ${db_url,,}" in
  *"$PROD_REF"*)
    echo "::error::BIS_CI_SUPABASE_REF or BIS_CI_SUPABASE_DB_URL names the production Supabase project ($PROD_REF). This check reads the CI project only. Nothing was checked."
    exit 1 ;;
esac
if ! [[ "$ref" =~ ^[a-z0-9]{20}$ ]]; then
  echo "::error::BIS_CI_SUPABASE_REF is not shaped like a Supabase project ref (20 lowercase letters and digits). Nothing was checked."
  exit 1
fi
if ! [[ "$db_url" =~ ^postgres(ql)?://postgres\.${ref}:[A-Za-z0-9._~%-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com:(5432|6543)/postgres(\?sslmode=require)?$ ]]; then
  echo "::error::BIS_CI_SUPABASE_DB_URL is not the CI project's Session pooler URI (user postgres.$ref on a *.pooler.supabase.com host, database postgres, no query but sslmode=require). Fix: Supabase dashboard > project $ref > Connect > Session pooler, into the repository secret CI_SUPABASE_DB_URL. Nothing was checked."
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "::error::psql is not on PATH (it ships with GitHub's ubuntu runners). Nothing was checked."
  exit 1
fi

files=()
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$f" ] || continue
  files+=("${f##*/}")
done
if [ "${#files[@]}" -eq 0 ]; then
  echo "::error::No migration files found under $MIGRATIONS_DIR. Run this from the repository root."
  exit 1
fi

# ONE command, ONE read-only transaction. The URL check above admits the
# transaction pooler (6543), which may run each transaction on a different
# server connection: a separate `set session characteristics … read only`
# could land on one and the read on another, read-write. A single query
# string holding begin…commit is one transaction, kept on one connection by
# either pooler. (psql 15+ prints every statement's result from one -c; -q
# drops the BEGIN/COMMIT tags, and only digit lines are read below anyway.)
if ! applied_raw="$(psql "$db_url" -X -q -tA -v ON_ERROR_STOP=1 \
  -c "begin transaction read only; select version from supabase_migrations.schema_migrations order by version; commit;")"; then
  echo "::error::Could not read the CI project's migration history (supabase_migrations.schema_migrations); psql's own message is above. A gate that cannot check is red, not skipped: re-run once, and if it fails again, check the CI project (docs/runbooks/ci-supabase-project.md)."
  exit 1
fi

declare -A applied=()
while IFS= read -r line; do
  v="$(printf '%s' "$line" | tr -d '[:space:]')"
  # Versions only: a status line psql printed (e.g. SET) is not a migration.
  [[ "$v" =~ ^[0-9]+$ ]] && applied["$v"]=1
done <<< "$applied_raw"

declare -A local_versions=()
missing=0
for file in "${files[@]}"; do
  if ! [[ "$file" =~ ^([0-9]+)_.+\.sql$ ]]; then
    echo "::error::$MIGRATIONS_DIR/$file is not named <version>_<name>.sql, so \`supabase db push\` would not apply it as a migration."
    missing=$((missing + 1))
    continue
  fi
  version="${BASH_REMATCH[1]}"
  local_versions["$version"]=1
  if [ -z "${applied[$version]:-}" ]; then
    echo "::error::Migration $file is in this branch but NOT applied to the CI project (bis-ci). $FIX"
    missing=$((missing + 1))
  fi
done

extra=0
for v in "${!applied[@]}"; do
  [ -n "${local_versions[$v]:-}" ] || extra=$((extra + 1))
done

if [ "$missing" -ne 0 ]; then
  echo "Migration check: refused. $missing migration file(s) of this branch are not on the CI project; each is named above."
  exit 1
fi

if [ "$extra" -ne 0 ]; then
  echo "::notice::The CI project holds $extra migration(s) this branch does not have (another branch applied first). Not a failure; merge main to pick them up."
fi
echo "Migration check: all ${#files[@]} migration files of this branch are applied to the CI project."
