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
# Reads SUPABASE_DB_URL (the CI project's Session pooler URI, which the e2e
# job's guard has already accepted). Never prints it. Needs bash and psql.
# A history it cannot read is a FAILURE, never a skip.
#
# Tested by apps/web/ci/ci-migrations-applied.test.ts (fake psql).

{ set +x; } 2>/dev/null
set -uo pipefail

MIGRATIONS_DIR="packages/db/supabase/migrations"
FIX="Push it to the CI project from this branch: gh workflow run ci-project-setup.yml --ref <this branch> -f step=push-dry-run (it must list exactly the new file), then -f step=push; then production, then parity (docs/runbooks/ci-supabase-project.md, section 6). Then re-run this job."

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "::error::SUPABASE_DB_URL is empty or missing: the e2e job maps the CI project's repository secret CI_SUPABASE_DB_URL onto it. Nothing was checked."
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

if ! applied_raw="$(psql "$SUPABASE_DB_URL" -X -tA -v ON_ERROR_STOP=1 \
  -c "select version from supabase_migrations.schema_migrations order by version")"; then
  echo "::error::Could not read the CI project's migration history (supabase_migrations.schema_migrations); psql's own message is above. A gate that cannot check is red, not skipped: re-run once, and if it fails again, check the CI project (docs/runbooks/ci-supabase-project.md)."
  exit 1
fi

declare -A applied=()
while IFS= read -r line; do
  v="$(printf '%s' "$line" | tr -d '[:space:]')"
  [ -n "$v" ] && applied["$v"]=1
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
