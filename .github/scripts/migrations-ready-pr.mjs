// Is this push's commit the head of a READY pull request into main?
// (docs/superpowers/plans/2026-11-13-migration-pipeline.md, D2; owner answer
// Q1, 2026-11-13: bis-ci gets a migration when the PR is marked ready.)
//
// ci.yml runs on `push` or `workflow_dispatch` (never `pull_request`, so no
// fork ever runs it), and neither event carries a PR. migrations-bis-ci asks the REST API which pull
// requests have this commit, with the job's own GITHUB_TOKEN (read-only:
// the job grants `pull-requests: read`), and passes only when one is open,
// not a draft, into main, from this repository, with this branch as its head
// and THIS commit as the head's sha (a newer push has its own run). A draft or
// no PR fails the job with what to do; "Re-run failed jobs" asks again.
//
// Env (all set by GitHub Actions; the token on this step alone):
//   GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME, GITHUB_TOKEN
// Exits 0 when ready, 1 otherwise; anything it cannot read is a 1, never a
// pass. Prints PR numbers and states, never the token.
// Tested by apps/web/ci/migrations-ready-pr.test.ts (a fake API on loopback).

const fail = (message) => {
  console.log(`::error::${message}`);
  process.exit(1);
};

const env = {};
for (const name of ["GITHUB_API_URL", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_REF_NAME", "GITHUB_TOKEN"]) {
  env[name] = process.env[name] ?? "";
  if (env[name] === "") fail(`${name} is empty or missing; this check runs inside GitHub Actions. bis-ci was not touched.`);
}
const { GITHUB_API_URL: api, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_REF_NAME: branch } = env;
const short = sha.slice(0, 7);

let pulls;
try {
  const res = await fetch(`${api}/repos/${repo}/commits/${sha}/pulls?per_page=100`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) fail(`The API answered ${res.status} for this commit's pull requests, so whether a ready PR exists is unknown. Re-run failed jobs; bis-ci was not touched.`);
  pulls = await res.json();
} catch {
  fail("This commit's pull requests could not be read, so whether a ready PR exists is unknown. Re-run failed jobs; bis-ci was not touched.");
}
if (!Array.isArray(pulls)) fail("The API's answer for this commit's pull requests is not a list. Re-run failed jobs; bis-ci was not touched.");

const ours = pulls.filter((pr) =>
  pr?.state === "open"
  && pr?.base?.ref === "main"
  && pr?.head?.sha === sha
  && pr?.head?.ref === branch
  && pr?.head?.repo?.full_name === repo);

const readyPr = ours.find((pr) => pr.draft === false);
if (readyPr) {
  console.log(`PR #${readyPr.number} is open and ready, with ${short} as its head: bis-ci may receive this branch's migrations.`);
  process.exit(0);
}
if (ours.length > 0) {
  fail(`PR #${ours[0].number} is a draft. Mark it ready for review, then Re-run failed jobs: bis-ci receives a migration only from a ready PR (owner decision Q1, 2026-11-13). bis-ci was not touched.`);
}
fail(`No open pull request into main has this commit (${short}) as its head. Open a PR for ${branch}, mark it ready for review, then Re-run failed jobs: bis-ci receives a migration only from a ready PR (owner decision Q1, 2026-11-13). bis-ci was not touched.`);
