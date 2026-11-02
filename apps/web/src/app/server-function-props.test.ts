// S-10 T9b gate: no SERVER component passes a function literal as a JSX prop.
//
// A function cannot cross the React Server Components boundary: handed to a
// client component it fails the render ("Functions cannot be passed directly
// to Client Components…"), and that has 500'd whole pages here before (the
// setup page in P5, topbar.tsx's own note on `palette`; the branding page's
// JSX_FUNCTION_PROP guard, branding/page.test.ts, which this generalises
// from one page to every server file). The fix is always the same: bind a
// server action (`action.bind(null, id)`), or mark an inline one "use server".
// Both are allowed here; everything else fails, naming file, line and prop.
//
// Scope: every .tsx under src/app and src/components that does NOT open with
// "use client" (a client file may pass handlers freely). The rule is stricter
// than React's on purpose: a render prop handed to another SERVER component is
// legal, but nothing on main does it, and a server-to-server render prop is
// one refactor away from crossing into a client component unnoticed.
// Runs in `pnpm check` (CI's verify job): vitest.config.ts includes
// src/**/*.test.ts, and this file lives under src/app, not ci/**.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const WEB = path.resolve(__dirname, "../..");
const ROOTS = ["src/app", "src/components"];

function hasDirective(statements: readonly ts.Statement[], directive: string): boolean {
  for (const st of statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) return false;
    if (st.expression.text === directive) return true;
  }
  return false;
}

/** The function literals a prop's value passes on: the value itself, either
 *  branch of a ternary or a logical expression, and the members of an object
 *  or array literal. Never a call's arguments (`rows.map((r) => …)` runs on
 *  the server) and never a nested JSX element (its own props are visited). */
function functionLiterals(e: ts.Expression): ts.Node[] {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return [e];
  if (ts.isConditionalExpression(e)) return [...functionLiterals(e.whenTrue), ...functionLiterals(e.whenFalse)];
  if (ts.isBinaryExpression(e)) return [...functionLiterals(e.left), ...functionLiterals(e.right)];
  if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((x) => (ts.isSpreadElement(x) ? [] : functionLiterals(x)));
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.flatMap((p) => {
      if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) return [p];
      if (ts.isPropertyAssignment(p)) return functionLiterals(p.initializer);
      return [];
    });
  }
  return [];
}

function isInlineServerAction(fn: ts.Node): boolean {
  const body = (fn as ts.FunctionLikeDeclarationBase).body;
  return !!body && ts.isBlock(body) && hasDirective(body.statements, "use server");
}

/** "line: <Tag prop=>" for each offending prop, [] for a client file. */
export function functionLiteralProps(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (hasDirective(sf.statements, "use client")) return [];
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
      for (const fn of functionLiterals(n.initializer.expression)) {
        if (isInlineServerAction(fn)) continue;
        const tag = (n.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf);
        out.push(`${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: <${tag} ${n.name.getText(sf)}=`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

// Parsed once, at collection, not inside a test: a whole-tree parse beside the
// full suite ran past vitest's 5s test timeout (measured: 8-10s under load),
// the same reason request-pseudo-callers.test.ts scans at module scope.
const scanned = ROOTS.flatMap((r) => tsxFiles(path.join(WEB, r))).map((abs) => {
  const source = readFileSync(abs, "utf8");
  const statements = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX).statements;
  return {
    key: path.relative(WEB, abs).replace(/\\/g, "/"),
    server: !hasDirective(statements, "use client"),
    found: functionLiteralProps(abs, source),
  };
});

describe("no server component passes a function literal as a JSX prop (S-10 T9b gate)", () => {
  it("scans the server files at all (non-vacuity: the branding and settings pages, and the topbar, are among them)", () => {
    const server = scanned.filter((s) => s.server).map((s) => s.key);
    expect(server).toContain("src/app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx");
    expect(server).toContain("src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx");
    expect(server).toContain("src/components/topbar.tsx");
    expect(server.length).toBeGreaterThan(150);
  });

  it("finds none in src/app or src/components (mutation: seed `onClick={() => null}` into a server page -> FAILS naming it)", () => {
    expect(scanned.flatMap((s) => s.found.map((v) => `${s.key}:${v}`))).toEqual([]);
  });
});

describe("the detector itself (each case can fail)", () => {
  const server = (jsx: string) => `import { X } from "./x";\nexport default function P() {\n  return ${jsx};\n}\n`;

  it("catches a parenthesised arrow, a bracketless arrow, an async arrow and a function expression", () => {
    expect(functionLiteralProps("p.tsx", server("<X onPick={(id) => go(id)} />"))).toEqual(["3: <X onPick="]);
    expect(functionLiteralProps("p.tsx", server("<X remove={id => removeNeverLogAction(accountId, id)} />"))).toEqual(["3: <X remove="]);
    expect(functionLiteralProps("p.tsx", server("<X run={async () => { await go(); }} />"))).toEqual(["3: <X run="]);
    expect(functionLiteralProps("p.tsx", server("<X run={function (id) { return go(id); }} />"))).toEqual(["3: <X run="]);
  });

  it("catches one hidden in a ternary, a logical expression, an object or an array literal", () => {
    expect(functionLiteralProps("p.tsx", server("<X onPick={ok ? () => go() : undefined} />"))).toEqual(["3: <X onPick="]);
    expect(functionLiteralProps("p.tsx", server("<X onPick={ok && (() => go())} />"))).toEqual(["3: <X onPick="]);
    expect(functionLiteralProps("p.tsx", server("<X cols={[{ cell: (r) => r.name }]} />"))).toEqual(["3: <X cols="]);
    expect(functionLiteralProps("p.tsx", server("<X handlers={{ onPick() { go(); } }} />"))).toEqual(["3: <X handlers="]);
  });

  it("allows .bind(...), an inline \"use server\" function, a value computed by a call, and a plain value", () => {
    expect(functionLiteralProps("p.tsx", server("<X action={setBrandingAction.bind(null, accountId, locale)} />"))).toEqual([]);
    expect(functionLiteralProps("p.tsx", server('<X action={async (fd) => { "use server"; await save(fd); }} />'))).toEqual([]);
    expect(functionLiteralProps("p.tsx", server('<X action={async function (fd) { "use server"; await save(fd); }} />'))).toEqual([]);
    expect(functionLiteralProps("p.tsx", server("<X rows={rows.map((r) => r.id)} />"))).toEqual([]);
    expect(functionLiteralProps("p.tsx", server("<X locale={locale} palette={<Y />} />"))).toEqual([]);
  });

  it("does not let a \"use server\" string LATER in the body pass (only a directive counts)", () => {
    expect(functionLiteralProps("p.tsx", server('<X action={async () => { await go(); "use server"; }} />'))).toEqual(["3: <X action="]);
  });

  it("skips a \"use client\" file, and only one that OPENS with the directive", () => {
    expect(functionLiteralProps("p.tsx", `"use client";\n${server("<X onPick={() => go()} />")}`)).toEqual([]);
    expect(functionLiteralProps("p.tsx", `${server("<X onPick={() => go()} />")}\nconst s = "use client";\n`)).toEqual(["3: <X onPick="]);
  });
});
