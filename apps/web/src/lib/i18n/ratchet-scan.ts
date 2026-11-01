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
 * "x.es". Agency-only keys are skipped: those under `agencyPrefixes`, and
 * (S-10, owner decision Q4 of 2026-10-31) those in `agencyOnly`, the keys
 * `agencyOnlyKeys` finds read ONLY from agency-only files.
 */
export function keysMissingSpanish(
  catalogue: Readonly<Record<string, string>>,
  agencyPrefixes: readonly string[] = AGENCY_ONLY_KEY_PREFIXES,
  agencyOnly: ReadonlySet<string> = new Set(),
): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(catalogue)) {
    if (key.endsWith(".es")) continue;
    if (agencyPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    if (agencyOnly.has(key)) continue;
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
  // S-10 T0: the design reference, requireAgency at its first line
  // (styleguide/page.tsx:2). Its prose is notes to ourselves; its component
  // demos render EN and ES through the components' own t() reads.
  /dashboard\/styleguide\//,
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

// ---------------------------------------------------------------------------
// S-10 T0 (spec docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md
// §5.2): the agency-only exemption by where a key is READ (G1) and the
// direct-read ratchet (G3). One parse of every source file feeds both.
// ---------------------------------------------------------------------------

/** The routes only BIS staff can open (owner decision Q4, 2026-10-31: they
 *  stay English). A file under one of these is agency-only UNLESS a file
 *  outside them imports it, directly or through other agency files
 *  (`agencyOnlyFiles`): ACCT/documents/page.tsx imports two files from
 *  ACCT/settings/, so a directory alone is not enough. */
export const AGENCY_ONLY_ROUTES: RegExp[] = [
  ...AGENCY_ONLY_ALLOWLIST,
  /^src\/app\/\(dashboard\)\/dashboard\/page\.tsx$/, // the agency home, requireAgency
  /^src\/app\/\(dashboard\)\/dashboard\/accounts\/[^/[][^/]*$/, // the Companies list's own files
  /^src\/app\/\(dashboard\)\/dashboard\/enter\//, // the reason-for-entry chooser, requireAgency
  /\/accounts\/\[accountId\]\/(settings|setup|checklist|voice|automations)\//, // requireAgencyOnlyAccountAccess
];

/** Roots for the source scan: the JSX scan's two plus `src/lib`, where the
 *  copy builders and module-level label tables live. */
export const SOURCE_ROOTS: string[] = ["src/app", "src/components", "src/lib"];

/** The catalogue itself: its keys are definitions, not reads. */
const CATALOGUE_FILE = "src/lib/messages.ts";

export type SourceScan = {
  /** repo-relative file → the repo-relative files it imports (resolved, in-tree only) */
  imports: Map<string, string[]>;
  /** catalogue key → the files whose string literals name it */
  refs: Map<string, Set<string>>;
  /** file → its count of `m[...]` reads, for files that import `m` from the catalogue */
  directReads: Map<string, number>;
};

export function resolveImport(baseDir: string, fromKey: string, spec: string, known: Set<string>): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromKey), spec));
  else return null;
  for (const c of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    if (known.has(c)) return c;
  }
  return null;
}

/** True for an import specifier that names the catalogue module. */
function isCatalogueModule(spec: string): boolean {
  return /(^|\/)messages$/.test(spec);
}

export function scanSourceText(
  key: string, source: string, catalogueKeys: ReadonlySet<string>,
): { specs: string[]; refs: string[]; directReads: number } {
  const sf = ts.createSourceFile(key, source, ts.ScriptTarget.Latest, true, key.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specs: string[] = [];
  const refs: string[] = [];
  let importsM = false;
  let directReads = 0;
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      specs.push(spec);
      const named = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
      if (isCatalogueModule(spec) && named && ts.isNamedImports(named) && named.elements.some((e) => e.name.text === "m" && !e.isTypeOnly)) importsM = true;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && catalogueKeys.has(node.text)) refs.push(node.text);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "m") directReads += 1;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { specs, refs, directReads: importsM ? directReads : 0 };
}

export function scanSources(baseDir: string, catalogueKeys: ReadonlySet<string>): SourceScan {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(full) || /\.test\.tsx?$/.test(full) || full.endsWith(".d.ts")) continue;
      files.push(full);
    }
  }
  for (const root of SOURCE_ROOTS) walk(path.join(baseDir, root));
  const known = new Set(files.map((f) => relativeKey(baseDir, f)));
  const scan: SourceScan = { imports: new Map(), refs: new Map(), directReads: new Map() };
  for (const full of files) {
    const key = relativeKey(baseDir, full);
    if (key === CATALOGUE_FILE) continue;
    const r = scanSourceText(key, fs.readFileSync(full, "utf8"), catalogueKeys);
    scan.imports.set(key, r.specs.map((s) => resolveImport(baseDir, key, s, known)).filter((x): x is string => x !== null));
    for (const k of r.refs) {
      if (!scan.refs.has(k)) scan.refs.set(k, new Set());
      scan.refs.get(k)!.add(key);
    }
    if (r.directReads > 0) scan.directReads.set(key, r.directReads);
  }
  return scan;
}

/** The files `entries` reach through imports, the entries included. */
function closure(imports: ReadonlyMap<string, readonly string[]>, entries: readonly string[]): Set<string> {
  const reached = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    const f = queue.pop()!;
    for (const dep of imports.get(f) ?? []) {
      if (reached.has(dep)) continue;
      reached.add(dep);
      queue.push(dep);
    }
  }
  return reached;
}

/** Every file under `src/app` is a way in: a page, a layout, a route
 *  handler (crons and webhooks included). A file is client-reachable when a
 *  way in outside the agency routes reaches it through imports, and
 *  agency-only when only agency routes do: so ACCT/settings/ files that
 *  ACCT/documents imports are client-reachable, and a banner in
 *  components/ that only /dashboard/work renders is agency-only. A file
 *  nothing reaches (dead, or reached only from outside the scan, such as
 *  src/proxy.ts) is NOT agency-only: nothing proves a client cannot see it. */
export function agencyOnlyFiles(
  imports: ReadonlyMap<string, readonly string[]>,
  routes: readonly RegExp[] = AGENCY_ONLY_ROUTES,
): Set<string> {
  const inRoute = (f: string) => routes.some((re) => re.test(f));
  const ways = [...imports.keys()].filter((f) => f.startsWith("src/app/"));
  const client = closure(imports, ways.filter((f) => !inRoute(f)));
  const agency = closure(imports, ways.filter(inRoute));
  return new Set([...agency].filter((f) => !client.has(f)));
}

/** Keys every literal reference to which sits in an agency-only file. A key
 *  no literal names (built from a template, or read through a variable) is
 *  never exempt: nothing proves a client cannot see it. */
export function agencyOnlyKeys(
  refs: ReadonlyMap<string, ReadonlySet<string>>,
  agencyFiles: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const [key, files] of refs) {
    if (files.size > 0 && [...files].every((f) => agencyFiles.has(f))) out.add(key);
  }
  return out;
}

/** G3's live counts: `m[...]` reads per file, agency-only files left out
 *  (they stay English by decision). A read through `m["x"]` is English
 *  whatever the locale, even when "x.es" exists; only t(), plural() and
 *  makeTr ask for the reader's language. */
export function directReadCounts(scan: SourceScan, agencyFiles: ReadonlySet<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [file, n] of scan.directReads) if (!agencyFiles.has(file)) out[file] = n;
  return out;
}
