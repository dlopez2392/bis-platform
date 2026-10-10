// AST-based, not regex, per the owner-approved spec's reasoning: a regex
// over JSX text produces false positives on className strings, numeric
// literals and aria-hooks, and false positives are how a ratchet gate gets
// disabled in frustration instead of fixed.
import ts from "typescript";
import fs from "node:fs"; // top-level, not require() inside countsByFile (plan-review M1 —
import path from "node:path"; // eslint-config-next flags a require() import in a .ts file)

/** The attributes that carry words a person reads or hears. Counted ONLY
 *  these (whole-branch review, decision C): the old rule counted every
 *  string attribute NOT on a short allow-list, so `variant="ghost"`,
 *  `role="presentation"` or `id="kpi"` all read as untranslated copy — the
 *  false positives that get a ratchet disabled instead of fixed. */
export const COPY_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "placeholder", "title", "aria-label", "aria-description", "alt", "label",
]);

/** Copy has letters. A JSX text node or attribute with none — "·", " — ",
 *  "2026", "({n})", or `alt=""` on a decorative image — is not translatable
 *  text. `\p{L}` rather than [A-Za-z], so a Spanish-only literal ("¿Qué?")
 *  still counts. */
const HAS_LETTER = /\p{L}/u;

export function scanFile(filePath: string, source: string): number {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;

  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      count += 1;
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const attrName = node.name.getText(sf);
      if (COPY_ATTRIBUTE_NAMES.has(attrName) && HAS_LETTER.test(node.initializer.text)) count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

/** One file over its ceiling. */
export type RatchetViolation = { file: string; live: number; allowed: number };

/**
 * The gate (decision C): a file fails ONLY when its live count RISES above
 * its baseline entry, and a file with no entry (a new file) may only be at
 * zero. A count BELOW baseline passes — translating strings must never break
 * the build — and an entry for a file that no longer exists is ignored; the
 * generator rewrites the baseline from scratch, which tightens ceilings and
 * prunes stale entries in one reviewable commit.
 */
export function ratchetViolations(
  live: Record<string, number>, baseline: Record<string, number>,
): RatchetViolation[] {
  const out: RatchetViolation[] = [];
  for (const [file, count] of Object.entries(live)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) out.push({ file, live: count, allowed });
  }
  return out;
}

/**
 * Catalogue keys that need no Spanish twin: the copy of the six agency-only
 * routes AGENCY_ONLY_ALLOWLIST below excludes from the JSX scan, by the
 * namespace each route reads (decision 2, 2026-10-10 — internal tooling,
 * English-only). Checked against messages.ts and its consumers on
 * 2026-10-10:
 *  - "accounts."    the Companies list and its dialogs (accounts/page.tsx,
 *                   create/adopt dialogs, ACCOUNT_STATUS_LABEL); the few
 *                   in-account readers are Setup, Checklist and Settings,
 *                   all agency-only. NOT "account." (the client dashboard's
 *                   tiles), which is translated.
 *  - "blueprints."  /dashboard/blueprints and Settings' blueprint dialogs.
 *  - "work.agency." /dashboard/work only. Deliberately not "work.": the rest
 *                   of work.* is the CLIENT's own To do list (`${base}/tasks`).
 *  - "numbers."     /dashboard/numbers.
 *  - "screened."    /dashboard/screened.
 *  - "plans."       /dashboard/plans.
 */
export const AGENCY_ONLY_KEY_PREFIXES: readonly string[] = [
  "accounts.", "blueprints.", "work.agency.", "numbers.", "screened.", "plans.",
];

/**
 * The base keys of `catalogue` with no Spanish twin, sorted. A key "x" is
 * twinned by "x.es"; a key "x.en" (the English half of an explicit en/es
 * pair, e.g. sms.consentReply.help.contact.fallback.en) is twinned by
 * "x.es". Agency-only keys are skipped.
 */
export function keysMissingSpanish(
  catalogue: Readonly<Record<string, string>>,
  agencyPrefixes: readonly string[] = AGENCY_ONLY_KEY_PREFIXES,
): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(catalogue)) {
    if (key.endsWith(".es")) continue;
    if (agencyPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    const twin = key.endsWith(".en") ? `${key.slice(0, -3)}.es` : `${key}.es`;
    if (!(twin in catalogue)) missing.push(key);
  }
  return missing.sort();
}

/** Missing keys that are not on the frozen list — every key added from the
 *  day the list was generated needs its twin. A frozen entry that has since
 *  gained one (or been deleted) simply stops mattering: shrinking is free. */
export function parityViolations(missing: readonly string[], frozen: readonly string[]): string[] {
  const allowed = new Set(frozen);
  return missing.filter((key) => !allowed.has(key));
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
