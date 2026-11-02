// S-10 T9b (owner decision Q4, 2026-10-31): every agency-only page stays
// English and carries lang="en", so a Spanish-speaking operator's Spanish
// <html lang> and shell (dashboard/layout.tsx) never mislabel it. The routes
// are the ones the catalogue gates already exempt (ratchet-scan.ts's
// AGENCY_ONLY_ROUTES), so the two cannot drift apart: a new agency-only page
// is exempt from the Spanish twins AND owes its island, from the same regex.
//
// A page is in its island when an ancestor layout.tsx inside the shell (never
// dashboard/layout.tsx itself, which is the shell) is the EnglishOnlyLayout,
// or when every JSX return of the page's own default export is rooted at
// <EnglishOnly>. A source scan, because RSC pages cannot be rendered here
// without mocking every read each one makes.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { AGENCY_ONLY_ROUTES, relativeKey } from "./ratchet-scan";

const WEB = path.resolve(__dirname, "../../..");
const SHELL_DIR = path.join(WEB, "src/app/(dashboard)/dashboard");

/** Agency-only by route, but NOT English: these render in the operator's own
 *  language throughout, so an English island would mislabel them. */
const NOT_ENGLISH: Record<string, string> = {
  // F-118 part 1: the reason-for-entry chooser reads every word through
  // makeTr(locale) and marks its own content lang={locale} (page.tsx, both
  // returns), as the owner approved for that screen.
  "src/app/(dashboard)/dashboard/enter/[accountId]/page.tsx": "every word is the operator's language, marked lang={locale}",
  // Review M-1: Sofía's knowledge snapshot reads every word through makeTr(locale) and marks its own
  // content lang={tr.locale}; under an island its <html lang> read "en" over an all-Spanish page.
  "src/app/(dashboard)/dashboard/accounts/[accountId]/voice/knowledge/[version]/page.tsx":
    "every word is the operator's language, marked lang={tr.locale}",
};

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? pages(p) : f === "page.tsx" ? [p] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** `export { EnglishOnlyLayout as default } from "@/components/english-only"`. */
export function isEnglishOnlyLayout(sf: ts.SourceFile): boolean {
  return sf.statements.some((st) =>
    ts.isExportDeclaration(st) && !!st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
    && st.moduleSpecifier.text === "@/components/english-only"
    && !!st.exportClause && ts.isNamedExports(st.exportClause)
    && st.exportClause.elements.some((e) => e.name.text === "default" && e.propertyName?.text === "EnglishOnlyLayout"));
}

/** Every `return <jsx>` directly in the default export's body is rooted at <EnglishOnly>, and there is at least one. */
export function pageRootsAtEnglishOnly(sf: ts.SourceFile): boolean {
  const fn = sf.statements.find((st): st is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(st) && !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword));
  if (!fn?.body) return false;
  const roots: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) return; // a nested function's returns are not the page's
    if (ts.isReturnStatement(n) && n.expression) {
      let e: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) roots.push(e);
    }
    ts.forEachChild(n, visit);
  };
  fn.body.statements.forEach(visit);
  return roots.length > 0 && roots.every((r) => ts.isJsxElement(r) && r.openingElement.tagName.getText(sf) === "EnglishOnly");
}

function inIsland(page: string): boolean {
  if (pageRootsAtEnglishOnly(parse(page))) return true;
  for (let dir = path.dirname(page); dir.startsWith(SHELL_DIR) && dir !== SHELL_DIR; dir = path.dirname(dir)) {
    const layout = path.join(dir, "layout.tsx");
    if (existsSync(layout) && isEnglishOnlyLayout(parse(layout))) return true;
  }
  return false;
}

const agencyPages = pages(SHELL_DIR)
  .map((p) => ({ abs: p, key: relativeKey(WEB, p) }))
  .filter(({ key }) => AGENCY_ONLY_ROUTES.some((re) => re.test(key)));

describe("every agency-only page sits in an English island (S-10 T9b, owner decision Q4)", () => {
  it("finds the agency-only pages at all (non-vacuity: the agency home, Companies, Work, Settings and Voice among them)", () => {
    const keys = agencyPages.map((p) => p.key);
    for (const k of [
      "src/app/(dashboard)/dashboard/page.tsx",
      "src/app/(dashboard)/dashboard/accounts/page.tsx",
      "src/app/(dashboard)/dashboard/work/page.tsx",
      "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx",
      "src/app/(dashboard)/dashboard/accounts/[accountId]/voice/knowledge/[version]/page.tsx",
    ]) expect(keys).toContain(k);
    expect(keys.length).toBeGreaterThanOrEqual(14);
  });

  it("each one is wrapped in EnglishOnly, by its own segment's layout or at the root of its own return (mutation: delete work/layout.tsx -> FAILS naming work/page.tsx)", () => {
    const outside = agencyPages.filter((p) => !(p.key in NOT_ENGLISH) && !inIsland(p.abs)).map((p) => p.key);
    expect(outside).toEqual([]);
  });

  it("no NOT_ENGLISH page sits in an island either, or its <html lang> would read \"en\" over its operator-language content (mutation: put voice/layout.tsx back as the EnglishOnlyLayout -> FAILS naming the knowledge page)", () => {
    expect(agencyPages.filter((p) => p.key in NOT_ENGLISH && inIsland(p.abs)).map((p) => p.key)).toEqual([]);
  });

  it("each NOT_ENGLISH entry is still an agency-only page, so the list cannot go stale", () => {
    const keys = new Set(agencyPages.map((p) => p.key));
    expect(Object.keys(NOT_ENGLISH).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("never puts the island on the shell itself, which reads the person's own language (mutation: make dashboard/layout.tsx the EnglishOnlyLayout -> FAILS)", () => {
    expect(isEnglishOnlyLayout(parse(path.join(SHELL_DIR, "layout.tsx")))).toBe(false);
    expect(readFileSync(path.join(SHELL_DIR, "layout.tsx"), "utf8")).not.toMatch(/<EnglishOnly\b/);
  });
});

describe("the island detectors can fail", () => {
  const src = (code: string) => ts.createSourceFile("x.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  it("isEnglishOnlyLayout: the re-export only, as default", () => {
    expect(isEnglishOnlyLayout(src('export { EnglishOnlyLayout as default } from "@/components/english-only";'))).toBe(true);
    expect(isEnglishOnlyLayout(src('export { EnglishOnlyLayout } from "@/components/english-only";'))).toBe(false);
    expect(isEnglishOnlyLayout(src('export default function L({ children }) { return children; }'))).toBe(false);
  });
  it("pageRootsAtEnglishOnly: every JSX return, not just one, and not a nested function's", () => {
    expect(pageRootsAtEnglishOnly(src("export default async function P() { return (<EnglishOnly><h1/></EnglishOnly>); }"))).toBe(true);
    expect(pageRootsAtEnglishOnly(src("export default async function P() { if (x) return <p/>; return <EnglishOnly><h1/></EnglishOnly>; }"))).toBe(false);
    expect(pageRootsAtEnglishOnly(src("export default async function P() { return <div><EnglishOnly/></div>; }"))).toBe(false);
    expect(pageRootsAtEnglishOnly(src("export default async function P() { const f = () => <p/>; return <EnglishOnly>{f()}</EnglishOnly>; }"))).toBe(true);
    expect(pageRootsAtEnglishOnly(src("export default async function P() { return null; }"))).toBe(false);
  });
});
