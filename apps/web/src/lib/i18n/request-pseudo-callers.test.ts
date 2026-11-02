// S-10 T9b gate (the S-10 review's idea): every server component that
// resolves its locale with requestLocale also honours `?locale=pseudo`. G9
// (spec §5.2) measures overflow at +35% length through that override, and a
// screen that resolves `?locale=es` but drops `?locale=pseudo` is silently
// measured in plain Spanish, so its overflow proof proves nothing. Three
// rules per file:
//   1. each requestLocale call passes the page's query as its second argument;
//   2. requestPseudoMode is called with that SAME argument;
//   3. its answer is used (passed on, or kept in a name the file reads again),
//      never discarded.
// request-locale-callers.test.ts pins the other half (userLanguage).
// Runs in `pnpm check` (CI's verify job): vitest.config.ts includes
// src/**/*.test.ts, and this file is not under ci/**.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const WEB = path.resolve(__dirname, "../../..");
const ROOTS = ["src/app", "src/components"];

/** Files that resolve a locale but legitimately receive no query to read. */
const CANNOT: Record<string, string> = {
  "src/app/(dashboard)/dashboard/layout.tsx":
    "a layout: Next gives searchParams to pages only (its own S-10 T9a comment); the shell's locale comes from users.language",
  "src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx":
    "a layout: no searchParams; its banners take the locale it resolves, the page below resolves its own",
};

/** Real gaps, frozen so they cannot grow and must be removed once fixed. */
const KNOWN_GAPS: Record<string, string> = {
  // Settings mounts it as `<AiSection accountId={accountId} />` with no query, and AiCard takes no
  // `pseudo`; agency-only (English per Q4), so no Spanish G9 proof depends on it today. Fixing it
  // threads `localeParam` from settings/page.tsx and `pseudo` through ai-card.tsx/settings-view.ts.
  "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.tsx":
    "AiSection resolves the operator's locale with no query; AiCard has no pseudo prop",
};

const norm = (n: ts.Node, sf: ts.SourceFile) => n.getText(sf).replace(/\s+/g, "");

function calls(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function isUsed(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  let p: ts.Node = call.parent;
  while (ts.isParenthesizedExpression(p)) p = p.parent;
  if (ts.isExpressionStatement(p)) return false;
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
    const name = p.name.text;
    let reads = 0;
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === name && n !== p.name) reads += 1;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return reads > 0;
  }
  return true; // an argument, a JSX attribute, a property, a return value: passed on
}

/** What a file does wrong, or [] when it calls requestLocale correctly (or not at all). */
export function pseudoViolations(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const locales = calls(sf, "requestLocale");
  if (locales.length === 0) return [];
  const pseudos = calls(sf, "requestPseudoMode");
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: string[] = [];
  for (const call of locales) {
    const query = call.arguments[1];
    if (!query) {
      out.push(`${line(call)}: requestLocale is given no query (second argument)`);
      continue;
    }
    const twin = pseudos.filter((p) => p.arguments[0] && norm(p.arguments[0], sf) === norm(query, sf));
    if (twin.length === 0) out.push(`${line(call)}: no requestPseudoMode(${query.getText(sf)}) beside it`);
    else if (!twin.some((p) => isUsed(p, sf))) out.push(`${line(twin[0]!)}: requestPseudoMode's answer is never used`);
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

const scanned = ROOTS.flatMap((r) => tsxFiles(path.join(WEB, r))).map((abs) => {
  const key = path.relative(WEB, abs).replace(/\\/g, "/");
  const src = readFileSync(abs, "utf8");
  return { key, callsLocale: /\brequestLocale\(/.test(src), violations: pseudoViolations(key, src) };
});

describe("every requestLocale caller also honours ?locale=pseudo (S-10 T9b gate)", () => {
  it("scans the callers at all (non-vacuity: at least 25 files, Contacts and Calendar among them)", () => {
    const callers = scanned.filter((s) => s.callsLocale).map((s) => s.key);
    expect(callers).toContain("src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx");
    expect(callers).toContain("src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/page.tsx");
    expect(callers.length).toBeGreaterThanOrEqual(25);
  });

  it("finds no violation outside the two lists (mutation: drop requestPseudoMode from a page, or stop passing `pseudo` on -> FAILS naming it)", () => {
    const bad = scanned
      .filter((s) => s.violations.length > 0 && !(s.key in CANNOT) && !(s.key in KNOWN_GAPS))
      .map((s) => `${s.key} ${s.violations.join("; ")}`);
    expect(bad).toEqual([]);
  });

  it("every entry on either list still violates, so a fixed or deleted file must leave its list", () => {
    const byKey = new Map(scanned.map((s) => [s.key, s]));
    const stale = [...Object.keys(CANNOT), ...Object.keys(KNOWN_GAPS)]
      .filter((k) => (byKey.get(k)?.violations.length ?? 0) === 0);
    expect(stale).toEqual([]);
  });

  it("CANNOT holds layouts only: a page always receives its query", () => {
    expect(Object.keys(CANNOT).filter((k) => !k.endsWith("/layout.tsx"))).toEqual([]);
  });
});

describe("the detector itself (each case can fail)", () => {
  const page = (body: string) =>
    `export default async function P({ searchParams }) {\n  const { locale: localeParam } = await searchParams;\n${body}\n}\n`;
  const LOCALE = "  const locale = requestLocale({ account, isOperator, userLanguage }, { locale: localeParam });";

  it("passes the two shapes the app uses: a named `pseudo` read again, and an inline call passed on", () => {
    expect(pseudoViolations("p.tsx", page(`${LOCALE}\n  const pseudo = requestPseudoMode({ locale: localeParam });\n  return <X locale={locale} pseudo={pseudo} />;`))).toEqual([]);
    expect(pseudoViolations("p.tsx", page(`${LOCALE}\n  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));\n  return <X tr={tr} />;`))).toEqual([]);
  });

  it("flags a page that drops pseudo entirely (the seeded page)", () => {
    expect(pseudoViolations("p.tsx", page(`${LOCALE}\n  return <X locale={locale} />;`)))
      .toEqual(["3: no requestPseudoMode({ locale: localeParam }) beside it"]);
  });

  it("flags requestLocale with no query, a pseudo read of a DIFFERENT query, and an answer never used", () => {
    expect(pseudoViolations("p.tsx", page("  const locale = requestLocale({ account, isOperator, userLanguage });\n  return <X />;")))
      .toEqual(["3: requestLocale is given no query (second argument)"]);
    expect(pseudoViolations("p.tsx", page(`${LOCALE}\n  const pseudo = requestPseudoMode({ locale: undefined });\n  return <X pseudo={pseudo} />;`)))
      .toEqual(["3: no requestPseudoMode({ locale: localeParam }) beside it"]);
    expect(pseudoViolations("p.tsx", page(`${LOCALE}\n  const pseudo = requestPseudoMode({ locale: localeParam });\n  return <X locale={locale} />;`)))
      .toEqual(["4: requestPseudoMode's answer is never used"]);
    expect(pseudoViolations("p.tsx", page(`${LOCALE}\n  requestPseudoMode({ locale: localeParam });\n  return <X locale={locale} />;`)))
      .toEqual(["4: requestPseudoMode's answer is never used"]);
  });

  it("ignores a file that never calls requestLocale", () => {
    expect(pseudoViolations("p.tsx", page("  return <X />;"))).toEqual([]);
  });
});
