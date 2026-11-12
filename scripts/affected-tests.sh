#!/usr/bin/env bash
# Lists the vitest tests a branch's changes can affect, to run before a push.
#
#   scripts/affected-tests.sh [--run] [BASE]     BASE defaults to origin/main
#
# Prints one command per package and kind (paste-able into bash); --run
# executes them in turn and exits 1 if any failed. Works in Git Bash on
# Windows. The full suite is still CI's job; this is the fast local subset.
#
# Why (2026-11-12): a PR removed a line from
# .github/scripts/ci-local-supabase.sh, ran only `vitest related` (which
# follows IMPORTS), and CI failed ten minutes later on
# apps/web/ci/ci-local-supabase.test.ts, which reads that script BY PATH.
# Several suites here read files as text: workflows, shell scripts, SQL,
# configs. So the changes are the files that differ from the merge base with
# BASE (commits, uncommitted edits and untracked files alike), and:
#   - a TypeScript source under a package's src/ (apps/web, packages/db)
#     goes to `vitest related --run` in that package: the tests that import
#     it. Looking these up by name would drown the list (a `page.tsx` is
#     named in 70+ tests);
#   - a changed *.test.ts runs itself;
#   - EVERY other changed file (shell, workflow, SQL, JSON, CSS, a config or
#     e2e helper outside src/, a deleted file) is looked up by its file name
#     in the repo's *.test.ts files, and each test that names it runs. A
#     TypeScript file outside src/ is ALSO handed to `vitest related`;
#   - packages/db's *.integration.test.ts run under its integration config,
#     which the default config excludes.
# A test found outside apps/ and packages/ is listed as a note, not run.
#
# Tested by apps/web/ci/affected-tests.test.ts (collected by `pnpm check`).

set -uo pipefail

usage() { echo "usage: scripts/affected-tests.sh [--run] [BASE]   (BASE defaults to origin/main)"; }

execute=0
base=""
for arg in "$@"; do
  case "$arg" in
    --run) execute=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option $arg" >&2; usage >&2; exit 2 ;;
    *)
      if [ -n "$base" ]; then echo "error: more than one BASE given" >&2; usage >&2; exit 2; fi
      base="$arg" ;;
  esac
done
base="${base:-origin/main}"

top="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "error: not inside a git repository" >&2; exit 2; }
cd "$top" || exit 2

if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  echo "error: '$base' is not a commit here (for origin/main, run: git fetch origin main)" >&2
  exit 2
fi
merge_base="$(git merge-base "$base" HEAD)" || { echo "error: '$base' and HEAD share no history" >&2; exit 2; }

# The package a repo path belongs to (apps/<x> or packages/<x> with a
# package.json), or nothing.
package_of() {
  case "$1" in
    apps/*/*|packages/*/*)
      local dir="${1%%/*}/$(cut -d/ -f2 <<<"$1")"
      [ -f "$dir/package.json" ] && echo "$dir" ;;
  esac
}

# Keyed by "<package>|<kind>", kind = related, run or integration; values are
# newline-separated paths relative to the package.
declare -A lists=()
notes=()
add() { lists["$1|$2"]+="$3"$'\n'; }

add_test() {
  local file="$1" pkg
  pkg="$(package_of "$file")"
  if [ -z "$pkg" ]; then notes+=("$file"); return; fi
  case "$file" in
    packages/db/*.integration.test.ts) add "$pkg" integration "${file#"$pkg"/}" ;;
    *) add "$pkg" run "${file#"$pkg"/}" ;;
  esac
}

by_name() {
  local name="${1##*/}" hit
  while IFS= read -r hit; do
    [ -n "$hit" ] && [ "$hit" != "$1" ] && add_test "$hit"
  done < <(git -c core.quotepath=false grep --untracked -lF -e "$name" -- '*.test.ts' 2>/dev/null)
}

changed=()
while IFS= read -r f; do [ -n "$f" ] && changed+=("$f"); done < <(
  { git -c core.quotepath=false diff --name-only "$merge_base"
    git -c core.quotepath=false ls-files --others --exclude-standard; } | sort -u)

for f in "${changed[@]}"; do
  pkg="$(package_of "$f")"
  case "$f" in
    *.test.ts)
      [ -f "$f" ] && add_test "$f"
      continue ;;
    *.ts|*.tsx|*.mts|*.cts)
      if [ -n "$pkg" ] && [ -f "$f" ]; then
        add "$pkg" related "${f#"$pkg"/}"
        case "$f" in "$pkg"/src/*) continue ;; esac
      fi ;;
  esac
  by_name "$f"
done

quote() { local s="$1"; printf "'%s'" "${s//\'/\'\\\'\'}"; }

echo "# Tests affected by ${#changed[@]} changed file(s) since $(git rev-parse --short "$merge_base") (merge base with $base)"
commands=0
failed=0
packages=()
while IFS= read -r p; do packages+=("$p"); done < <(printf '%s\n' "${!lists[@]}" | cut -d'|' -f1 | sort -u)
for key in $(for p in "${packages[@]+"${packages[@]}"}"; do printf '%s\n' "$p|related" "$p|run" "$p|integration"; done); do
  [ -n "${lists[$key]+set}" ] || continue
  pkg="${key%%|*}"
  kind="${key##*|}"
  files=()
  while IFS= read -r p; do [ -n "$p" ] && files+=("$p"); done < <(printf '%s' "${lists[$key]}" | sort -u)
  [ "${#files[@]}" -eq 0 ] && continue
  case "$kind" in
    related) cmd=(pnpm exec vitest related --run) ;;
    run) cmd=(pnpm exec vitest run) ;;
    integration) cmd=(pnpm exec vitest run --config vitest.integration.config.ts) ;;
  esac
  line="cd $pkg && ${cmd[*]}"
  for p in "${files[@]}"; do line+=" $(quote "$p")"; done
  echo "$line"
  commands=$((commands + 1))
  if [ "$execute" -eq 1 ]; then
    (cd "$pkg" && "${cmd[@]}" "${files[@]}") || failed=1
  fi
done

for n in "${notes[@]+"${notes[@]}"}"; do
  echo "# note: $n names a changed file but is outside apps/ and packages/; run it by hand"
done
if [ "$commands" -eq 0 ]; then
  echo "No test covers these changes by import or by name. CI still runs everything."
fi
exit "$failed"
