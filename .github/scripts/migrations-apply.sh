#!/usr/bin/env bash
# The migration runner (docs/superpowers/plans/2026-11-13-migration-pipeline.md,
# D1-D3, D5; PR 3). Nothing in CI calls it yet: PR 4 runs it against bis-ci,
# PR 5 against production behind the owner's approval.
#
#   migrations-apply.sh --target <target> [--dry-run | --check] [FILE...]
#
# FILE: the timestamped migrations this branch ADDS
# (packages/db/supabase/migrations/YYYYMMDDHHMMSS_slug.sql). Every other file
# in the tree is main's, and must already be applied. Targets and their
# environment: .github/scripts/ci-db-target.sh. Run from the repository root.
#
# What it does, in order. Anything refused stops it before a single write:
#  1. Reads the target's history (supabase_migrations.schema_migrations) in ONE
#     read-only transaction sent as one command.
#  2. Every file it was NOT given must be covered by a history row (D1): the
#     pair (version, name); on production rules also the whole stem in `name`
#     (the MCP's form), and, for a NUMBERED file only, its slug alone, if
#     exactly one such row has it (A3: 0032, 0042-0045, 0060-0115). A file
#     missing means the target is behind main: refused.
#  3. Each FILE already covered must have the content it was recorded with,
#     when this runner recorded it: append-only, an edit is refused.
#  4. Each FILE still pending: its version must not be recorded under another
#     name; on bis-ci rules it must be newer than every 14-digit version there
#     (so bis-ci's apply order is file order); on production rules it must be
#     on bis-ci already, recorded by this runner with the same content.
#  5. --dry-run stops here and lists what would apply; --check stops here and
#     fails if anything would.
#  6. Applies each pending FILE in name order, each in ONE transaction: lock the
#     history table (two runners cannot interleave), lock_timeout 5s (it fails
#     rather than queue behind live traffic), statement_timeout 10min, the file,
#     then its history row: version, name, statements = [the file's exact text,
#     the marker below]. Errors are terse, with no context, so a failing
#     constraint cannot print a customer's row into a public log.
#  7. Reads the history again: every file it applied must now be recorded, with
#     its content.
#
# A failed file leaves neither its changes nor its row; the files before it in
# the run stay applied and recorded. NOTHING IS RETRIED: one attempt per run.
# Exits 0 on success, 1 on any refusal or failure, 2 on bad usage. Prints file
# names, versions and psql's own terse errors; never a URL.
#
# Tested by apps/web/ci/migrations-apply.test.ts (fake psql: targets, files, D1)
# and apps/web/ci/migrations-apply.live.test.ts (a real, throwaway Postgres).

{ set +x; } 2>/dev/null
set -uo pipefail

DIR="packages/db/supabase/migrations"
SEP=$'\x1f'
# The second element of every history row this runner writes. A row without it
# (the CLI splits a file into statements; the MCP records what it records) has
# no content this runner can compare. It is a SQL comment, so it is valid SQL.
MARKER="-- applied by .github/scripts/migrations-apply.sh"

usage() {
  echo "usage: migrations-apply.sh --target <bis-ci|production|local-as-bis-ci|local-as-production> [--dry-run|--check] [FILE...]"
  exit 2
}

target=""
mode="apply"
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) [ "$#" -ge 2 ] || usage; target="$2"; shift 2 ;;
    --dry-run) mode="dry-run"; shift ;;
    --check) mode="check"; shift ;;
    -*) usage ;;
    *) args+=("$1"); shift ;;
  esac
done
[ -n "$target" ] || usage

# shellcheck source=ci-db-target.sh
. "$(dirname "${BASH_SOURCE[0]}")/ci-db-target.sh"
db_target "$target"
case "$?" in 0) ;; 2) usage ;; *) exit 1 ;; esac

# The URL is the whole connection: no PG* variable from the caller's
# environment (a host, options, an sslmode) reaches psql.
for v in $(compgen -v); do
  case "$v" in PG*) unset "$v" ;; esac
done
export PGCLIENTENCODING=UTF8

problems=0
refuse() { echo "::error::$1"; problems=$((problems + 1)); }

command -v psql >/dev/null 2>&1 || { echo "::error::psql is not on PATH. Nothing was read or applied."; exit 1; }
[ -d "$DIR" ] || { echo "::error::$DIR is not here: run this from the repository root. Nothing was read or applied."; exit 1; }

md5_of() { md5sum "$1" | cut -d' ' -f1; }

# ---- the files it was given -------------------------------------------------

declare -A given=()
for f in "${args[@]}"; do
  case "$f" in
    "$DIR"/*) ;;
    *) refuse "$f is not under $DIR/." ; continue ;;
  esac
  name="${f#"$DIR"/}"
  if ! [[ "$name" =~ ^[0-9]{14}_[a-z][a-z0-9_]*\.sql$ ]]; then
    refuse "$f is not a timestamped migration (YYYYMMDDHHMMSS_slug.sql): the runner applies only those."
  elif [ ! -f "$f" ]; then
    refuse "$f does not exist in this checkout."
  else
    given["$name"]=1
  fi
done
[ "$problems" -eq 0 ] || { echo "Nothing was read or applied."; exit 1; }

# ---- history ----------------------------------------------------------------

# Loads a history into arrays named <prefix>_PAIR ("version|name" -> digest or
# "-"), <prefix>_STEM (a name that carries its own number -> "version|name"),
# <prefix>_SLUG (a slug-only name on a 14-digit version -> "version|name", or
# "*" when two or more rows share it), <prefix>_VER (version -> its names) and
# <prefix>_MAX14 (the highest 14-digit version).
load_history() {
  local url="$1" p="$2" out line ver name dig
  if ! out="$(psql "$url" -X -q -tA -F "$SEP" -v ON_ERROR_STOP=1 \
    -c "begin transaction read only; set local lock_timeout = '5s'; select version, coalesce(name, ''), case when array_length(statements, 1) = 2 and statements[2] = '$MARKER' then md5(statements[1]) else '' end from supabase_migrations.schema_migrations order by version; commit;")"; then
    echo "::error::Could not read the $3 history (supabase_migrations.schema_migrations); psql's own message is above. A runner that cannot read is red, not skipped. Nothing was applied."
    exit 1
  fi
  declare -gA "${p}_PAIR=()" "${p}_STEM=()" "${p}_SLUG=()" "${p}_VER=()"
  declare -g "${p}_MAX14="
  local -n pair="${p}_PAIR" stem="${p}_STEM" slug="${p}_SLUG" vers="${p}_VER" max="${p}_MAX14"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^([0-9]+)$SEP([^$SEP]*)$SEP([0-9a-f]*)$ ]] || continue
    ver="${BASH_REMATCH[1]}"; name="${BASH_REMATCH[2]}"; dig="${BASH_REMATCH[3]:--}"
    pair["$ver|$name"]="$dig"
    vers["$ver"]+="${vers[$ver]:+, }$name"
    if [[ "$name" =~ ^[0-9]+_ ]]; then
      stem["$name"]="$ver|$name"
    elif [ "${#ver}" -eq 14 ] && [ -n "$name" ]; then
      if [ -n "${slug[$name]:-}" ]; then slug["$name"]="*"; else slug["$name"]="$ver|$name"; fi
    fi
    if [ "${#ver}" -eq 14 ] && [[ "$ver" > "$max" ]]; then max="$ver"; fi
  done <<< "$out"
}

# Sets COVER to the "version|name" of the row that covers file $2 in history
# $1 under $DB_RULES, "" when none does, "*" when the slug-only match is shared.
cover() {
  local -n pair="${1}_PAIR" stem="${1}_STEM" slug="${1}_SLUG"
  local s="${2%.sql}"
  local ver="${s%%_*}" name="${s#*_}"
  COVER=""
  if [ -n "${pair[$ver|$name]:-}" ]; then COVER="$ver|$name"; return; fi
  [ "$DB_RULES" = "production" ] || return 0
  if [ -n "${stem[$s]:-}" ]; then COVER="${stem[$s]}"; return; fi
  if [ "${#ver}" -eq 4 ] && [ -n "${slug[$name]:-}" ]; then COVER="${slug[$name]}"; fi
}

# The digest a covered file was recorded with: "-" when this runner did not
# record it (nothing to compare).
recorded_digest() { local -n pair="${1}_PAIR"; RECORDED="${pair[$2]:--}"; }

load_history "$DB_URL" T "$target"

# ---- 2. main's files ----------------------------------------------------------

for f in "$DIR"/*.sql; do
  [ -e "$f" ] || continue
  name="${f##*/}"
  [ -n "${given[$name]:-}" ] && continue
  cover T "$name"
  if [ "$COVER" = "*" ]; then
    refuse "$f: two or more $target history rows carry its slug alone, so which one is it cannot be told. Read the rows (runbook section 6) and resolve them by hand."
  elif [ -z "$COVER" ]; then
    refuse "$f is on main but not in the $target history: the target is behind main. Apply main's migrations first (runbook section 6); this runner applies only the files a branch adds."
  else
    recorded_digest T "$COVER"
    if [ "$RECORDED" != "-" ] && [ "$RECORDED" != "$(md5_of "$f")" ]; then
      refuse "$f has different content from what $target recorded: an applied migration is never edited."
    fi
  fi
done

# ---- 3 and 4. the branch's files -------------------------------------------------

pending=()
mapfile -t sorted < <(printf '%s\n' "${!given[@]}" | LC_ALL=C sort)
for name in "${sorted[@]}"; do
  [ -n "$name" ] || continue
  f="$DIR/$name"
  cover T "$name"
  if [ -n "$COVER" ]; then
    recorded_digest T "$COVER"
    if [ "$RECORDED" != "-" ] && [ "$RECORDED" != "$(md5_of "$f")" ]; then
      refuse "$f was applied to $target with different content. An applied migration is never edited: write the change as a NEW migration (pnpm --filter @bis/db migration:new <slug>)."
    else
      echo "already applied: $f"
    fi
  else
    pending+=("$name")
  fi
done

if [ "$DB_RULES" = "production" ] && [ "${#pending[@]}" -gt 0 ]; then
  load_history "$BISCI_URL" B "bis-ci"
fi
for name in "${pending[@]}"; do
  f="$DIR/$name"
  s="${name%.sql}"; ver="${s%%_*}"
  if [ -n "${T_VER[$ver]:-}" ]; then
    refuse "$f: $target already records version $ver as ${T_VER[$ver]}, another migration. Give this one a new version: pnpm --filter @bis/db migration:new <slug>, move the SQL in, delete this file."
  fi
  if [ "$DB_RULES" = "bis-ci" ] && [ -n "$T_MAX14" ] && ! [[ "$ver" > "$T_MAX14" ]]; then
    refuse "$f is older than $T_MAX14, which $target already holds; applied now, bis-ci's order would differ from the files'. It has been applied nowhere, so give it a new version: pnpm --filter @bis/db migration:new <slug>, move the SQL in, delete this file."
  fi
  if [ "$DB_RULES" = "production" ]; then
    if [ -z "${B_PAIR[$ver|${s#*_}]:-}" ]; then
      refuse "$f is not on bis-ci: production applies only what bis-ci already holds."
    elif [ "${B_PAIR[$ver|${s#*_}]}" = "-" ]; then
      refuse "$f is on bis-ci but not recorded by this runner, so its content cannot be compared: apply it to production by hand (runbook section 6)."
    elif [ "${B_PAIR[$ver|${s#*_}]}" != "$(md5_of "$f")" ]; then
      refuse "$f differs from bis-ci's recorded copy: production applies only what bis-ci holds, byte for byte."
    fi
  fi
done

if [ "$problems" -gt 0 ]; then
  echo "Migration runner: refused ($problems problem(s), each named above). Nothing was applied."
  exit 1
fi

for name in "${pending[@]}"; do
  if [ "$mode" = "check" ]; then
    refuse "$DIR/$name is not applied to $target."
  else
    echo "pending: $DIR/$name"
  fi
done
case "$mode" in
  check) [ "$problems" -eq 0 ] || exit 1; echo "Migration runner: every file is applied to $target."; exit 0 ;;
  dry-run) echo "Migration runner (dry run): ${#pending[@]} file(s) would be applied to $target. Nothing was applied."; exit 0 ;;
esac

# ---- 6. apply ------------------------------------------------------------------

work="$(mktemp -d)" || { echo "::error::Could not make a temporary directory. Nothing was applied."; exit 1; }
trap 'rm -rf "$work"' EXIT

applied=()
for name in "${pending[@]}"; do
  f="$DIR/$name"
  s="${name%.sql}"; ver="${s%%_*}"; slug="${s#*_}"
  # The file's exact text goes into the history row as a dollar-quoted literal
  # under a tag the file cannot contain.
  tag="bis_mig_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  if grep -qF "\$$tag\$" "$f"; then echo "::error::$f contains the runner's quoting tag; run it again. Nothing more was applied."; exit 1; fi
  wrapper="$work/$s.sql"
  {
    printf '\\set VERBOSITY terse\n\\set SHOW_CONTEXT never\n'
    printf "begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '10min';\n"
    printf 'lock table supabase_migrations.schema_migrations in share row exclusive mode;\n'
    cat "$f"
    printf '\n;\n'
    printf "insert into supabase_migrations.schema_migrations (version, name, statements) values ('%s', '%s', array[\$%s\$" "$ver" "$slug" "$tag"
    cat "$f"
    printf "\$%s\$, '%s']);\ncommit;\n" "$tag" "$MARKER"
  } > "$wrapper"
  echo "applying: $f"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$wrapper"; then
    echo "::error::$f failed and was rolled back: neither its changes nor its history row were kept (psql's terse message is above). ${#applied[@]} file(s) before it in this run stay applied and recorded. Nothing is retried: it was never recorded, so fix it and run again."
    exit 1
  fi
  applied+=("$name")
done

# ---- 7. verify -------------------------------------------------------------------

load_history "$DB_URL" T "$target"
for name in "${applied[@]}"; do
  s="${name%.sql}"
  recorded_digest T "${s%%_*}|${s#*_}"
  if [ "$RECORDED" != "$(md5_of "$DIR/$name")" ]; then
    refuse "$DIR/$name was run, but $target does not record it with its content. Read the history (runbook section 6) before anything else."
  fi
done
[ "$problems" -eq 0 ] || exit 1
echo "Migration runner: applied ${#applied[@]} file(s) to $target, each recorded with its content."
