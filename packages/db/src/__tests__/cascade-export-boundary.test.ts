import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `index.ts` exports `deleteAccountCascade` and `ACCOUNT_OWNED_TABLES`
 * (index.ts:140) so `test/fixtures.ts` and the two web test files that build
 * their own throwaway-account fixtures
 * (`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`,
 * `apps/web/src/app/f/[publicId]/actions.returning-lead.test.ts`) can share
 * one FK-ordered delete list instead of hand-rolling it. That export is a
 * tenant-deleting function guarded only by a comment (`account-teardown.ts`'s
 * own doc block), twenty lines below `demo/seed.ts`'s opposite policy for the
 * same shape of danger — its `SEEDABLE_ORG_ID` regex keeps a real Clerk id
 * out of its own destructive path in code, not prose. Nothing in the
 * toolchain stops a real app route or server action from importing
 * `deleteAccountCascade` and deleting a live tenant's account on a bad
 * request; no `no-restricted-imports` rule exists for it. This walks the
 * source instead of trusting the comment: every non-test file under
 * `apps/web/src` must not import either symbol from `@bis/db`.
 *
 * Two things have to be true together, both lessons paid for elsewhere in
 * this repo (`outbound-suppressed.test.ts`'s "a comment cannot vouch for a
 * function"):
 *   - comments are stripped before matching, so a file that only MENTIONS
 *     `deleteAccountCascade` in prose (e.g. explaining why it does NOT use
 *     it) cannot trip this guard by accident;
 *   - the check matches an IMPORT — a named import off the literal
 *     `"@bis/db"` specifier — not any appearance of the identifier, so a
 *     local variable or string with the same name cannot false-positive.
 *
 * Mutation: add `import { deleteAccountCascade } from "@bis/db";` to any
 * non-test file under apps/web/src (e.g. `lib/automations/caps.ts`) — this
 * fails by name, naming the offending file.
 */
const WEB_SRC = path.join(__dirname, "..", "..", "..", "..", "apps", "web", "src");
const GUARDED_SYMBOLS = ["deleteAccountCascade", "ACCOUNT_OWNED_TABLES"] as const;

/**
 * Copied from `outbound-suppressed.test.ts`, not imported: that file exports
 * nothing, and a shared-helper module is one more file to keep honest for
 * two lines of logic used in exactly two places. Strings are tracked so a
 * `//` inside a literal (a URL) does not eat the rest of its line, and block
 * comments keep their newlines so line-shaped assertions elsewhere still see
 * the same geometry.
 */
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
    // inside a string literal
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

/** Named imports off the literal `"@bis/db"` specifier, comments stripped. */
function namedImportsFromBisDb(code: string): string[] {
  const names: string[] = [];
  const re = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*["']@bis\/db["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    for (const raw of (m[1] ?? "").split(",")) {
      const name = (raw.trim().split(/\s+as\s+/)[0] ?? "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("deleteAccountCascade / ACCOUNT_OWNED_TABLES stay inside test code", () => {
  it("no non-test file under apps/web/src imports either from @bis/db", () => {
    const files = walk(WEB_SRC);
    // Floor is a round number well below today's real count (412 on
    // 2026-09-22) so a wrong-but-existing directory (e.g. an empty one, or
    // one pointed at a stray handful of files) fails loudly instead of
    // vacuously passing an empty `offenders` list.
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const imported = namedImportsFromBisDb(stripComments(fs.readFileSync(file, "utf8")));
      for (const symbol of GUARDED_SYMBOLS) {
        if (imported.includes(symbol)) {
          // `path.relative` yields BACKSLASHES on Windows and forward slashes
          // on CI's Linux runner; normalised as create-account-callers.test.ts
          // does, so the offender reads the same wherever the guard fires.
          offenders.push(`${path.relative(WEB_SRC, file).split(path.sep).join("/")}: ${symbol}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("matches an import, not a mention — a comment naming the symbol cannot trip it", () => {
    const onlyAComment =
      `// deleteAccountCascade is deliberately not used in this file — see\n` +
      `// packages/db/src/account-teardown.ts for why a route must never call it.\n` +
      `export const x = 1;`;
    expect(namedImportsFromBisDb(stripComments(onlyAComment))).toEqual([]);

    const theRealImport = `import { deleteAccountCascade } from "@bis/db";\nexport const y = 1;`;
    expect(namedImportsFromBisDb(stripComments(theRealImport))).toContain("deleteAccountCascade");

    const theRealMultilineImport =
      `import {\n  serviceDb,\n  ACCOUNT_OWNED_TABLES,\n} from "@bis/db";\n`;
    expect(namedImportsFromBisDb(stripComments(theRealMultilineImport)))
      .toContain("ACCOUNT_OWNED_TABLES");
  });

  it("the two fixture files that DO import it are test files, so the walk skips them", () => {
    expect(isTestFile(path.join(WEB_SRC, "app", "f", "[publicId]", "actions.returning-lead.test.ts")))
      .toBe(true);
    expect(isTestFile(path.join(
      WEB_SRC, "app", "(dashboard)", "dashboard", "accounts", "[accountId]",
      "calls", "[callId]", "actions.test.ts"))).toBe(true);
  });
});
