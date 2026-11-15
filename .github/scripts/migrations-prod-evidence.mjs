// Did production ALREADY receive this branch's migrations, byte for byte,
// through this pipeline? (docs/superpowers/plans/2026-11-13-migration-pipeline.md,
// D3 and PR 6, 2026-11-15.)
//
// Why. migrations-production asks danlo to approve the production-migrations
// environment on every push of a branch that adds a migration. After the
// first approval succeeds, a later push (a review fix, a merge of main that
// touches no migration) asked again, the runner found "already applied" and
// did nothing, and the required e2e check waited on that no-op click. This
// step, in migrations-plan, writes `prod_evidence=<sha>` when production
// already received these exact files; ci.yml then skips migrations-production
// and the e2e gate reads it as not due.
//
// Evidence is the NEWEST production-migrations deployment of this branch
// (GitHub creates one per job attempt, waiting or approved), and ALL of:
//   - made by GitHub Actions, for this environment and this branch;
//   - its newest status is `success`;
//   - the job its status's log URL names (actions/jobs/{id}) concluded
//     `success`, is named `migrations-production`, belongs to that run, and
//     ran on the deployment's commit and this branch; that run's workflow
//     file (actions/runs/{id} `path`) is .github/workflows/ci.yml;
//   - in git, that commit is an ancestor of HEAD (a commit force-pushed away
//     is not fetched and is no evidence), and HEAD's tree ids for
//     packages/db/supabase/migrations AND .github equal that commit's. A tree
//     id is the hash of every byte below it, so "identical" means identical
//     files, not identical names; .github identical means the evidence ran
//     today's pipeline.
// Anything missing, unreadable or different writes `prod_evidence=` and a
// notice saying why the click is asked, and exits 0: asking is the safe side.
// The newest deployment decides, so a later failed or cancelled attempt
// outranks an earlier success.
//
// Env (GitHub Actions sets all but the token, which ci.yml puts on this step
// alone; the job grants contents, deployments and actions READ only):
//   GITHUB_API_URL, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_REF_NAME,
//   GITHUB_TOKEN, GITHUB_OUTPUT
// A missing one is this step's own misconfiguration: exit 1, naming it.
// Prints short shas, run URLs and reasons, never the token or an API body.
// Tested by apps/web/ci/migrations-prod-evidence.test.ts (fake API on
// loopback, scratch repositories).

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const ENVIRONMENT = "production-migrations";
const JOB_NAME = "migrations-production";
const WORKFLOW = ".github/workflows/ci.yml";
const TREES = [["packages/db/supabase/migrations", "migrations differ"], [".github", ".github differs"]];
const MAX_PAGES = 5;

const env = {};
for (const name of ["GITHUB_API_URL", "GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_REF_NAME", "GITHUB_TOKEN", "GITHUB_OUTPUT"]) {
  env[name] = process.env[name] ?? "";
  if (env[name] === "") {
    console.log(`::error::${name} is empty or missing; this step runs inside GitHub Actions with the job's token on it. Fix the step in ci.yml.`);
    process.exit(1);
  }
}
const { GITHUB_API_URL: api, GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: branch } = env;

class NoEvidence extends Error {}
const ask = (why) => { throw new NoEvidence(why); };

async function get(path, what) {
  let res;
  try {
    res = await fetch(`${api}${path}`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    ask(`${what} could not be read`);
  }
  if (!res.ok) ask(`${what} could not be read (the API answered ${res.status})`);
  try {
    return await res.json();
  } catch {
    return ask(`${what} could not be read (the answer is not JSON)`);
  }
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const gitOk = (...args) => { try { git(...args); return true; } catch { return false; } };

async function evidence() {
  // The newest deployment of this branch decides.
  let deployment;
  for (let page = 1; page <= MAX_PAGES && !deployment; page++) {
    const list = await get(`/repos/${repo}/deployments?environment=${ENVIRONMENT}&ref=${encodeURIComponent(branch)}&per_page=100&page=${page}`, "production-migrations' deployments");
    if (!Array.isArray(list)) ask("production-migrations' deployments could not be read (the answer is not a list)");
    deployment = list.find((d) => d?.environment === ENVIRONMENT && d?.ref === branch);
    if (list.length < 100) break;
  }
  if (!deployment) ask(`there is no earlier production run of ${branch}`);
  const sha = String(deployment.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) ask("the newest deployment names no commit");
  const short = sha.slice(0, 7);
  if (deployment.performed_via_github_app?.slug !== "github-actions") ask(`the newest deployment (${short}) was not made by GitHub Actions`);

  const statuses = await get(`/repos/${repo}/deployments/${deployment.id}/statuses?per_page=100`, "the deployment's statuses");
  if (!Array.isArray(statuses)) ask("the deployment's statuses could not be read (the answer is not a list)");
  const newest = statuses[0];
  if (newest?.state !== "success") ask(`the newest production run of ${branch} (${short}) did not succeed: its newest status is ${newest?.state ?? "none"}`);

  const url = String(newest.log_url || newest.target_url || "");
  const m = /^\/actions\/runs\/([0-9]+)\/job\/([0-9]+)$/.exec(url.startsWith(`${server}/${repo}/`) ? url.slice(`${server}/${repo}`.length) : "");
  if (!m) ask("the deployment's log URL names no job of this repository");
  const [, runId, jobId] = m;

  const job = await get(`/repos/${repo}/actions/jobs/${jobId}`, "the deployment's job");
  if (job?.conclusion !== "success") ask(`the job ${url} did not succeed`);
  if (job.name !== JOB_NAME) ask(`the job ${url} is not ${JOB_NAME}`);
  if (String(job.run_id) !== runId) ask(`the job ${url} belongs to another run`);
  if (job.head_sha !== sha) ask(`the job ${url} ran on another commit than its deployment`);
  if (job.head_branch !== branch) ask(`the job ${url} ran on another branch`);
  const run = await get(`/repos/${repo}/actions/runs/${runId}`, "the deployment's run");
  if (run?.path !== WORKFLOW) ask(`the run of ${url} is not ci.yml`);

  // git: the commit is on this branch, below HEAD, with the same files.
  let head;
  try { head = git("rev-parse", "HEAD"); } catch { ask("HEAD could not be read"); }
  if (!gitOk("cat-file", "-e", `${sha}^{commit}`)) {
    const shallow = gitOk("rev-parse", "--is-shallow-repository") && git("rev-parse", "--is-shallow-repository") === "true";
    gitOk("fetch", "--quiet", "--no-tags", ...(shallow ? ["--unshallow"] : []), "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    if (!gitOk("cat-file", "-e", `${sha}^{commit}`)) ask(`production's commit ${short} is not on this branch any more (force-pushed away?)`);
  }
  if (!gitOk("merge-base", "--is-ancestor", sha, head)) ask(`production's commit ${short} is not an ancestor of this commit`);
  for (const [dir, differ] of TREES) {
    let before, now;
    try { before = git("rev-parse", `${sha}:${dir}`); now = git("rev-parse", `HEAD:${dir}`); } catch { ask(`${dir} could not be read at ${short} or here`); }
    if (before !== now) ask(`${differ} from ${short}, where production last ran`);
  }
  return { sha, url };
}

try {
  const found = await evidence();
  appendFileSync(env.GITHUB_OUTPUT, `prod_evidence=${found.sha}\n`);
  console.log(`::notice::production already received these exact migrations on ${found.sha.slice(0, 7)} (run ${found.url}); no approval needed`);
} catch (error) {
  // An unexpected error is unreadable evidence too: ask (its class only; a message could carry anything).
  const why = error instanceof NoEvidence ? error.message : `the evidence check stopped on an unexpected ${error?.name ?? "error"}`;
  appendFileSync(env.GITHUB_OUTPUT, "prod_evidence=\n");
  console.log(`::notice::danlo's approval is asked for production-migrations: ${why}.`);
}
