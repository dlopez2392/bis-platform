import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/affected-tests.sh lists the tests to run before a push. Why it
// exists (2026-11-12): a PR removed a line from
// .github/scripts/ci-local-supabase.sh, ran only `vitest related` (which
// follows imports), and CI failed ten minutes later on
// apps/web/ci/ci-local-supabase.test.ts, which reads that script BY PATH.
// So every changed file that is not a TypeScript source under a package's
// src/ is also looked up by name in the repo's *.test.ts files.
//
// Run for real, through bash, against a throwaway git repository shaped like
// this one. `pnpm` is a fake on PATH that records each call, so `--run` is
// tested without vitest.

const SCRIPT = fileURLToPath(new URL("../../../scripts/affected-tests.sh", import.meta.url)).replace(/\\/g, "/");

vi.setConfig({ testTimeout: 60_000 });

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

let root = "";
let repo = "";
let fakeBin = "";
let pnpmLog = "";
let bash = "";
let gitEnv: NodeJS.ProcessEnv = { ...process.env };

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, env: gitEnv, encoding: "utf8" }).trim();
}

function write(file: string, content: string) {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** A branch off main carrying one commit of these files, checked out. */
function branch(name: string, changes: Record<string, string>) {
  git("checkout", "-q", "-B", name, "main");
  for (const [file, content] of Object.entries(changes)) write(file, content);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", name);
}

function run(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(bash, [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...gitEnv, PATH: `${fakeBin.replace(/\\/g, "/")}${path.delimiter}${gitEnv.PATH ?? ""}`, FAKE_PNPM_LOG: pnpmLog, ...extraEnv },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

beforeAll(() => {
  bash = bashExecutable();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "affected-tests-"));
  const globalConfig = path.join(root, "gitconfig");
  fs.writeFileSync(globalConfig, "");
  gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo], { env: gitEnv });
  write("apps/web/package.json", '{ "name": "web" }\n');
  write("packages/db/package.json", '{ "name": "@bis/db" }\n');
  write(".github/scripts/ci-local-supabase.sh", "#!/usr/bin/env bash\necho stack\n");
  write("apps/web/ci/ci-local-supabase.test.ts", 'const S = "../../../.github/scripts/ci-local-supabase.sh";\n');
  write("apps/web/src/lib/a.ts", "export const a = 1;\n");
  write("apps/web/src/lib/a.test.ts", 'import { a } from "./a";\n');
  write("apps/web/src/lib/env.test.ts", 'read("apps/web/vitest.config.ts");\n');
  write("apps/web/vitest.config.ts", "export default {};\n");
  write("apps/web/src/app/(dashboard)/page.tsx", "export default function P() { return null; }\n");
  write("packages/db/src/b.ts", "export const b = 1;\n");
  write("packages/db/supabase/seed.sql", "select 1;\n");
  write("packages/db/src/seed.integration.test.ts", 'const f = "supabase/seed.sql";\n');
  write("docs/notes.md", "# notes\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  // A fake pnpm: records its cwd (relative to the repo) and argv, one line a
  // call, and exits FAKE_PNPM_EXIT (0 by default).
  fakeBin = path.join(root, "bin");
  fs.mkdirSync(fakeBin);
  pnpmLog = path.join(root, "pnpm.log").replace(/\\/g, "/");
  fs.writeFileSync(path.join(fakeBin, "pnpm"),
    '#!/usr/bin/env bash\necho "$(basename "$PWD") $*" >> "$FAKE_PNPM_LOG"\nexit "${FAKE_PNPM_EXIT:-0}"\n', { mode: 0o755 });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("scripts/affected-tests.sh", () => {
  it("lists a test that reads a changed shell script BY PATH, the case `vitest related` missed (mutation: drop the by-name lookup → FAILS)", () => {
    branch("script-edit", { ".github/scripts/ci-local-supabase.sh": "#!/usr/bin/env bash\n" });
    const r = run(["main"]);
    expect(r.status, r.output).toBe(0);
    expect(r.stdout).toContain("cd apps/web && pnpm exec vitest run 'ci/ci-local-supabase.test.ts'");
  });

  it("hands a changed TypeScript source under src/ to `vitest related` in its own package, and does not look it up by name", () => {
    branch("src-edit", { "apps/web/src/lib/a.ts": "export const a = 2;\n", "packages/db/src/b.ts": "export const b = 2;\n" });
    const r = run(["main"]);
    expect(r.status, r.output).toBe(0);
    expect(r.stdout).toContain("cd apps/web && pnpm exec vitest related --run 'src/lib/a.ts'");
    expect(r.stdout).toContain("cd packages/db && pnpm exec vitest related --run 'src/b.ts'");
    expect(r.stdout).not.toContain("vitest run");
  });

  it("quotes a path with brackets or parentheses so the printed command pastes into bash", () => {
    branch("paren-edit", { "apps/web/src/app/(dashboard)/page.tsx": "export default function P() { return 1; }\n" });
    const r = run(["main"]);
    expect(r.stdout).toContain("cd apps/web && pnpm exec vitest related --run 'src/app/(dashboard)/page.tsx'");
  });

  it("runs a changed test file itself, and looks a config file outside src/ up by name as well as by import", () => {
    branch("config-edit", {
      "apps/web/vitest.config.ts": "export default { x: 1 };\n",
      "apps/web/src/lib/a.test.ts": 'import { a } from "./a";\n// edited\n',
    });
    const r = run(["main"]);
    expect(r.stdout).toContain("cd apps/web && pnpm exec vitest related --run 'vitest.config.ts'");
    expect(r.stdout).toMatch(/cd apps\/web && pnpm exec vitest run .*'src\/lib\/a\.test\.ts'/);
    expect(r.stdout).toMatch(/cd apps\/web && pnpm exec vitest run .*'src\/lib\/env\.test\.ts'/);
  });

  it("sends packages/db's integration tests through its integration config", () => {
    branch("sql-edit", { "packages/db/supabase/seed.sql": "select 2;\n" });
    const r = run(["main"]);
    expect(r.stdout).toContain("cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts 'src/seed.integration.test.ts'");
  });

  it("includes uncommitted edits, not only commits", () => {
    branch("dirty", {});
    write(".github/scripts/ci-local-supabase.sh", "#!/usr/bin/env bash\necho dirty\n");
    const r = run(["main"]);
    git("checkout", "-q", "--", ".github/scripts/ci-local-supabase.sh");
    expect(r.stdout).toContain("'ci/ci-local-supabase.test.ts'");
  });

  it("says so when no test covers the change, and exits 0", () => {
    branch("docs-edit", { "docs/notes.md": "# notes, edited\n" });
    const r = run(["main"]);
    expect(r.status, r.output).toBe(0);
    expect(r.stdout).toMatch(/No test covers these changes/);
    expect(r.stdout).not.toContain("pnpm exec");
  });

  it("refuses a base ref it cannot resolve, naming it", () => {
    branch("any", {});
    const r = run(["no-such-ref"]);
    expect(r.status).toBe(2);
    expect(r.output).toMatch(/no-such-ref/);
  });

  it("--run executes each listed command in its package and fails when one fails (mutation: ignore a command's exit status → FAILS)", () => {
    branch("run-mode", { ".github/scripts/ci-local-supabase.sh": "#!/usr/bin/env bash\necho run\n", "apps/web/src/lib/a.ts": "export const a = 3;\n" });
    fs.rmSync(pnpmLog, { force: true });
    const ok = run(["--run", "main"]);
    expect(ok.status, ok.output).toBe(0);
    expect(fs.readFileSync(pnpmLog, "utf8").trim().split("\n")).toEqual([
      "web exec vitest related --run src/lib/a.ts",
      "web exec vitest run ci/ci-local-supabase.test.ts",
    ]);
    const bad = run(["--run", "main"], { FAKE_PNPM_EXIT: "1" });
    expect(bad.status, bad.output).toBe(1);
  });
});
