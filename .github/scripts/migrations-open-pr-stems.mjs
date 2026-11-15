// Which migrations do OPEN pull requests into main ADD? (migration pipeline
// PR 6b, 2026-11-15; docs/superpowers/plans/2026-11-13-migration-pipeline.md,
// D4.) migrations-production runs this before its secret step; the runner's
// --parity reads the list. A migration bis-ci holds and production does not is
// IN FLIGHT when an open PR into main, from this repository, adds that exact
// file (drafts count: they are open); otherwise it is an ORPHAN (a PR closed
// unmerged after its bis-ci apply) and parity fails. A fork's PR never vouches:
// only this repository's branches reach bis-ci.
//
// It asks the REST API with the job's own GITHUB_TOKEN (`pull-requests: read`),
// paging both the open PRs and each PR's files. GitHub lists at most 3000
// files of a PR, so a PR at that cap is unreadable, not "adds nothing".
// Writes `<stem> <pr-number>` lines (timestamped stems only: the only form the
// runner applies to bis-ci) to the file BIS_MIGRATIONS_OPEN_PR_STEMS names,
// whole or not at all (written aside, then renamed).
//
// Env: GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_TOKEN (set by Actions; the
// token on this step alone), BIS_MIGRATIONS_OPEN_PR_STEMS.
// Exits 0 with the list written (possibly empty), 1 on anything it cannot
// read, writing nothing. Prints PR numbers and stems, never the token.
// Tested by apps/web/ci/migrations-open-pr-stems.test.ts (a fake API on loopback).

import { writeFileSync, renameSync } from "node:fs";

// A failure throws to the one catch below, which sets the exit code and lets
// node end on its own: process.exit() with a socket still closing aborts node
// on Windows (a libuv assertion), which would be a crash, not a clean 1.
class Refusal extends Error {}
const fail = (message) => {
  throw new Refusal(`${message} Parity cannot tell an in-flight migration from an orphan without it; Re-run failed jobs.`);
};

async function main() {
  const env = {};
  for (const name of ["GITHUB_API_URL", "GITHUB_REPOSITORY", "GITHUB_TOKEN", "BIS_MIGRATIONS_OPEN_PR_STEMS"]) {
    env[name] = process.env[name] ?? "";
    if (env[name] === "") fail(`${name} is empty or missing; this runs inside GitHub Actions.`);
  }
  const { GITHUB_API_URL: api, GITHUB_REPOSITORY: repo, BIS_MIGRATIONS_OPEN_PR_STEMS: out } = env;

  const PER_PAGE = 100;
  const FILES_CAP = 3000; // GitHub's own limit on a PR's file list
  const MAX_PR_PAGES = 50;
  const DIR = "packages/db/supabase/migrations/";
  const STEM = /^[0-9]{14}_[a-z][a-z0-9_]*$/;

  /** One page of a list endpoint: an array, or the job fails. */
  async function page(path, what) {
    let res, body;
    try {
      res = await fetch(`${api}${path}`, {
        headers: {
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      });
    } catch {
      fail(`${what} could not be read.`);
    }
    if (!res.ok) fail(`The API answered ${res.status} for ${what}.`);
    try {
      body = await res.json();
    } catch {
      fail(`The API's answer for ${what} is not JSON.`);
    }
    if (!Array.isArray(body)) fail(`The API's answer for ${what} is not a list.`);
    return body;
  }

  const pulls = [];
  for (let p = 1; ; p++) {
    if (p > MAX_PR_PAGES) fail(`More than ${MAX_PR_PAGES * PER_PAGE} open pull requests: the list was not read to its end.`);
    const items = await page(`/repos/${repo}/pulls?state=open&base=main&per_page=${PER_PAGE}&page=${p}`, `open pull requests (page ${p})`);
    pulls.push(...items);
    if (items.length < PER_PAGE) break;
  }

  const lines = [];
  for (const pr of pulls) {
    if (!Number.isInteger(pr?.number) || pr.number < 1) fail("An open pull request in the API's answer has no number.");
    // Asked for open PRs into main; anything else the answer holds is not one.
    if (pr.state !== "open" || pr.base?.ref !== "main") continue;
    if (pr.head?.repo?.full_name !== repo) continue;
    const files = [];
    for (let p = 1; ; p++) {
      const items = await page(`/repos/${repo}/pulls/${pr.number}/files?per_page=${PER_PAGE}&page=${p}`, `PR #${pr.number}'s files (page ${p})`);
      files.push(...items);
      if (items.length < PER_PAGE) break;
      if (files.length >= FILES_CAP) fail(`PR #${pr.number} changes ${FILES_CAP} or more files, GitHub's cap on a PR's file list, so its migrations cannot all be seen.`);
    }
    for (const f of files) {
      if (typeof f?.filename !== "string" || typeof f?.status !== "string") fail(`A file in PR #${pr.number}'s list has no name or status.`);
      if (f.status !== "added" || !f.filename.startsWith(DIR) || !f.filename.endsWith(".sql")) continue;
      const stem = f.filename.slice(DIR.length, -".sql".length);
      if (STEM.test(stem)) lines.push(`${stem} ${pr.number}`);
    }
  }

  const tmp = `${out}.partial`;
  try {
    writeFileSync(tmp, lines.map((l) => `${l}\n`).join(""));
    renameSync(tmp, out);
  } catch {
    fail("The list of open pull requests' migrations could not be written.");
  }
  console.log(lines.length === 0
    ? `Open pull requests into main: ${pulls.length}; none adds a migration.`
    : `Open pull requests into main: ${pulls.length}; the migrations they add:\n${lines.map((l) => `  - ${l.replace(" ", " (PR #")})`).join("\n")}`);
}

try {
  await main();
} catch (e) {
  // Only a Refusal's own words are printed: an unexpected error's message
  // could carry anything, so it is named, not echoed.
  console.log(`::error::${e instanceof Refusal ? e.message : "The open pull requests' migrations could not be listed (an unexpected error). Re-run failed jobs."}`);
  process.exitCode = 1;
}
