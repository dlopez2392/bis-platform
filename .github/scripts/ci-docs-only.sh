#!/usr/bin/env bash
# Docs-only decision: does this push change ONLY files no gate reads?
#
# Why: every push ran the db suite (~1,570 live tests) and e2e against the CI
# Supabase project, a Free project, including pushes that changed nothing but
# markdown. One cycle cost ~10.7 GB of API logs and ~5 GB of egress, almost
# all test-account setup and teardown. A docs-only push cannot change what
# those suites measure, so it should not pay for them.
#
# How ci.yml uses it: both `verify` and `e2e` run this as their third step
# (after checkout and the target guard, `id: scope`), and every later step
# carries `if: steps.scope.outputs.docs_only != 'true'`. Both jobs therefore
# always RUN and end `success` on the head SHA, which is what the ruleset on
# main requires; a docs-only push just ends early. (A workflow path filter
# would leave the required checks Pending forever; a job-level `if:` reports
# `skipped` and takes e2e's `needs: verify` down with it.)
#
# Writes `docs_only=true` or `docs_only=false` to $GITHUB_OUTPUT. `true` only
# when ALL of these hold; anything else, including any error, is `false`, so
# the default is always the full run:
#   - the event is a push to a branch other than main (main's runs are the
#     deploy's health signal; a manual dispatch and a tag always run all);
#   - main's history can be fetched and a merge base found;
#   - the branch changes at least one file against that merge base (the
#     WHOLE branch, not the last push: a red code commit with a green
#     docs-only commit on top must not get a green head SHA);
#   - every changed path, old and new names both (renames are not paired),
#     is on the allowlist below and carries no code extension.
#
# Tested by apps/web/ci/ci-docs-only.test.ts (collected by `pnpm check`).

{ set +x; } 2>/dev/null
set -u

decide() {
  echo "docs_only=$1" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
  if [ "$1" = "true" ]; then
    echo "::notice::Docs-only change: the install, the test suites, the build and Playwright are skipped. $2"
  else
    echo "Running everything: $2"
  fi
  exit 0
}

# A path no gate reads. Code extensions are refused FIRST, anywhere, so a
# `.ts` under docs/ or a `.json` under .claude/ still runs everything.
is_docs() {
  local p="$1"
  case "$p" in
    .github/workflows/*) return 1 ;;
  esac
  case "${p##*/}" in
    .env*) return 1 ;;
  esac
  case "$p" in
    *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.yml|*.yaml|*.sql|*.css|*.scss|*.sh|*.toml|*.lock)
      return 1 ;;
  esac
  case "$p" in
    *.md|docs/*|.claude/*|.superpowers/*|LICENSE|.github/ISSUE_TEMPLATE/*) return 0 ;;
  esac
  return 1
}

event="${GITHUB_EVENT_NAME:-}"
ref="${GITHUB_REF:-}"
[ "$event" = "push" ] || decide false "the event is '$event', not a push."
case "$ref" in
  refs/heads/main) decide false "this is a push to main." ;;
  refs/heads/*) ;;
  *) decide false "the ref '$ref' is not a branch." ;;
esac

# actions/checkout fetches one commit; the merge base needs history.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  git fetch --quiet --no-tags --unshallow origin '+refs/heads/main:refs/remotes/origin/main' \
    || decide false "main's history could not be fetched."
else
  git fetch --quiet --no-tags origin '+refs/heads/main:refs/remotes/origin/main' \
    || decide false "main could not be fetched."
fi
base="$(git merge-base refs/remotes/origin/main HEAD 2>/dev/null)" \
  || decide false "no merge base with main."

changed=0
while IFS= read -r -d '' path; do
  changed=$((changed + 1))
  is_docs "$path" || decide false "'$path' is not docs."
done < <(git diff --no-renames --name-only -z "$base" HEAD 2>/dev/null || printf 'diff-failed\0')

[ "$changed" -gt 0 ] || decide false "the branch changes nothing against main."
decide true "All $changed changed file(s) against main are docs."
