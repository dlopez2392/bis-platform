// AST-based, not regex, per the owner-approved spec's reasoning: a regex
// over JSX text produces false positives on className strings, numeric
// literals and aria-hooks, and false positives are how a ratchet gate gets
// disabled in frustration instead of fixed.
import ts from "typescript";
import fs from "node:fs"; // top-level, not require() inside countsByFile (plan-review M1 —
import path from "node:path"; // eslint-config-next flags a require() import in a .ts file)

const ALLOWED_ATTRIBUTE_NAMES = new Set(["className", "data-testid", "data-slot", "href", "type", "name"]);

export function scanFile(filePath: string, source: string): number {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;

  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && node.text.trim().length > 0) {
      count += 1;
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const attrName = node.name.getText(sf);
      if (!ALLOWED_ATTRIBUTE_NAMES.has(attrName)) count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

/**
 * Repo-relative, POSIX-separated, regardless of the OS that produced
 * `absPath` or `baseDir` (plan-review C1). Deliberately does NOT use
 * `path.relative`, which parses its inputs with the RUNNING platform's own
 * separator — fed a Windows-style absolute path while running on Linux (or
 * vice versa) it does not split the string correctly at all. Both inputs
 * are normalised to "/" FIRST, then `baseDir` is stripped as a plain string
 * prefix, so a baseline generated on a developer's Windows machine and one
 * generated inside a Linux CI runner key the SAME file identically.
 */
export function relativeKey(baseDir: string, absPath: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const base = norm(baseDir).replace(/\/+$/, "");
  const full = norm(absPath);
  return full.startsWith(base) ? full.slice(base.length + 1) : full;
}

// Decision 2 (2026-10-10): agency-only top-level routes are excluded
// entirely from the scan, not frozen-but-included — DESIGN.md's bilingual
// DoD line is itself qualified ("once a surface carries bilingual copy at
// all"), and these routes are internal tooling with no bilingual intent.
// Exactly the six top-level agency routes lib/nav-groups.ts names (plan-
// review I1) — NOT dashboard/billing, which is the CLIENT's own account-
// scoped billing page (`${base}/billing`) and must stay scanned. Matched
// against `relativeKey`'s output, which is already "/"-separated, so a
// plain "/" in each pattern is correct on every OS — no [\\/] needed.
export const AGENCY_ONLY_ALLOWLIST: RegExp[] = [
  /dashboard\/accounts\/page\.tsx$/, // the agency's accounts LIST page only
  /dashboard\/blueprints\//,
  /dashboard\/work\//,
  /dashboard\/numbers\//,
  /dashboard\/screened\//,
  /dashboard\/plans\//,
];

// The ONE place the scan's roots are named (plan-review I2) — relative to
// `apps/web`, resolved against whatever `baseDir` the caller passes.
export const SCAN_ROOTS: string[] = ["src/app", "src/components"];

export function countsByFile(
  baseDir: string,
  allowlist: RegExp[] = AGENCY_ONLY_ALLOWLIST,
): Record<string, number> {
  const out: Record<string, number> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!full.endsWith(".tsx") || full.endsWith(".test.tsx")) continue;
      const key = relativeKey(baseDir, full);
      if (allowlist.some((re) => re.test(key))) continue;
      out[key] = scanFile(full, fs.readFileSync(full, "utf8"));
    }
  }
  for (const root of SCAN_ROOTS) walk(path.join(baseDir, root));
  return out;
}
