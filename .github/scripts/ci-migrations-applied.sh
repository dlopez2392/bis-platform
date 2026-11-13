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
# the checked-out tree has a row in bis-ci's
# supabase_migrations.schema_migrations with the same PAIR (version, name):
# the numeric prefix and the rest of the stem, which is what `supabase db
# push` records (all 116 of bis-ci's legacy rows have this form, read in the
# review of #365). A numbered file (0001..0116) is also found by a row whose
# name is its whole stem, the form of SOME of production's MCP rows (whose
# version is the moment of the apply). The other 61 of production's legacy rows
# (0032, 0042-0045, 0060-0115) record the slug alone; matching those is the
# production check's job (plan PR 3), not this bis-ci read. Never by version
# alone (since 2026-11-13, when new files became timestamped,
# YYYYMMDDHHMMSS_slug.sql): an MCP row's apply timestamp can equal a new file's
# version, and a row with the file's version under another name is another
# migration, reported as such. A row bis-ci holds that this tree does
# not match (another branch applied its migration first) is reported and is
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
# (the form packages/db/src/ci/target.ts accepts for the same secret; the
# password valid percent-encoding, checked by ci-db-target.sh's parser). The
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
# The URL rule is the migration runner's (.github/scripts/ci-db-target.sh): one
# parser for both, including a password that must be valid percent-encoding,
# never %00, since psql echoes back one it cannot decode.
# shellcheck source=ci-db-target.sh
. "$(dirname "${BASH_SOURCE[0]}")/ci-db-target.sh"
if ! _db_is_pooler "$db_url" "$ref" "5432|6543"; then
  echo "::error::BIS_CI_SUPABASE_DB_URL is not the CI project's Session pooler URI (user postgres.$ref on a *.pooler.supabase.com host, database postgres, a percent-encoded password, no query but sslmode=require). Fix: Supabase dashboard > project $ref > Connect > Session pooler, into the repository secret CI_SUPABASE_DB_URL. Nothing was checked."
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
# drops the BEGIN/COMMIT tags, and only `<digits>|<name>` rows are read below
# anyway.)
# The password goes to psql in PGPASSWORD, never on its command line (which `ps`
# shows), and over TLS; the connection string carries everything else.
_db_conn
if ! applied_raw="$(PGPASSWORD="$_DB_PASS" PGSSLMODE=require psql "$_DB_CONN" -X -q -tA -v ON_ERROR_STOP=1 \
  -c "begin transaction read only; select version, name from supabase_migrations.schema_migrations order by version; commit;")"; then
  echo "::error::Could not read the CI project's migration history (supabase_migrations.schema_migrations); psql's own message is above. A gate that cannot check is red, not skipped: re-run once, and if it fails again, check the CI project (docs/runbooks/ci-supabase-project.md)."
  exit 1
fi

# psql -tA prints each row as `version|name`. Rows only: a status line psql
# printed (e.g. SET) is not a migration.
declare -A applied_pair=()    # "version|name" -> 1
declare -A applied_name=()    # name -> its row's "version|name"
declare -A version_names=()   # version -> the names recorded under it
while IFS= read -r line; do
  row="$(printf '%s' "$line" | tr -d '[:space:]')"
  [[ "$row" =~ ^([0-9]+)\|(.*)$ ]] || continue
  applied_pair["$row"]=1
  if [ -n "${BASH_REMATCH[2]}" ]; then
    applied_name["${BASH_REMATCH[2]}"]="$row"
    version_names["${BASH_REMATCH[1]}"]+="${version_names[${BASH_REMATCH[1]}]:+, }${BASH_REMATCH[2]}"
  fi
done <<< "$applied_raw"

declare -A matched=()   # the rows some file of this tree matched
missing=0
for file in "${files[@]}"; do
  if ! [[ "$file" =~ ^([0-9]+)_(.+)\.sql$ ]]; then
    echo "::error::$MIGRATIONS_DIR/$file is not named <version>_<name>.sql, so \`supabase db push\` would not apply it as a migration."
    missing=$((missing + 1))
    continue
  fi
  version="${BASH_REMATCH[1]}"
  name="${BASH_REMATCH[2]}"
  stem="${file%.sql}"
  if [ -n "${applied_pair[$version|$name]:-}" ]; then
    matched["$version|$name"]=1
  elif [ "${#version}" -eq 4 ] && [ -n "${applied_name[$stem]:-}" ]; then
    matched["${applied_name[$stem]}"]=1
  elif [ -n "${version_names[$version]:-}" ]; then
    echo "::error::Migration $file is in this branch, but the CI project (bis-ci) records its version $version under another name (${version_names[$version]}): that is another migration. If it is not this file, give this one a new version: create it again with pnpm --filter @bis/db migration:new <slug> and move the SQL into it."
    missing=$((missing + 1))
  else
    echo "::error::Migration $file is in this branch but NOT applied to the CI project (bis-ci). $FIX"
    missing=$((missing + 1))
  fi
done

extra=0
for row in "${!applied_pair[@]}"; do
  [ -n "${matched[$row]:-}" ] || extra=$((extra + 1))
done

if [ "$missing" -ne 0 ]; then
  echo "Migration check: refused. $missing migration file(s) of this branch are not on the CI project; each is named above."
  exit 1
fi

if [ "$extra" -ne 0 ]; then
  echo "::notice::The CI project holds $extra migration(s) this branch does not have (another branch applied first). Not a failure; merge main to pick them up."
fi
echo "Migration check: all ${#files[@]} migration files of this branch are applied to the CI project."
