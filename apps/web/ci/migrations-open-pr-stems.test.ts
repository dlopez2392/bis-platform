import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * .github/scripts/migrations-open-pr-stems.mjs (migration pipeline PR 6b,
 * 2026-11-15): which migrations do OPEN pull requests into main, from this
 * repository, ADD? migrations-production writes the answer (`<stem> <pr>`
 * lines) before its secret step, and the runner's --parity reads it: a
 * bis-ci-only row no open PR adds is an orphan and fails parity. Anything the
 * script cannot read fails the job, never an empty (all-orphan or
 * all-in-flight) list. A fake API on loopback answers; the script runs as CI
 * runs it (node, env only).
 */
const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/migrations-open-pr-stems.mjs", import.meta.url));
const REPO = "owner/bis-platform";
const TOKEN = "ghs_faketoken_never_printed";
const DIR = "packages/db/supabase/migrations";

type Pr = { number: number; state: string; draft: boolean; head: { repo: { full_name: string } | null }; base: { ref: string } };
type File = { filename: string; status: string };
const pr = (number: number, over: Partial<Pr> = {}): Pr => ({
  number, state: "open", draft: false, head: { repo: { full_name: REPO } }, base: { ref: "main" }, ...over,
});
const added = (stem: string): File => ({ filename: `${DIR}/${stem}.sql`, status: "added" });
const other = (i: number): File => ({ filename: `apps/web/src/f${i}.ts`, status: "modified" });

let server: http.Server;
let api = "";
/** Route -> [status, body]. A missing route answers 404. */
let routes: Record<string, [number, string]> = {};
let seen: { url: string; auth?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", auth: req.headers.authorization });
    const [status, body] = routes[req.url ?? ""] ?? [404, JSON.stringify({ message: "Not Found" })];
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const pullsUrl = (page: number) => `/repos/${REPO}/pulls?state=open&base=main&per_page=100&page=${page}`;
const filesUrl = (n: number, page: number) => `/repos/${REPO}/pulls/${n}/files?per_page=100&page=${page}`;
const json = (body: unknown): [number, string] => [200, JSON.stringify(body)];

/** Serves `prs` (paged by 100) and each PR's files (paged by 100). */
function serve(prs: Pr[], filesOf: Record<number, File[]> = {}) {
  routes = {};
  for (let p = 0; p * 100 <= prs.length; p++) routes[pullsUrl(p + 1)] = json(prs.slice(p * 100, p * 100 + 100));
  for (const { number } of prs) {
    const fl = filesOf[number] ?? [];
    for (let p = 0; p * 100 <= fl.length; p++) routes[filesUrl(number, p + 1)] = json(fl.slice(p * 100, p * 100 + 100));
  }
}

let out = "";
function run(env: Record<string, string> = {}) {
  seen = [];
  out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "open-pr-stems-")), "stems.txt");
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      NODE_ENV: "test", PATH: process.env.PATH ?? "",
      GITHUB_API_URL: api, GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN, BIS_MIGRATIONS_OPEN_PR_STEMS: out,
      ...env,
    },
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  return new Promise<{ status: number | null; output: string; stems: string | null }>((resolve) =>
    child.on("close", (status) => resolve({ status, output, stems: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null })));
}

describe("migrations-open-pr-stems.mjs: the migrations open pull requests add (migration pipeline PR 6b)", () => {
  it("lists every added migration of every open same-repo PR, drafts included, across two pages of PRs and two pages of files, with the job's token (mutation: read page 1 only → FAILS)", async () => {
    const many = Array.from({ length: 100 }, (_, i) => pr(1000 + i));
    serve([...many, pr(7, { draft: true }), pr(8)], {
      1000: [added("20261115000000_first_page")],
      7: [...Array.from({ length: 100 }, (_, i) => other(i)), added("20261116000000_draft_second_files_page")],
      8: [added("20261117000000_last"), added("20261117000001_last_two")],
    });
    const r = await run();
    expect(r.status, r.output).toBe(0);
    expect(r.stems).toBe([
      "20261115000000_first_page 1000",
      "20261116000000_draft_second_files_page 7",
      "20261117000000_last 8",
      "20261117000001_last_two 8",
      "",
    ].join("\n"));
    expect(seen.map((s) => s.url)).toContain(pullsUrl(2));
    expect(seen.map((s) => s.url)).toContain(filesUrl(7, 2));
    expect(seen.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("writes an empty list when no open PR adds a migration: that is an answer, not a failure", async () => {
    serve([pr(3)], { 3: [other(1)] });
    const r = await run();
    expect(r.status, r.output).toBe(0);
    expect(r.stems).toBe("");
  });

  it("ignores a fork's PR, never asking for its files: a fork cannot vouch for a bis-ci row (mutation: accept any head repo → FAILS)", async () => {
    serve([pr(4, { head: { repo: { full_name: "fork/bis-platform" } } }), pr(5, { head: { repo: null } })], {
      4: [added("20261115000000_from_fork")],
      5: [added("20261115000001_from_deleted_fork")],
    });
    const r = await run();
    expect(r.status, r.output).toBe(0);
    expect(r.stems).toBe("");
    expect(seen.map((s) => s.url).filter((u) => u.includes("/files"))).toEqual([]);
  });

  it("ignores a PR into another branch, and a closed one, if the API ever returns them", async () => {
    serve([pr(4, { base: { ref: "release" } }), pr(5, { state: "closed" })], {
      4: [added("20261115000000_into_release")],
      5: [added("20261115000001_closed")],
    });
    const r = await run();
    expect(r.status, r.output).toBe(0);
    expect(r.stems).toBe("");
  });

  it("keeps only ADDED timestamped migrations: a modified, removed or renamed migration, a numbered one, a non-.sql file and a file elsewhere are not listed (mutation: drop the status test → FAILS)", async () => {
    serve([pr(9)], {
      9: [
        { filename: `${DIR}/20261115000000_modified.sql`, status: "modified" },
        { filename: `${DIR}/20261115000001_removed.sql`, status: "removed" },
        { filename: `${DIR}/20261115000002_renamed.sql`, status: "renamed" },
        { filename: `${DIR}/0117_numbered.sql`, status: "added" },
        { filename: `${DIR}/20261115000003_notes.md`, status: "added" },
        { filename: `${DIR}/nested/20261115000004_nested.sql`, status: "added" },
        { filename: "packages/db/20261115000005_elsewhere.sql", status: "added" },
        added("20261115000006_kept"),
      ],
    });
    const r = await run();
    expect(r.status, r.output).toBe(0);
    expect(r.stems).toBe("20261115000006_kept 9\n");
  });

  it("fails closed on a PR whose file list is at GitHub's 3000-file cap: its migrations cannot all be seen (mutation: drop the cap → FAILS)", async () => {
    serve([pr(11)], { 11: Array.from({ length: 3000 }, (_, i) => other(i)) });
    const r = await run();
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::PR #11 .*3000/);
    expect(r.stems).toBeNull();
  });

  it.each([
    ["the PR list answers 500", () => { routes[pullsUrl(1)] = [500, "{}"]; }],
    ["the PR list is not JSON", () => { routes[pullsUrl(1)] = [200, "<html>"]; }],
    ["the PR list is not a list", () => { routes[pullsUrl(1)] = json({ message: "Bad credentials" }); }],
    ["a PR has no number", () => { routes[pullsUrl(1)] = json([{ ...pr(3), number: "3" }]); }],
    ["a PR's files answer 500", () => { routes[filesUrl(3, 1)] = [500, "{}"]; }],
    ["a PR's files are not JSON", () => { routes[filesUrl(3, 1)] = [200, "not json"]; }],
    ["a PR's files are not a list", () => { routes[filesUrl(3, 1)] = json({}); }],
    ["a file has no filename", () => { routes[filesUrl(3, 1)] = json([{ status: "added" }]); }],
  ])("fails closed, writing no list, when %s (mutation: treat it as no PR → FAILS)", async (_label, breakIt) => {
    serve([pr(3)], { 3: [added("20261115000000_x")] });
    breakIt();
    const r = await run();
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::/);
    expect(r.stems).toBeNull();
  });

  // A failure on a LATER page is as unreadable as one on page 1: never the
  // end of the list (review of #373: two probes survived without these).
  it("fails closed, writing no list, when page 2 of the open PRs answers 500 (mutation: a non-OK page ≥2 ends the list → FAILS)", async () => {
    const many = Array.from({ length: 101 }, (_, i) => pr(1000 + i));
    serve(many, { 1100: [added("20261115000000_on_page_two")] });
    routes[pullsUrl(2)] = [500, "{}"];
    const r = await run();
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::The API answered 500 for open pull requests \(page 2\)/);
    expect(r.stems).toBeNull();
  });

  it("fails closed, writing no list, when page 2 of a PR's files answers 500 (mutation: a non-OK page ≥2 ends the list → FAILS)", async () => {
    serve([pr(3)], { 3: [...Array.from({ length: 100 }, (_, i) => other(i)), added("20261115000000_on_page_two")] });
    routes[filesUrl(3, 2)] = [500, "{}"];
    const r = await run();
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::The API answered 500 for PR #3's files \(page 2\)/);
    expect(r.stems).toBeNull();
  });

  it("fails closed when the API cannot be reached at all", async () => {
    const r = await run({ GITHUB_API_URL: "http://127.0.0.1:1" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::/);
    expect(r.stems).toBeNull();
  });

  it("never prints the token, in success or failure", async () => {
    serve([pr(3)], { 3: [added("20261115000000_x")] });
    const ok = await run();
    expect(ok.status, ok.output).toBe(0);
    expect(ok.output).not.toContain(TOKEN);
    expect(ok.stems).not.toContain(TOKEN);
    routes[pullsUrl(1)] = [401, JSON.stringify({ message: `token ${TOKEN} is bad` })];
    const bad = await run();
    expect(bad.status, bad.output).toBe(1);
    expect(bad.output).not.toContain(TOKEN);
  });

  it.each(["GITHUB_TOKEN", "GITHUB_API_URL", "GITHUB_REPOSITORY", "BIS_MIGRATIONS_OPEN_PR_STEMS"])("fails closed, naming it, when %s is missing", async (name) => {
    serve([pr(3)]);
    const r = await run({ [name]: "" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::${name} is empty`));
  });
});
