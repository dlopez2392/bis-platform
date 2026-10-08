import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// .github/scripts/ci-docs-only.sh decides whether a push changes ONLY files
// no gate reads (docs, agent notes, LICENSE). When it says so, ci.yml's
// `verify` and `e2e` jobs still run and still end `success` on the head SHA —
// which is what the ruleset on main requires — but skip the install, the
// Supabase-touching suites, the build and Playwright. A wrong "docs only" is
// therefore a green check on code nobody tested, so every case below that
// carries code expects `false`, and the default for anything unrecognised is
// `false` too.
//
// The script is run for real, through bash, against real git repositories
// built in a temp directory: an `origin` with a `main` and one branch per
// case, cloned the way actions/checkout clones (`--depth 1`, file://, so the
// script has to fetch main's history itself exactly as it must on a runner).
// Nothing here touches the network.

const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/ci-docs-only.sh", import.meta.url)).replace(/\\/g, "/");

// Real bash and real git, several of each per case; Windows starts both slowly.
vi.setConfig({ testTimeout: 60_000 });

let root = "";
let origin = "";
let work = "";
let bash = "";
/** Replaced in beforeAll: isolated git config, no GITHUB_* from a runner. */
let gitEnv: NodeJS.ProcessEnv = { ...process.env };

/** Git for Windows' bash (never WSL's launcher), or plain bash elsewhere. No bash is a FAILURE. */
function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const candidates = [
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).map((b) => path.join(b!, "Git")),
    path.resolve(execPath, "..", "..", ".."),
  ].map((r) => path.join(r, "usr", "bin", "bash.exe"));
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`No Git for Windows bash found (looked at: ${candidates.join(", ")})`);
  return found;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

/** Write (string) or delete (null) each path in the work tree, then commit. */
function commit(changes: Record<string, string | null>, message: string) {
  for (const [file, content] of Object.entries(changes)) {
    const full = path.join(work, file);
    if (content === null) {
      git(work, "rm", "-q", file);
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      git(work, "add", "--", file);
    }
  }
  git(work, "commit", "-q", "-m", message);
}

/** A branch off origin's CURRENT main carrying each commit in turn, pushed. */
function branch(name: string, ...commits: Record<string, string | null>[]) {
  git(work, "checkout", "-q", "-B", name, "origin/main");
  commits.forEach((c, i) => commit(c, `${name} ${i}`));
  git(work, "push", "-q", "origin", `${name}:${name}`);
}

/** A file whose content `git mv` detection would pair with a docs copy. */
const CODE_BODY = Array.from({ length: 40 }, (_, i) => `export const line${i} = ${i};`).join("\n") + "\n";

beforeAll(() => {
  bash = bashExecutable();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-docs-only-"));
  const globalConfig = path.join(root, "gitconfig");
  fs.writeFileSync(globalConfig, "");
  gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  for (const k of Object.keys(gitEnv)) if (k.startsWith("GITHUB_")) delete gitEnv[k];

  origin = path.join(root, "origin.git");
  work = path.join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: gitEnv });
  execFileSync("git", ["clone", "-q", pathToFileURL(origin).href, work], { env: gitEnv });
  git(work, "checkout", "-q", "-b", "main");
  commit({
    "README.md": "# repo\n",
    "apps/web/src/lib/x.ts": CODE_BODY,
    "docs/runbooks/a.md": "a\n",
    "package.json": "{}\n",
  }, "base");
  git(work, "push", "-q", "origin", "main");
  git(work, "fetch", "-q", "origin");

  // Docs only: every one of these must come back `true`.
  branch("docs-root-md", { "README.md": "# repo, edited\n" });
  branch("docs-tree", { "docs/runbooks/a.md": "edited\n", "docs/design/mock.html": "<p>mockup</p>\n" });
  branch("docs-agents", { ".claude/agents/bis-platform.md": "lesson\n" });
  branch("docs-nested-md", { "apps/web/README.md": "web\n", "packages/db/NOTES.md": "db\n" });
  branch("docs-license", { LICENSE: "MIT\n" });
  branch("docs-issue-template", { ".github/ISSUE_TEMPLATE/bug.md": "bug\n" });
  branch("docs-delete", { "docs/runbooks/a.md": null });
  branch("docs-two-commits", { "README.md": "one\n" }, { "docs/b.md": "two\n" });

  // Anything a gate reads: every one of these must come back `false`.
  branch("code-ts", { "apps/web/src/lib/x.ts": CODE_BODY + "export const more = 1;\n" });
  branch("code-mixed", { "README.md": "docs\n", "apps/web/src/lib/y.tsx": "export {};\n" });
  branch("code-workflow", { ".github/workflows/ci.yml": "on: push\n" });
  branch("code-workflow-md", { ".github/workflows/README.md": "about the workflows\n" });
  branch("code-script", { ".github/scripts/ci-docs-only.sh": "exit 0\n" });
  branch("code-env-example", { ".env.example": "X=1\n" });
  branch("code-env-under-docs", { "docs/.env.example": "X=1\n" });
  branch("code-lockfile", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  branch("code-package-json", { "package.json": "{\"x\":1}\n" });
  branch("code-migration", { "packages/db/supabase/migrations/0099_x.sql": "select 1;\n" });
  branch("code-css", { "apps/web/src/styles/tokens.css": ":root{}\n" });
  branch("code-json-under-claude", { ".claude/settings.json": "{}\n" });
  branch("code-ts-under-docs", { "docs/tool.ts": "export {};\n" });
  branch("code-hook", { ".githooks/pre-push": "#!/bin/sh\n" });
  // A rename out of the code tree: rename detection would list only the new
  // docs path and hide that x.ts was deleted.
  branch("code-renamed-into-docs", { "apps/web/src/lib/x.ts": null, "docs/x.md": CODE_BODY });
  // Code first, docs second: the LATEST push changes only docs, but the head
  // SHA's check must cover everything the branch changes against main, or a
  // red code commit is papered over by a green docs commit on top of it.
  branch("code-then-docs", { "apps/web/src/lib/x.ts": CODE_BODY + "// changed\n" }, { "docs/c.md": "c\n" });
  branch("no-changes");

  // main moves on with code AFTER this branch forked: the branch itself still
  // changes only docs, and the merge-base diff must not count main's commit.
  branch("docs-behind-main", { "docs/behind.md": "behind\n" });
  git(work, "checkout", "-q", "main");
  commit({ "apps/web/src/lib/z.ts": "export {};\n" }, "main moves on");
  git(work, "push", "-q", "origin", "main");
  git(work, "fetch", "-q", "origin");

  // A docs-only commit landed on main itself.
  commit({ "docs/on-main.md": "main\n" }, "docs on main");
  git(work, "push", "-q", "origin", "main");

  const warm = spawnSync(bash, ["-c", ":"], { encoding: "utf8" });
  if (warm.error) throw warm.error;
}, 180_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

type Result = { status: number | null; output: string; docsOnly: string | undefined };

/** Clone `ref` the way actions/checkout does, then run the script in it. */
function decide(branchName: string, env: { event?: string; ref?: string } = {}): Result {
  const clone = fs.mkdtempSync(path.join(root, "ci-"));
  execFileSync("git", ["clone", "-q", "--depth", "1", "--no-tags", "--branch", branchName, pathToFileURL(origin).href, clone], { env: gitEnv });
  const outputFile = path.join(clone, "..", `${path.basename(clone)}.out`);
  fs.writeFileSync(outputFile, "");
  const run = spawnSync(bash, [SCRIPT], {
    cwd: clone,
    encoding: "utf8",
    env: {
      ...gitEnv,
      GITHUB_EVENT_NAME: env.event ?? "push",
      GITHUB_REF: env.ref ?? `refs/heads/${branchName}`,
      GITHUB_OUTPUT: outputFile,
    },
  });
  if (run.error) throw run.error;
  const written = fs.readFileSync(outputFile, "utf8");
  const docsOnly = /^docs_only=(.*)$/m.exec(written)?.[1];
  return { status: run.status, output: `${run.stdout}${run.stderr}`, docsOnly };
}

describe("ci-docs-only.sh says `true` only when every changed file is docs", () => {
  it.each([
    ["docs-root-md", "a root *.md"],
    ["docs-tree", "anything under docs/ that is not code (a .md and a design mockup)"],
    ["docs-agents", ".claude/agents/*.md"],
    ["docs-nested-md", "*.md inside apps/ and packages/"],
    ["docs-license", "LICENSE"],
    ["docs-issue-template", ".github/ISSUE_TEMPLATE/**"],
    ["docs-delete", "a deleted doc"],
    ["docs-two-commits", "two docs-only commits"],
    ["docs-behind-main", "a docs-only branch that main has moved past with code"],
  ])("%s (%s) → true", (name) => {
    const r = decide(name);
    expect(r.status, r.output).toBe(0);
    expect(r.docsOnly, r.output).toBe("true");
  });
});

describe("ci-docs-only.sh says `false` for anything a gate could read", () => {
  it.each([
    ["code-ts", "a .ts file"],
    ["code-mixed", "docs plus one .tsx"],
    ["code-workflow", ".github/workflows/ci.yml"],
    ["code-workflow-md", "even a .md under .github/workflows/"],
    ["code-script", "the decision script itself"],
    ["code-env-example", ".env.example"],
    ["code-env-under-docs", "an env file even under docs/ (env files win over the allowlist)"],
    ["code-lockfile", "pnpm-lock.yaml"],
    ["code-package-json", "package.json"],
    ["code-migration", "a .sql migration"],
    ["code-css", "a .css file"],
    ["code-json-under-claude", "a .json under .claude/ (code extensions win over the allowlist)"],
    ["code-ts-under-docs", "a .ts under docs/ (code extensions win over the allowlist)"],
    ["code-hook", ".githooks/pre-push"],
    ["code-renamed-into-docs", "code renamed into docs/ (the deletion counts)"],
    ["code-then-docs", "a code commit with a docs commit on top (the whole branch counts, not the last push)"],
    ["no-changes", "a branch identical to main (nothing to judge, so run everything)"],
  ])("%s (%s) → false", (name) => {
    const r = decide(name);
    expect(r.status, r.output).toBe(0);
    expect(r.docsOnly, r.output).toBe("false");
  });
});

describe("ci-docs-only.sh never skips outside a branch push", () => {
  it("a push to main runs everything, even when main's latest commit is docs only", () => {
    const r = decide("main");
    expect(r.status, r.output).toBe(0);
    expect(r.docsOnly, r.output).toBe("false");
  });

  it("the main refusal stands on its own, not only through the empty diff a push to main produces (ref main, on a tree whose diff against main IS docs only)", () => {
    // On a real push to main the merge base is HEAD, so the diff is empty and
    // the empty-diff rule alone already says false; the case above cannot
    // tell the two rules apart. This one can.
    const r = decide("docs-root-md", { ref: "refs/heads/main" });
    expect(r.status, r.output).toBe(0);
    expect(r.docsOnly, r.output).toBe("false");
  });

  it("a manual workflow_dispatch runs everything, even on a docs-only branch", () => {
    const r = decide("docs-root-md", { event: "workflow_dispatch" });
    expect(r.docsOnly, r.output).toBe("false");
  });

  it("a tag push runs everything", () => {
    const r = decide("docs-root-md", { ref: "refs/tags/v1" });
    expect(r.docsOnly, r.output).toBe("false");
  });

  it("an unreadable history (no main to compare with) runs everything instead of failing the job", () => {
    const r = decide("docs-root-md", { ref: "refs/heads/docs-root-md" });
    expect(r.docsOnly).toBe("true"); // the control: the same branch, history readable
    const broken = fs.mkdtempSync(path.join(root, "ci-broken-"));
    execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "docs-root-md", pathToFileURL(origin).href, broken], { env: gitEnv });
    git(broken, "remote", "set-url", "origin", pathToFileURL(path.join(root, "missing.git")).href);
    const outputFile = path.join(root, "broken.out");
    fs.writeFileSync(outputFile, "");
    const run = spawnSync(bash, [SCRIPT], {
      cwd: broken, encoding: "utf8",
      env: { ...gitEnv, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/docs-root-md", GITHUB_OUTPUT: outputFile },
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(fs.readFileSync(outputFile, "utf8")).toMatch(/^docs_only=false$/m);
  });
});
