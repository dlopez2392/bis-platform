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
// Exactly the six top-level agency routes lib/nav-groups.ts names, which
// since F-087 part 1 reads them off lib/surfaces/manifest.ts's own
// agency-top-scoped entries rather than inlining them (plan-review I1) —
// NOT dashboard/billing, which is the CLIENT's own account-
// scoped billing page (`${base}/billing`) and must stay scanned. Matched
// against `relativeKey`'s output, which is already "/"-separated, so a
// plain "/" in each pattern is correct on every OS — no [\\/] needed.
export const AGENCY_ONLY_ALLOWLIST: RegExp[] = [
  // Anchored at the agency's own top level (S-10 review M-3): unanchored,
  // /dashboard\/work\// also matched any client route that merely contained
  // "dashboard/work/" (accounts/[accountId]/dashboard/work/...).
  /^src\/app\/\(dashboard\)\/dashboard\/accounts\/page\.tsx$/, // the agency's accounts LIST page only
  /^src\/app\/\(dashboard\)\/dashboard\/blueprints\//,
  /^src\/app\/\(dashboard\)\/dashboard\/work\//,
  /^src\/app\/\(dashboard\)\/dashboard\/numbers\//,
  /^src\/app\/\(dashboard\)\/dashboard\/screened\//,
  /^src\/app\/\(dashboard\)\/dashboard\/plans\//,
  // S-10 T0: the design reference, requireAgency at its first line
  // (styleguide/page.tsx:2). Its prose is notes to ourselves; its component
  // demos render EN and ES through the components' own t() reads.
  /^src\/app\/\(dashboard\)\/dashboard\/styleguide\//,
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
  // The local names the catalogue `m` is bound to in this file: "m", or an
  // alias (`import { m as messages }`, S-10 review M-1).
  const catalogueNames = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !isCatalogueModule(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (st.importClause?.isTypeOnly || !named || !ts.isNamedImports(named)) continue;
    for (const e of named.elements) {
      if (!e.isTypeOnly && (e.propertyName ?? e.name).text === "m") catalogueNames.add(e.name.text);
    }
  }
  const isCatalogue = (n: ts.Node) => ts.isIdentifier(n) && catalogueNames.has(n.text);
  let directReads = 0;
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && catalogueKeys.has(node.text)) refs.push(node.text);
    if (ts.isElementAccessExpression(node) && isCatalogue(node.expression)) directReads += 1;
    // S-10 review I-1: t(m, key, "en") and plural(m, key, n, "en") hard-code
    // the language exactly as m["key"] does, so they count the same.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments[0] && isCatalogue(node.arguments[0])) {
      const fn = node.expression.text;
      const localeArg = fn === "t" ? node.arguments[2] : fn === "plural" ? node.arguments[3] : undefined;
      if (localeArg && (ts.isStringLiteral(localeArg) || ts.isNoSubstitutionTemplateLiteral(localeArg))) directReads += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { specs, refs, directReads };
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
  scan.refs = withPluralForms(scan.refs, catalogueKeys);
  return scan;
}

/** S-10 review I-2: `plural(m, "x", n, locale)` and `tr.count("x", n)` read
 *  "xOne" (and an "xOther", where one exists) at runtime, though only "x" is
 *  written, so each form is referenced wherever its base key is. */
export function withPluralForms(
  refs: ReadonlyMap<string, ReadonlySet<string>>, catalogueKeys: ReadonlySet<string>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>([...refs].map(([k, files]) => [k, new Set(files)]));
  for (const [k, files] of refs) {
    for (const form of [`${k}One`, `${k}Other`]) {
      if (!catalogueKeys.has(form)) continue;
      if (!out.has(form)) out.set(form, new Set());
      for (const f of files) out.get(form)!.add(f);
    }
  }
  return out;
}

/** Files that demo client components (S-10 review I-2): agency-only to open,
 *  but a key named there is a client key shown in a demo, so a reference
 *  there never makes a key exempt. */
export const DEMO_FILES: RegExp[] = [/^src\/app\/\(dashboard\)\/dashboard\/styleguide\//];

/** The agency-only files whose references CAN exempt a key: all but the demos. */
export function agencyFilesForExemption(agencyFiles: ReadonlySet<string>, demos: readonly RegExp[] = DEMO_FILES): Set<string> {
  return new Set([...agencyFiles].filter((f) => !demos.some((re) => re.test(f))));
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
/**
 * Files whose own content is agency-only, but whose import graph makes the
 * STATIC closure above call them client-reachable: a client-reachable page
 * imports them unconditionally, and only a RUNTIME `isAgency`/`isOperator`
 * branch (invisible to an import scan) keeps them from ever rendering for a
 * client. Each entry needs its own test row (ratchet.test.ts) naming the
 * gate that proves it, the same discipline `ENGLISH_ONLY_READERS` already
 * uses for its own named exceptions.
 */
export const RUNTIME_AGENCY_ONLY_FILES: readonly { file: string; reason: string }[] = [
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/checklist-row.tsx",
    reason: "imported unconditionally by the client-reachable dashboard page, but both its exports (ChecklistRow, ChecklistReviewLink) render only inside that page's own `isAgency` branch — the setup checklist is agency-only by DESIGN.md",
  },
  {
    file: "src/lib/checklist-catalogue.ts",
    reason: "its CHECKLIST_CATALOGUE titles/help are read only by the agency-only /checklist route and by checklist-row.tsx (above); the client-reachable dashboard page that also imports this module uses only mergeChecklist's numeric done/total fields, never a title or help string",
  },
  {
    file: "src/components/back-to-setup.tsx",
    reason: "renders only when a link carries `?from=setup`, which nothing but the agency-only Setup wizard ever generates — reached from client pages (Branding, Calendar) only because those are Setup's own deep-link targets for an agency operator mid-setup",
  },
  {
    file: "src/components/account-switcher.tsx",
    reason: "its one export, AccountSwitcher, is rendered only inside app-sidebar.tsx's own `isAgency` branch — switching between client accounts is an agency-only action, reached from the sidebar only because the sidebar itself is universal",
  },
];

export function agencyOnlyFiles(
  imports: ReadonlyMap<string, readonly string[]>,
  routes: readonly RegExp[] = AGENCY_ONLY_ROUTES,
  runtimeAgencyOnly: readonly { file: string }[] = RUNTIME_AGENCY_ONLY_FILES,
): Set<string> {
  const inRoute = (f: string) => routes.some((re) => re.test(f));
  const ways = [...imports.keys()].filter((f) => f.startsWith("src/app/"));
  const client = closure(imports, ways.filter((f) => !inRoute(f)));
  const agency = closure(imports, ways.filter(inRoute));
  const out = new Set([...agency].filter((f) => !client.has(f)));
  for (const { file } of runtimeAgencyOnly) out.add(file);
  return out;
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
  const englishOnly = new Set(ENGLISH_ONLY_READERS.map((r) => r.file));
  const out: Record<string, number> = {};
  for (const [file, n] of scan.directReads) if (!agencyFiles.has(file) && !englishOnly.has(file)) out[file] = n;
  return out;
}

/** G3's named exceptions (S-10 review I-1): files whose English read is the
 *  point, not a screen left untranslated. Each needs a reason and a test row
 *  (ratchet.test.ts). The styleguide is not listed: it is agency-only, and
 *  agency-only files are already outside G3. */
export const ENGLISH_ONLY_READERS: readonly { file: string; reason: string }[] = [
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/server-words.ts",
    reason: "maps a server action's ENGLISH refusal back to its key (BY_ENGLISH), so it must read the English to say it in the drawer's language",
  },
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/activity/reason-words.ts",
    reason: "maps an automation_log reason, stored as REASONS' ENGLISH sentence, back to its key (BY_ENGLISH), so it must read the English to say it in the Activity reader's language",
  },
  // S-10 T9b: a public surface with NO locale to resolve at all — the /u
  // unsubscribe token and an error boundary both carry no session, no
  // account and no Accept-Language read — shows BOTH languages stacked, on
  // purpose, each in its own `lang` attribute (DESIGN.md's bilingual
  // pattern, first built for /d and /s). Reading `m["x"]` AND `m["x.es"]`
  // directly is not "ignoring the reader's language": there is no reader
  // language to ignore, and the Spanish IS always shown, never dropped.
  {
    file: "src/lib/consent/unsubscribe-copy.ts",
    reason: "pageLines/fillBusiness build the /u page's English AND Spanish lines together — the token carries no language, so both are always shown, stacked",
  },
  {
    file: "src/app/u/[token]/page.tsx",
    reason: "the tab title and the 'Powered by BIS' footer read both unsubscribe.pageTitle/poweredBy and their .es twins, concatenated `${en} / ${es}` — no locale to resolve on this token-only page",
  },
  {
    file: "src/app/u/[token]/unsubscribe-form.tsx",
    reason: "the Stop-emails and Resubscribe buttons read both unsubscribe.button/resubscribe and their .es twins, concatenated `${en} / ${es}` — same reason as page.tsx above",
  },
  {
    file: "src/app/d/[token]/error.tsx",
    reason: "an error boundary receives no locale at all (its own doc comment); both customerDocs.error.* strings and their .es twins render stacked, each in its own lang",
  },
  {
    file: "src/app/s/[token]/error.tsx",
    reason: "the /d boundary's own twin (S-07 3b) — same no-locale reasoning, same stacked pattern",
  },
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts",
    reason: "the producer side of server-words.ts's own pattern (T11/T12 review): these booking actions deliberately answer a refusal as the catalogue's ENGLISH sentence, and the job drawer (cancel-booking.ts, job-drawer-handlers.ts) translates it back by matching the words via server-words.ts's BY_ENGLISH map, never by a locale this \"use server\" module is handed",
  },
  {
    file: "src/lib/automations/hold-or-send.ts",
    reason: "automation_log.reason is stored as these ENGLISH sentences (reason-words.ts's own doc comment names this file as the writer); reason-words.ts reads them back by matching the words, in the Activity reader's own language, never by a locale this module is handed",
  },
  {
    file: "src/lib/automations/closures.ts",
    reason: "the same automation_log.reason producer, for the closed/storm/billing-paused hold reasons — reason-words.ts's REASON_KEYS names every one of these",
  },
  {
    file: "src/lib/automations/pause-hold.ts",
    reason: "compares a stored automation_log.reason against the same English constant hold-or-send.ts writes, to detect one specific hold cause — a string match, not a display, and still the producer side of reason-words.ts's pattern",
  },
  {
    file: "src/lib/voice/call-card.ts",
    reason: "callbackTaskTitle's own doc comment: tasks.title is STORED text, rendered verbatim by every To do surface (the consent To do's precedent) — its .es twin deliberately waits for an operator locale project this lane does not open; the sibling callbackAlertLine in the same file already takes a real locale for the call-alert email",
  },
  {
    file: "src/lib/consent/replies.ts",
    reason: "the LINES table picks one of a `.en`/`.es` SUFFIX PAIR by the caller's own already-resolved language before the m[...] read — that naming (unlike t()'s bare-key/+.es) needs an explicit branch the scanner cannot tell from an English-only read",
  },
  {
    file: "src/lib/consent/email-gate.ts",
    reason: "the unsubscribe footer picks a `.en`/`.es` suffixed key by the email's own resolved language, the same `.en`/`.es` PAIR convention as replies.ts above",
  },
  {
    file: "src/lib/consent/inbound.ts",
    reason: "todo.consent.cancel.en/hold.en are STORED To-do titles (the consent To do's own precedent call-card.ts cites) — this file ALSO reads todo.sharedNumber.* through t() with a real resolved locale a few lines away; only the two stored-title reads are English on purpose",
  },
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts",
    reason: "its own doc comment: `ACTION_FAILED` and `todo.consent.decideFirst`'s English m[...] reads are a fallback for any caller that reads only `error`; the real client, work-row-actions.tsx's failureText, always prefers `errorKey` and resolves it through t() in the reader's language. closeOutBooking's BY_ENGLISH-style reverse match onto CALENDAR_CLOSE_OUT_KEYS is the same producer pattern calendar/actions.ts/server-words.ts already use — decideFromTask, the file's other action, already resolves and uses a real locale a few lines away",
  },
  {
    file: "src/lib/sms/opt-out.ts",
    reason: "withOptOut picks between the catalogue's own sms.optOut.en/sms.optOut.es — a .en/.es SUFFIX PAIR, not a bare key — by the `language` the send gate already resolved and handed it; the same convention replies.ts and email-gate.ts are exempted for",
  },
  {
    file: "src/app/b/[publicId]/move/[token]/actions.ts",
    reason: "confirmMoveAction's thread line (calendar.move.thread.subject.en/body.en) is STORED text, rendered verbatim by Conversations — the same 'waits for an operator locale project this lane does not open' precedent as lib/voice/call-card.ts; this file's own test ('the thread line's words') pins the .es twin as written out but not yet read, and the account-language describe block explicitly keeps the thread line English even when the account's language is es",
  },
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/prove-booking.ts",
    reason: "proveBooking answers its generic refusal as calendar.bookings.statusUpdateFailed's ENGLISH sentence — the exact key server-words.ts's own BY_ENGLISH map already reverse-maps back to the drawer's language; the same producer side calendar/actions.ts is already exempted for",
  },
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts",
    reason: "refuse()'s own doc comment: AddContactErrorKey's English m[errorKey] read is a fallback for a caller that reads only `error`; the real client, add-contact-dialog.tsx, always prefers `errorKey` and resolves it through t() in the reader's language — the same tasks/actions.ts ACTION_FAILED pattern",
  },
  {
    file: "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route.ts",
    reason: "exportEnded()'s 409 is reached only when agencyVisitMissing(accountId) is true, which that function's own doc comment limits to an agency_admin session with no live visit — a client Owner's export never sees it; the route's OTHER read (the downloaded filename, a few lines down) already resolves a real locale for every caller, Owner included",
  },
  {
    file: "src/lib/record/history-download.ts",
    reason: "visitEndedResponse()'s 409 is the record-history download's own exportEnded() twin, reached the same two ways as that function: agencyVisitMissing(accountId) true (its own doc comment limits that to an agency_admin session with no live visit) before a locale is even resolvable, or the caller's explicit `if (access.isAgency)` branch after noteOpenedApi refuses — a client Owner's download never sees it either way; the route's OTHER reads (readFailedResponse, tooBigResponse) already take a real resolved locale",
  },
  {
    file: "src/components/inline-field.tsx",
    reason: "normalizeRequired's English m[\"setup.rename.empty\"] is reached only through the `required` prop arm, whose only caller (its own doc comment) is setup/steps/account.tsx's account rename — an agency-only file under the settings|setup|checklist|voice|automations route regex; every other InlineField caller takes the `field`/`options`/`rule` arm instead, all already locale-aware",
  },
  {
    file: "src/lib/document-requests/customer-upload.ts",
    reason: "customerPage's not_found branch resolves no token at all, so there is no account and no language to read — the same 'nothing to resolve a reader's language from' shape /u and /d's own error boundary are exempted for; its `business` value is never read by the real page (page.tsx recomputes its own from `branding`, which is null here) — a typed placeholder, not a shown English string",
  },
  {
    file: "src/lib/email/templates/followup.ts",
    reason: "DEFAULT_FOLLOWUP_BODY is a byte-identity anchor, not only a displayed string: calendar/actions.ts's own doc comment compares a raw submission against this EXACT English text to collapse it back to an empty column, and calendar-settings.tsx imports the same constant as its textarea's placeholder so the preview can never drift from what that comparison, and bookingFollowupEmail's own fallback, actually use. Localizing the placeholder without updating the comparison in lockstep would let a Spanish-reading operator's verbatim placeholder text be stored as a REAL body instead of collapsing to empty — a cross-file behavior change outside this gate-closing task's scope, flagged for the calendar lane",
  },
  {
    file: "src/lib/record/ai-summary-prompt.ts",
    reason: "label()'s own doc comment: a stored code is handed to the MODEL as the catalogue's ENGLISH word, always, regardless of the reader's language — the rules are English and LANGUAGE_LINE asks the model for the reader's language separately; this is an AI prompt input, never UI copy a person reads",
  },
];
