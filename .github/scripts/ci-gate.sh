#!/usr/bin/env bash
# The whole of a required check: green only when every part it names
# SUCCEEDED.
#
# Why (2026-11-12): the ruleset on main requires check runs named exactly
# `verify` and `e2e` on a PR's head commit, and it is not ours to change. To
# cut a push's time to green from ~22 minutes to ~11, each was split into
# parts that run in parallel on their own runners (verify-db and verify-app;
# e2e-migrations and the e2e-shard matrix). `verify` and `e2e` are now small
# jobs in ci.yml that `need` those parts, run `if: always()` so they are never
# skipped, and run THIS. GitHub reports a SKIPPED required check as passing,
# and a job that `needs` a failed part is skipped unless it says always(), so
# the gate must run, and must read nothing but `success` as green.
#
# Usage: ci-gate.sh NAME...
#   Each NAME is an environment variable the step sets to
#   ${{ needs.<part>.result }} (success, failure, cancelled or skipped). Every
#   one must be exactly `success`. An empty or unset one (a misspelt part id
#   evaluates to an empty string) is a failure, as is no NAME at all. For a
#   matrix part, GitHub's result is `success` only when every leg succeeded.
#   A docs-only push needs no exception: the parts skip their STEPS, never
#   the job, and still end `success` (ci-docs-only.sh).
#
# Names every part that did not succeed, then exits 1; exits 0 only when all
# did. Prints results only, which are never secrets.
# Tested by apps/web/ci/ci-gate.test.ts (collected by `pnpm check`).

{ set +x; } 2>/dev/null
set -u

if [ "$#" -eq 0 ]; then
  echo "::error::ci-gate.sh was given no part to check. A gate with nothing to check proves nothing; list each needs.<part>.result variable."
  exit 1
fi

failed=0
for name in "$@"; do
  if ! [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "::error::'$name' is not a variable name. Pass the NAME of an env variable holding needs.<part>.result."
    failed=1
    continue
  fi
  result="${!name:-}"
  if [ -z "$result" ]; then
    echo "::error::$name is empty or unset: the gate's env must map it to needs.<part>.result, and the part id must be one this job needs."
    failed=1
  elif [ "$result" != "success" ]; then
    echo "::error::$name is $result. This required check is green only when every part succeeded; open that part's own check run for the failure."
    failed=1
  else
    echo "$name: success"
  fi
done

exit "$failed"
