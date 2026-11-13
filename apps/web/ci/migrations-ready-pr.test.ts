import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * .github/scripts/migrations-ready-pr.mjs (migration pipeline PR 4, owner
 * answer Q1, 2026-11-13): bis-ci receives a branch's migrations only when an
 * open, NON-DRAFT pull request into main has this push's commit as its head.
 * ci.yml runs on `push` only, so the job asks the REST API
 * (commits/{sha}/pulls) with its own read-only GITHUB_TOKEN. A fake API on
 * loopback answers here; the script is run as CI runs it (node, env only).
 */
const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/migrations-ready-pr.mjs", import.meta.url));
const REPO = "owner/bis-platform";
const SHA = "8cb6382e77af6d11ef91bbabc27b1afa4922c51d";
const BRANCH = "migrations/add-thing";
const TOKEN = "ghs_faketoken_never_printed";

type Pr = { number: number; state: string; draft: boolean; head: { sha: string; ref: string; repo: { full_name: string } | null }; base: { ref: string } };
const ready = (over: Partial<Pr> = {}): Pr => ({
  number: 412, state: "open", draft: false,
  head: { sha: SHA, ref: BRANCH, repo: { full_name: REPO } }, base: { ref: "main" }, ...over,
});

let server: http.Server;
let api = "";
let reply: { status: number; body: string } = { status: 200, body: "[]" };
let seen: { url?: string; auth?: string } = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen = { url: req.url, auth: req.headers.authorization };
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function run(answer: { status?: number; body: unknown }, env: Record<string, string> = {}) {
  reply = { status: answer.status ?? 200, body: typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body) };
  seen = {};
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      NODE_ENV: "test", PATH: process.env.PATH ?? "",
      GITHUB_API_URL: api, GITHUB_REPOSITORY: REPO, GITHUB_SHA: SHA, GITHUB_REF_NAME: BRANCH, GITHUB_TOKEN: TOKEN,
      ...env,
    },
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  return new Promise<{ status: number | null; output: string }>((resolve) => child.on("close", (status) => resolve({ status, output })));
}

describe("migrations-ready-pr.mjs: bis-ci gets a migration only from a ready PR (owner answer Q1)", () => {
  it("passes an open, non-draft PR into main whose head is this commit, naming it, and asks the commit's own pulls with the job's token", async () => {
    const r = await run({ body: [ready()] });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/#412 is open and ready/);
    expect(seen.url).toBe(`/repos/${REPO}/commits/${SHA}/pulls?per_page=100`);
    expect(seen.auth).toBe(`Bearer ${TOKEN}`);
    expect(r.output).not.toContain(TOKEN);
  });

  it("refuses a DRAFT PR and says to mark it ready, then re-run failed jobs (mutation: drop the draft test → FAILS)", async () => {
    const r = await run({ body: [ready({ draft: true })] });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::PR #412 is a draft\. Mark it ready for review, then Re-run failed jobs/);
  });

  it("refuses a push with no PR at all (mutation: pass when the list is empty → FAILS)", async () => {
    const r = await run({ body: [] });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::No open pull request into main has this commit \(8cb6382\) as its head/);
  });

  it.each([
    ["a closed PR", ready({ state: "closed" })],
    ["a PR whose head has moved on to a newer push", ready({ head: { sha: "f".repeat(40), ref: BRANCH, repo: { full_name: REPO } } })],
    ["a PR of another branch that contains this commit", ready({ head: { sha: SHA, ref: "someone-else", repo: { full_name: REPO } } })],
    ["a PR from a fork", ready({ head: { sha: SHA, ref: BRANCH, repo: { full_name: "fork/bis-platform" } } })],
    ["a PR from a deleted fork", ready({ head: { sha: SHA, ref: BRANCH, repo: null } })],
    ["a PR into a branch other than main", ready({ base: { ref: "release" } })],
  ])("refuses %s (mutation: drop that field's test → FAILS)", async (_label, pr) => {
    const r = await run({ body: [pr] });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::No open pull request into main/);
  });

  it("passes when a ready PR is among others (a draft of the same branch elsewhere does not mask it)", async () => {
    const r = await run({ body: [ready({ number: 3, state: "closed" }), ready({ number: 5 })] });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/#5 is open and ready/);
  });

  it.each([
    ["an API error", { status: 500, body: "{}" }],
    ["a body that is not JSON", { body: "<html>" }],
    ["a body that is not a list", { body: { message: "Not Found" } }],
  ])("fails closed on %s, never reading it as ready", async (_label, answer) => {
    const r = await run(answer);
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::/);
    expect(r.output).not.toMatch(/open and ready/);
  });

  it.each(["GITHUB_TOKEN", "GITHUB_API_URL", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_REF_NAME"])("fails closed, naming it, when %s is missing", async (name) => {
    const r = await run({ body: [ready()] }, { [name]: "" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::${name} is empty`));
  });
});
