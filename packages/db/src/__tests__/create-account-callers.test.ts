import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `createAccount` has exactly ONE non-test caller in production code, and the
 * refusal that keeps a test-shaped org id out of the accounts table sits in
 * that caller rather than in `createAccount` itself
 * (`apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts` — see the
 * comment there for why: every fixture in this repo calls `createAccount`
 * with an `org_test_` id on purpose, so a guard inside it would fail the
 * suites it exists to protect).
 *
 * That design is only safe while the door stays single. A second production
 * caller would bypass the refusal silently, and the first sign of it would be
 * a real tenant's account being swept away an hour after it was created. So
 * this walks the source instead of trusting the shape to hold: the set of
 * non-test files under `apps/web/src` that CALL `createAccount` must be
 * exactly the one that carries the guard.
 *
 * Scope is `apps/web/src` alone, deliberately. `packages/db/src/demo/seed.ts`
 * also calls `createAccount`, but only through `demo/run.ts` — a manual
 * `db:seed-demo`, never CI and never a deploy — and behind its own
 * `assertSeedableOrgId` gate, whose regex admits ONLY `org_demo_`/`org_test_`
 * ids. A live Clerk id cannot reach it, so it is not a door onto production
 * and does not belong in this list.
 *
 * Two things have to be true together, as in `cascade-export-boundary.test.ts`:
 *   - comments are stripped before matching, so prose explaining why a file
 *     does NOT call `createAccount` cannot trip the guard;
 *   - import statements are stripped too, so the import that the real caller
 *     needs — and any future re-export — is not mistaken for a call.
 */
const WEB_SRC = path.join(__dirname, "..", "..", "..", "..", "apps", "web", "src");
const GUARDED_CALLER = "app/(dashboard)/dashboard/accounts/actions.ts";

/** Copied from `cascade-export-boundary.test.ts` (which copied it in turn). */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

const isTestFile = (file: string) =>
  /\.(test|spec)\.tsx?$/.test(file) || file.split(path.sep).includes("__tests__");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !isTestFile(full)) out.push(full);
  }
  return out;
}

/** `import … from "…"` in any of its forms, so an import is never a call. */
function stripImports(code: string): string {
  return code.replace(/import\s+[\s\S]*?\s+from\s*["'][^"']*["']\s*;?/g, "");
}

/** A CALL: the identifier followed by an open paren, comments and imports gone. */
function callsCreateAccount(source: string): boolean {
  return /\bcreateAccount\s*\(/.test(stripImports(stripComments(source)));
}

describe("createAccount has one production caller, the one carrying the refusal", () => {
  it("no non-test file under apps/web/src calls createAccount except the guarded action", () => {
    const files = walk(WEB_SRC);
    // Floor well below the real count (412 on 2026-09-22): a wrong-but-existing
    // directory would otherwise pass vacuously on an empty callers list.
    expect(files.length).toBeGreaterThan(100);
    const callers: string[] = [];
    for (const file of files) {
      if (callsCreateAccount(fs.readFileSync(file, "utf8"))) {
        // `path.relative` yields BACKSLASHES on Windows and forward slashes on
        // CI's Linux runner; normalising here is what lets one literal name the
        // file on both.
        callers.push(path.relative(WEB_SRC, file).split(path.sep).join("/"));
      }
    }
    expect(callers).toEqual([GUARDED_CALLER]);
  });

  it("the guarded caller is where the walk says it is, and it carries the refusal", () => {
    const src = fs.readFileSync(path.join(WEB_SRC, ...GUARDED_CALLER.split("/")), "utf8");
    expect(callsCreateAccount(src)).toBe(true);
    expect(stripComments(src)).toContain("isTestOrgId(org.id)");
  });

  it("matches a call, not a mention and not an import", () => {
    expect(callsCreateAccount(
      `// createAccount( is deliberately not called here — see actions.ts.\n` +
      `export const x = 1;`)).toBe(false);
    expect(callsCreateAccount(
      `/* createAccount(db, …) belongs to the accounts action. */\nexport const y = 1;`)).toBe(false);
    expect(callsCreateAccount(
      `import { createAccount } from "@bis/db";\nexport const z = 1;`)).toBe(false);
    expect(callsCreateAccount(
      `import { createAccount } from "@bis/db";\nawait createAccount(db, input);`)).toBe(true);
  });
});
