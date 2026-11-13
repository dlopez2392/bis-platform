#!/usr/bin/env bash
# The migration runner (docs/superpowers/plans/2026-11-13-migration-pipeline.md,
# D1-D3, D5; PR 3). ci.yml's migrations-bis-ci runs it against bis-ci (PR 4);
# PR 5 will run it against production behind the owner's approval.
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
#     rather than queue behind live traffic), statement_timeout 10min; then,
#     holding the lock, the checks of step 4 that another run could have
#     overtaken are made again (still unrecorded; on bis-ci, nothing newer);
#     the file; then its history row: version, name, statements = [the file's
#     exact text, the marker below]. Nothing of the data reaches the log: an
#     error prints its SQLSTATE only (a failing cast would quote the value,
#     `raise exception '%', r` the row), NOTICE and WARNING are not sent, and
#     the migration's own query output is discarded. The runner names the file
#     and the SQLSTATE. The password goes to psql in PGPASSWORD, never on its
#     command line.
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
    # Each flag once, and one mode: a repeated --target or a --check beside
    # --dry-run is a mistake in the caller, not something to guess at.
    --target) [ "$#" -ge 2 ] && [ -z "$target" ] || usage; target="$2"; shift 2 ;;
    --dry-run) [ "$mode" = "apply" ] || usage; mode="dry-run"; shift ;;
    --check) [ "$mode" = "apply" ] || usage; mode="check"; shift ;;
    -*) usage ;;
    *) args+=("$1"); shift ;;
  esac
done
[ -n "$target" ] || usage

# shellcheck source=ci-db-target.sh
. "$(dirname "${BASH_SOURCE[0]}")/ci-db-target.sh"
db_target "$target"
case "$?" in 0) ;; 2) usage ;; *) exit 1 ;; esac
# Read once: no child (psql included) inherits the URLs, password and all.
unset BIS_MIGRATIONS_DB_URL BIS_MIGRATIONS_BISCI_DB_URL

# The URL is the whole connection: no PG* variable from the caller's
# environment (a host, options, an sslmode) reaches psql. TLS is required for
# the hosted targets. The password travels in PGPASSWORD, set for each psql
# call alone, so psql's command line (what `ps` shows) never carries it.
for v in $(compgen -v); do
  case "$v" in PG*) unset "$v" ;; esac
done
export PGCLIENTENCODING=UTF8
if [ -n "$DB_TLS" ]; then export PGSSLMODE="$DB_TLS"; fi

# psql against a connection string ($1) with its password ($2).
pq() {
  local conn="$1" pass="$2"; shift 2
  if [ -n "$pass" ]; then PGPASSWORD="$pass" psql "$conn" "$@"; else psql "$conn" "$@"; fi
}

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
  elif [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' \n')" = "efbbbf" ]; then
    refuse "$f starts with a UTF-8 byte-order mark (an editor added it); psql would read it as part of the first statement. Save the file without one."
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
  local conn="$1" pass="$2" p="$3" label="$4" out line ver name dig
  if ! out="$(pq "$conn" "$pass" -X -q -tA -F "$SEP" -v ON_ERROR_STOP=1 \
    -c "begin transaction read only; set local lock_timeout = '5s'; select version, coalesce(name, ''), case when array_length(statements, 1) = 2 and statements[2] = '$MARKER' then md5(statements[1]) else '' end from supabase_migrations.schema_migrations order by version; commit;")"; then
    echo "::error::Could not read the $label history (supabase_migrations.schema_migrations); psql's own message is above. A runner that cannot read is red, not skipped. Nothing was applied."
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

load_history "$DB_CONN" "$DB_PASS" T "$target"

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
  load_history "$BISCI_CONN" "$BISCI_PASS" B "bis-ci"
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
  # The checks above ran before this run held the lock: two runs at once could
  # both pass them. So, holding the lock, they are made again: the version must
  # still be unrecorded (BMA01), and on bis-ci rules nothing newer may have
  # arrived meanwhile (BMA02), or bis-ci's order would stop being file order.
  newer=""
  if [ "$DB_RULES" = "bis-ci" ]; then
    newer="if exists (select 1 from supabase_migrations.schema_migrations where version ~ '^[0-9]{14}\$' and version > '$ver') then raise exception using errcode = 'BMA02'; end if;"
  fi
  {
    # Errors print their SQLSTATE only, never their text (a failing cast quotes
    # the value, `raise exception '%', r` the row); NOTICE and WARNING are not
    # sent at all; the migration's own query output is discarded (psql -o).
    printf '\\set VERBOSITY sqlstate\n\\set SHOW_CONTEXT never\n'
    # A file with its own COMMIT, END or ROLLBACK (migrations-plan refuses one
    # at PR time) would end this transaction early. AUTOCOMMIT off: after that,
    # every statement starts a new implicit transaction that nothing commits.
    # The transaction's id is printed (stdout, not the log) for the runner to
    # ask txid_status() after a failure, and kept in a transaction-local
    # setting: just before the history row, BMA03 if the transaction changed.
    printf '\\set AUTOCOMMIT off\n'
    printf "begin;\nselect set_config('bis_mig.txid', txid_current()::text, true) as bis_mig_txid \\\\gset\n\\\\echo bis_mig_txid=:bis_mig_txid\n"
    printf "set local lock_timeout = '5s';\nset local statement_timeout = '10min';\nset local client_min_messages = error;\n"
    printf 'lock table supabase_migrations.schema_migrations in share row exclusive mode;\n'
    printf "do \$bis_mig_check\$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '%s') then raise exception using errcode = 'BMA01'; end if; %s end \$bis_mig_check\$;\n" "$ver" "$newer"
    cat "$f"
    printf '\n;\n'
    printf "do \$bis_mig_tx\$ begin if coalesce(current_setting('bis_mig.txid', true), '') <> txid_current()::text then raise exception using errcode = 'BMA03'; end if; end \$bis_mig_tx\$;\n"
    printf "insert into supabase_migrations.schema_migrations (version, name, statements) values ('%s', '%s', array[\$%s\$" "$ver" "$slug" "$tag"
    cat "$f"
    printf "\$%s\$, '%s']);\ncommit;\n" "$tag" "$MARKER"
  } > "$wrapper"
  echo "applying: $f"
  if ! pq "$DB_CONN" "$DB_PASS" -X -q -v ON_ERROR_STOP=1 -o "$work/discarded-output" -f "$wrapper" > "$work/stdout" 2> "$work/stderr"; then
    cat "$work/stderr" >&2
    code="$(grep -oE '(ERROR|FATAL): +[0-9A-Z]{5}' "$work/stderr" | tail -n 1 | grep -oE '[0-9A-Z]{5}$')"
    # Did the file end the runner's transaction itself? BMA03 says so when
    # nothing failed first; otherwise the transaction's own fate says it:
    # COMMITTED means the file committed part of itself before failing.
    txid="$(grep -oE 'bis_mig_txid=[0-9]+' "$work/stdout" | head -n 1 | cut -d= -f2)"
    own_tx=""
    if [ "$code" = "BMA03" ]; then
      own_tx="yes"
    elif [ -n "$txid" ]; then
      tx_status="$(pq "$DB_CONN" "$DB_PASS" -X -q -tA -c "select txid_status($txid)" 2>/dev/null)" || tx_status="unreadable"
      case "$tx_status" in
        committed) own_tx="yes" ;;
        unreadable) own_tx="unknown" ;;
      esac
    fi
    if [ "$own_tx" = "yes" ]; then
      echo "::error::$f ran its own transaction control: part of it may be COMMITTED and it is NOT recorded. Repair by hand before running again; nothing is retried. (SQLSTATE ${code:-unknown}; runbook section 6.)"
      exit 1
    elif [ "$own_tx" = "unknown" ]; then
      echo "::error::$f failed (SQLSTATE ${code:-unknown}), and whether its transaction committed could not be read back. Treat part of it as possibly COMMITTED and NOT recorded: check by hand before running again; nothing is retried."
      exit 1
    fi
    case "$code" in
      BMA01) echo "::error::$f: this version is now recorded by another run; run again to see whether it is this file. This run wrote nothing." ;;
      BMA02) echo "::error::$f: another run applied a newer migration to $target first, so this file is now older than a version there; this run wrote nothing. It has been applied nowhere: give it a new version (pnpm --filter @bis/db migration:new <slug>), move the SQL in, delete this file." ;;
      *)
        case "$code" in
          55P03) hint=": lock timeout, another session holds a lock it needs; run again when traffic is quiet" ;;
          57014) hint=": statement timeout (10 min) or cancelled" ;;
          *) hint="" ;;
        esac
        echo "::error::$f failed (SQLSTATE ${code:-unknown}$hint) and was rolled back: neither its changes nor its history row were kept. ${#applied[@]} file(s) before it in this run stay applied and recorded. Nothing is retried: it was never recorded, so it may be fixed and run again." ;;
    esac
    exit 1
  fi
  applied+=("$name")
done

# ---- 7. verify -------------------------------------------------------------------

load_history "$DB_CONN" "$DB_PASS" T "$target"
for name in "${applied[@]}"; do
  s="${name%.sql}"
  recorded_digest T "${s%%_*}|${s#*_}"
  if [ "$RECORDED" != "$(md5_of "$DIR/$name")" ]; then
    refuse "$DIR/$name was run, but $target does not record it with its content. Read the history (runbook section 6) before anything else."
  fi
done
[ "$problems" -eq 0 ] || exit 1
echo "Migration runner: applied ${#applied[@]} file(s) to $target, each recorded with its content."
