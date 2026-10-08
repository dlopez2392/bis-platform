#!/usr/bin/env bash
# Installs the Supabase CLI for verify's local stack (.github/scripts/
# ci-local-supabase.sh), at ONE pinned version, and refuses to run a download
# whose sha256 is not the pinned one.
#
# Why not an action: supabase/setup-cli v3 installs the CLI from npm through
# Bun and a dependency install of its own, every run, inside a job whose env
# already holds the Clerk development secret. A release tarball checked
# against a digest pinned here runs nothing that is not the CLI.
#
# Why this version: it is the version pnpm-lock.yaml resolves for packages/db's
# `supabase` devDependency (the CLI behind db:push:ci, which built the CI
# project), so the repo has one CLI. apps/web/ci/ci-local-supabase.test.ts
# fails `pnpm check` when the two disagree. To bump it: change both, and take
# the new digest from the release's checksums.txt
# (https://github.com/supabase/cli/releases/tag/v<version>).
#
# Writes: the CLI to $RUNNER_TEMP/supabase-cli, and that directory to
# $GITHUB_PATH, so later steps find `supabase`. Nothing else.

{ set +x; } 2>/dev/null
set -euo pipefail

SUPABASE_CLI_VERSION="2.109.1"
SUPABASE_CLI_SHA256="36d87b7fe6b4bcfe89ac47a4354e526cff22480224de426d7b370f6934556976"

: "${RUNNER_TEMP:?RUNNER_TEMP is not set: this script runs on a GitHub Actions runner}"
: "${GITHUB_PATH:?GITHUB_PATH is not set: this script runs on a GitHub Actions runner}"

asset="supabase_${SUPABASE_CLI_VERSION}_linux_amd64.tar.gz"
url="https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/${asset}"
dir="$RUNNER_TEMP/supabase-cli"
tarball="$RUNNER_TEMP/$asset"

rm -rf "$dir" "$tarball"
mkdir -p "$dir"

curl -q --fail --silent --show-error --location --retry 3 --max-time 120 -o "$tarball" "$url"

actual="$(sha256sum "$tarball" | cut -d' ' -f1)"
if [ "$actual" != "$SUPABASE_CLI_SHA256" ]; then
  echo "::error::The Supabase CLI download ($asset) does not have the pinned sha256. It was not unpacked or run. A re-run fixes a truncated download; a release that changed after it was pinned is a finding, not a retry."
  rm -f "$tarball"
  exit 1
fi

tar -xzf "$tarball" -C "$dir"
rm -f "$tarball"
"$dir/supabase" --version
echo "$dir" >> "$GITHUB_PATH"
