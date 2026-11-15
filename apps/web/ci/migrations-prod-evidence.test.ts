import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * .github/scripts/migrations-prod-evidence.mjs (migration pipeline PR 6,
 * 2026-11-15): a later push of a branch whose migrations production ALREADY
 * received, byte for byte, through this pipeline, is not asked for danlo's
 * click again. The evidence is a production-migrations deployment of this
 * branch whose newest status is success, whose job is a successful
 * `migrations-production` of ci.yml on that same commit, and whose commit is
 * an ancestor of HEAD with the SAME migrations tree and the SAME .github tree.
 * Anything less writes an empty `prod_evidence` and the click is asked.
 *
 * Run for real (node, git, env only): a fake REST API on loopback, and
 * repositories built in a temp directory and cloned as actions/checkout
 * clones (`--depth 1`, file://), so the script must fetch the earlier commit
 * itself, as on a runner.
 */
const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/migrations-prod-evidence.mjs", import.meta.url));
const DIR = "packages/db/supabase/migrations";
const MIG = `${DIR}/20261114093000_thing.sql`;
const REPO = "owner/bis-platform";
const SERVER = "https://github.example";
const TOKEN = "ghs_faketoken_never_printed";
const RUN = 43650480373;
const JOB = 132848244968;

vi.setConfig({ testTimeout: 60_000 });

let root = "";
let origin = "";
let work = "";
let gitEnv: NodeJS.ProcessEnv = { ...process.env };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();

function commit(changes: Record<string, string>, message: string): string {
  for (const [file, content] of Object.entries(changes)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), content);
    git(work, "add", "--", file);
  }
  git(work, "commit", "-q", "-m", message);
  return git(work, "rev-parse", "HEAD");
}

/** A branch off main: the EVIDENCE commit (production ran there), then HEAD's commit. */
function branch(name: string, evidence: Record<string, string>, head: Record<string, string> | null): { evidence: string; head: string } {
  git(work, "checkout", "-q", "-B", name, "main");
  const e = commit(evidence, `${name} evidence`);
  const h = head ? commit(head, `${name} head`) : e;
  git(work, "push", "-q", "-f", "origin", `${name}:${name}`);
  return { evidence: e, head: h };
}

const SQL = "create table thing (id int primary key);\n";
/** One file in each tree, beside .github, that migrations-plan.mjs counts as the pipeline (migrations-plan.test.ts lists the same). */
const PIPELINE_FILES = [
  "packages/db/supabase/parity/allowed-differences.txt",
  "packages/db/supabase/bootstrap/ci-project.sql",
  "packages/db/supabase/config.toml",
  "packages/db/src/migrations/names.ts",
  "packages/db/src/ci/push.ts",
];
const shas: Record<string, { evidence: string; head: string }> = {};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-prod-evidence-"));
  const globalConfig = path.join(root, "gitconfig");
  fs.writeFileSync(globalConfig, "");
  gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  for (const k of Object.keys(gitEnv)) if (k.startsWith("GITHUB_")) delete gitEnv[k];
  origin = path.join(root, "origin.git");
  work = path.join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: gitEnv });
  execFileSync("git", ["clone", "-q", pathToFileURL(origin).href, work], { env: gitEnv });
  git(work, "checkout", "-q", "-b", "main");
  commit({ [`${DIR}/0001_a.sql`]: "create table a (id int);\n", ".github/workflows/ci.yml": "on: push\n", "apps/web/x.ts": "export {};\n" }, "base");
  git(work, "push", "-q", "origin", "main");

  shas.same = branch("b/same", { [MIG]: SQL }, { "apps/web/x.ts": "export const y = 1;\n" });
  shas.rerun = branch("b/rerun", { [MIG]: SQL }, null);
  // One byte, same file LIST: the case that comparing names instead of bytes passes wrongly.
  shas.byte = branch("b/byte", { [MIG]: SQL }, { [MIG]: SQL.replace("int primary", "INT primary") });
  shas.added = branch("b/added", { [MIG]: SQL }, { [`${DIR}/20261114100000_more.sql`]: "select 1;\n" });
  shas.github = branch("b/github", { [MIG]: SQL }, { ".github/workflows/ci.yml": "on: [push]\n" });
  // Review of #372: production's step reads more than the migrations and .github (parity's rules, the bootstrap,
  // the stacks' config, @bis/db's migration code). Each tree migrations-plan counts as the pipeline, changed ALONE.
  for (const [i, file] of PIPELINE_FILES.entries()) shas[`tree${i}`] = branch(`b/tree${i}`, { [MIG]: SQL, [file]: "before\n" }, { [file]: "after\n" });
  // Absent where production ran, present at HEAD (a missing tree is not an equal one).
  shas.appears = branch("b/appears", { [MIG]: SQL }, { "packages/db/supabase/parity/allowed-differences.txt": "history | x | reason\n" });
  // The mirror: present where production ran, removed at HEAD.
  const kept = branch("b/removed", { [MIG]: SQL, "packages/db/supabase/parity/allowed-differences.txt": "history | x | reason\n" }, null).evidence;
  git(work, "rm", "-q", "packages/db/supabase/parity/allowed-differences.txt");
  git(work, "commit", "-q", "-m", "b/removed head");
  git(work, "push", "-q", "origin", "b/removed:b/removed");
  shas.removed = { evidence: kept, head: git(work, "rev-parse", "HEAD") };
  // Force-pushed away: production ran on a commit the branch no longer has.
  const gone = branch("b/forced", { [MIG]: SQL }, null).evidence;
  shas.forced = { evidence: gone, head: branch("b/forced", { [MIG]: SQL, "apps/web/x.ts": "export const z = 2;\n" }, null).evidence };
}, 120_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

// ---- the fake REST API ------------------------------------------------------

type Reply = { status?: number; body: unknown };
let routes: Record<string, Reply> = {};
let requests: { url: string; auth?: string }[] = [];
let server: http.Server;
let api = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? "", auth: req.headers.authorization });
    const reply = routes[req.url ?? ""];
    res.writeHead(reply?.status ?? (reply ? 200 : 404), { "content-type": "application/json" });
    res.end(reply ? (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body)) : '{"message":"Not Found"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const deploymentsUrl = (branchName: string, page = 1) =>
  `/repos/${REPO}/deployments?environment=production-migrations&ref=${encodeURIComponent(branchName)}&per_page=100&page=${page}`;
const logUrl = `${SERVER}/${REPO}/actions/runs/${RUN}/job/${JOB}`;
const deployment = (branchName: string, sha: string, over: object = {}) => ({
  id: 7805042952, sha, ref: branchName, task: "deploy", environment: "production-migrations",
  performed_via_github_app: { slug: "github-actions" }, ...over,
});
const status = (state: string, url = logUrl) => ({ state, log_url: url, target_url: url });

/** Every answer a valid piece of evidence needs; `over` replaces any of them. */
function world(branchName: string, sha: string, over: Record<string, Reply> = {}): Record<string, Reply> {
  return {
    [deploymentsUrl(branchName)]: { body: [deployment(branchName, sha)] },
    [`/repos/${REPO}/deployments/7805042952/statuses?per_page=100`]: { body: [status("success"), status("in_progress"), status("waiting")] },
    [`/repos/${REPO}/actions/jobs/${JOB}`]: { body: { id: JOB, run_id: RUN, name: "migrations-production", status: "completed", conclusion: "success", head_sha: sha, head_branch: branchName } },
    [`/repos/${REPO}/actions/runs/${RUN}`]: { body: { id: RUN, name: "CI", path: ".github/workflows/ci.yml", head_sha: sha, head_branch: branchName } },
    ...over,
  };
}

type Result = { status: number | null; output: string; evidence: string | undefined };

/** Clone `branchName` as actions/checkout does, let `before` alter it, answer with `answers`, run the script there. */
async function run(branchName: string, answers: Record<string, Reply> | ((clone: string) => Record<string, Reply>), env: Record<string, string> = {}): Promise<Result> {
  const clone = fs.mkdtempSync(path.join(root, "ci-"));
  execFileSync("git", ["clone", "-q", "--depth", "1", "--no-tags", "--branch", branchName, pathToFileURL(origin).href, clone], { env: gitEnv });
  routes = typeof answers === "function" ? answers(clone) : answers;
  requests = [];
  const out = path.join(fs.mkdtempSync(path.join(root, "out-")), "github_output");
  fs.writeFileSync(out, "");
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: clone,
    env: {
      ...gitEnv,
      GITHUB_API_URL: api, GITHUB_SERVER_URL: SERVER, GITHUB_REPOSITORY: REPO, GITHUB_REF_NAME: branchName,
      GITHUB_TOKEN: TOKEN, GITHUB_OUTPUT: out, ...env,
    },
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  const line = fs.readFileSync(out, "utf8").split("\n").find((l) => l.startsWith("prod_evidence="));
  return { status: code, output, evidence: line?.slice("prod_evidence=".length) };
}

/** No evidence: exit 0, an empty output, and a notice saying the click is asked and why. */
function none(r: Result, why: RegExp) {
  expect(r.status, r.output).toBe(0);
  expect(r.evidence, r.output).toBe("");
  expect(r.output).toMatch(/::notice::danlo's approval is asked/);
  expect(r.output).toMatch(why);
  expect(r.output).not.toContain(TOKEN);
}

describe("migrations-prod-evidence.mjs: no second click for migrations production already received", () => {
  it("finds the evidence on an ancestor with identical migrations and .github trees, names the run, and reads the API with the job's token only", async () => {
    const { evidence } = shas.same!;
    const r = await run("b/same", world("b/same", evidence));
    expect(r.status, r.output).toBe(0);
    expect(r.evidence).toBe(evidence);
    expect(r.output).toContain(`::notice::production already received these exact migrations on ${evidence.slice(0, 7)} (run ${logUrl}); no approval needed`);
    expect(requests.map((q) => q.url)).toEqual([
      deploymentsUrl("b/same"),
      `/repos/${REPO}/deployments/7805042952/statuses?per_page=100`,
      `/repos/${REPO}/actions/jobs/${JOB}`,
      `/repos/${REPO}/actions/runs/${RUN}`,
    ]);
    expect(requests.every((q) => q.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(r.output).not.toContain(TOKEN);
  });

  it("finds it when HEAD is the very commit production ran on (a re-run)", async () => {
    const r = await run("b/rerun", world("b/rerun", shas.rerun!.evidence));
    expect(r.evidence, r.output).toBe(shas.rerun!.evidence);
  });

  it("asks when one byte of a migration changed and the file LIST did not (mutation: compare names instead of bytes → FAILS)", async () => {
    none(await run("b/byte", world("b/byte", shas.byte!.evidence)), /packages\/db\/supabase\/migrations differs/);
  });

  it("asks when a migration was added after production's run", async () => {
    none(await run("b/added", world("b/added", shas.added!.evidence)), /packages\/db\/supabase\/migrations differs/);
  });

  it.each(PIPELINE_FILES.map((file, i) => [file, i] as const))(
    "asks when only %s changed after production's run: the pipeline that checks production is not the one that ran (mutation: drop that tree from the compared set → FAILS)",
    async (file, i) => {
      const tree = file.endsWith(".toml") ? file : file.slice(0, file.lastIndexOf("/"));
      none(await run(`b/tree${i}`, world(`b/tree${i}`, shas[`tree${i}`]!.evidence)), new RegExp(`${tree.replace(/[./]/g, "\\$&")} differs`));
    },
  );

  it("asks when a pipeline tree is absent where production ran and present at HEAD (absent is not equal)", async () => {
    none(await run("b/appears", world("b/appears", shas.appears!.evidence)), /packages\/db\/supabase\/parity differs/);
  });

  it("asks when a pipeline tree is present where production ran and removed at HEAD (mutation: treat a tree absent at HEAD as equal → FAILS)", async () => {
    none(await run("b/removed", world("b/removed", shas.removed!.evidence)), /packages\/db\/supabase\/parity differs/);
  });

  it("asks when .github changed after production's run (the evidence must have run today's pipeline)", async () => {
    none(await run("b/github", world("b/github", shas.github!.evidence)), /\.github differs/);
  });

  it("asks when production's commit was force-pushed away and cannot be fetched", async () => {
    none(await run("b/forced", world("b/forced", shas.forced!.evidence)), /not on this branch/);
  });

  it("asks when production's commit is present, with identical trees, but is not an ancestor of HEAD (mutation: drop the ancestor check → FAILS)", async () => {
    const r = await run("b/same", (clone) => {
      // A sibling of HEAD carrying HEAD's own tree, so only ancestry tells them apart.
      const sibling = git(clone, "commit-tree", "HEAD^{tree}", "-m", "sibling");
      return world("b/same", sibling);
    });
    none(r, /not an ancestor/);
  });

  it.each([
    ["the deployment's newest status is a failure after an earlier success", { statuses: [status("failure"), status("success")] }, /newest status is failure/],
    ["the deployment's newest status is inactive", { statuses: [status("inactive"), status("success")] }, /newest status is inactive/],
    ["the deployment has no status", { statuses: [] }, /newest status is none/],
    ["the job did not succeed", { job: { conclusion: "failure" } }, /job .* did not succeed/],
    ["the job is not migrations-production", { job: { name: "migrations-bis-ci" } }, /not migrations-production/],
    ["the job ran on another commit", { job: { head_sha: "f".repeat(40) } }, /another commit/],
    ["the job ran on another branch", { job: { head_branch: "someone-else" } }, /another branch/],
    ["the job belongs to another run than its URL names", { job: { run_id: 1 } }, /another run/],
    ["the run is not ci.yml", { run: { path: ".github/workflows/screenshots.yml" } }, /not ci\.yml/],
    ["the status's log URL is not a job of this repository", { statuses: [status("success", `${SERVER}/fork/bis-platform/actions/runs/${RUN}/job/${JOB}`)] }, /log URL/],
  ])("asks when %s", async (_label, change, why) => {
    const { evidence } = shas.same!;
    const base = world("b/same", evidence);
    const over: Record<string, Reply> = {};
    const c = change as { statuses?: unknown[]; job?: object; run?: object };
    if (c.statuses) over[`/repos/${REPO}/deployments/7805042952/statuses?per_page=100`] = { body: c.statuses };
    if (c.job) over[`/repos/${REPO}/actions/jobs/${JOB}`] = { body: { ...(base[`/repos/${REPO}/actions/jobs/${JOB}`]!.body as object), ...c.job } };
    if (c.run) over[`/repos/${REPO}/actions/runs/${RUN}`] = { body: { ...(base[`/repos/${REPO}/actions/runs/${RUN}`]!.body as object), ...c.run } };
    none(await run("b/same", { ...base, ...over }), why);
  });

  it("lets the NEWEST deployment of the branch decide: a later failed attempt on the same commit outranks an earlier success", async () => {
    const { evidence } = shas.same!;
    const r = await run("b/same", world("b/same", evidence, {
      [deploymentsUrl("b/same")]: { body: [deployment("b/same", evidence, { id: 2 }), deployment("b/same", evidence)] },
      [`/repos/${REPO}/deployments/2/statuses?per_page=100`]: { body: [status("failure"), status("waiting")] },
    }));
    none(r, /newest status is failure/);
  });

  it.each([
    ["not made by GitHub Actions", { performed_via_github_app: { slug: "someone-app" } }, /not made by GitHub Actions/],
    ["of another environment", { environment: "production" }, /no earlier production run of b\/same/],
    ["of another branch", { ref: "someone-else" }, /no earlier production run of b\/same/],
  ])("asks when the deployment is %s", async (_label, over, why) => {
    const { evidence } = shas.same!;
    none(await run("b/same", world("b/same", evidence, { [deploymentsUrl("b/same")]: { body: [deployment("b/same", evidence, over)] } })), why);
  });

  it("asks when this branch never reached production", async () => {
    none(await run("b/same", { [deploymentsUrl("b/same")]: { body: [] } }), /no earlier production run of b\/same/);
  });

  it("reads past a full page that holds none of this branch's deployments", async () => {
    const { evidence } = shas.same!;
    const others = Array.from({ length: 100 }, (_, i) => deployment("someone-else", evidence, { id: 100 + i, ref: "someone-else" }));
    const r = await run("b/same", world("b/same", evidence, {
      [deploymentsUrl("b/same", 1)]: { body: others },
      [deploymentsUrl("b/same", 2)]: { body: [deployment("b/same", evidence)] },
    }));
    expect(r.evidence, r.output).toBe(evidence);
  });

  it("stops after five pages and asks", async () => {
    const others = Array.from({ length: 100 }, (_, i) => deployment("someone-else", shas.same!.evidence, { id: 100 + i, ref: "someone-else" }));
    const pages = Object.fromEntries([1, 2, 3, 4, 5, 6].map((p) => [deploymentsUrl("b/same", p), { body: others }]));
    const r = await run("b/same", pages);
    none(r, /no earlier production run of b\/same/);
    expect(requests).toHaveLength(5);
  });

  it.each([
    ["the deployments answer 500", "deployments", { status: 500, body: "{}" }],
    ["the deployments answer is not JSON", "deployments", { body: "<html>" }],
    ["the deployments answer is not a list", "deployments", { body: { message: "Not Found" } }],
    ["the statuses answer 500", "statuses", { status: 500, body: "{}" }],
    ["the job answers 500", "job", { status: 500, body: "{}" }],
    ["the job answer is not JSON", "job", { body: "<html>" }],
    ["the run answers 500", "run", { status: 500, body: "{}" }],
  ])("asks, never failing the job, when %s", async (_label, which, reply) => {
    const { evidence } = shas.same!;
    const url = {
      deployments: deploymentsUrl("b/same"),
      statuses: `/repos/${REPO}/deployments/7805042952/statuses?per_page=100`,
      job: `/repos/${REPO}/actions/jobs/${JOB}`,
      run: `/repos/${REPO}/actions/runs/${RUN}`,
    }[which]!;
    none(await run("b/same", world("b/same", evidence, { [url]: reply as Reply })), /could not be read/);
  });

  it.each(["GITHUB_TOKEN", "GITHUB_API_URL", "GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_REF_NAME", "GITHUB_OUTPUT"])(
    "fails the step, naming it, when %s is missing (its own misconfiguration, never a silent click)", async (name) => {
      const r = await run("b/same", world("b/same", shas.same!.evidence), { [name]: "" });
      expect(r.status, r.output).toBe(1);
      expect(r.output).toMatch(new RegExp(`::error::${name} is empty`));
      expect(r.output).not.toContain(TOKEN);
    });
});
