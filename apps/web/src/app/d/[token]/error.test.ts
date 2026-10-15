import { describe, it, expect, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { renderedText } from "@/lib/rendered-text";
import DocRequestError from "./error";

const SOURCE = readFileSync(fileURLToPath(new URL("./error.tsx", import.meta.url)), "utf8");

/** Every module this file reaches: static imports, re-exports, `import()` and `require()` (read-gate.test.ts reads imports the same way, from the AST). */
function importsOf(source: string): { from: string; names: string[] }[] {
  const sf = ts.createSourceFile("error.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { from: string; names: string[] }[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      if (ts.isImportDeclaration(node) && node.importClause) {
        if (node.importClause.name) names.push(`default:${node.importClause.name.text}`);
        const nb = node.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) names.push(...nb.elements.map((e) => (e.propertyName ?? e.name).text));
        if (nb && ts.isNamespaceImport(nb)) names.push("*");
      }
      out.push({ from: node.moduleSpecifier.text, names });
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      out.push({ from: node.arguments[0].text, names: ["*"] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The tree the boundary returns, walked for its one button (the boundary uses no hooks, so it can be called directly). */
function findButton(node: ReactNode): ReactElement<{ onClick: () => void; className?: string }> | null {
  if (Array.isArray(node)) {
    for (const n of node) { const b = findButton(n); if (b) return b; }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === "button") return node as ReactElement<{ onClick: () => void; className?: string }>;
  return findButton((node.props as { children?: ReactNode }).children);
}

const html = () => renderToStaticMarkup(createElement(DocRequestError, { error: new Error("boom"), reset: () => {} }));

describe("/d/[token]/error.tsx (plan review I8): an error boundary gets no locale, so both languages stand stacked", () => {
  it("English and Spanish, each in its own lang, compared with the literal words (mutation: one language only → FAILS)", () => {
    const out = html();
    const en = /<section lang="en"[^>]*>(.*?)<\/section>/.exec(out)?.[1] ?? "";
    const es = /<section lang="es"[^>]*>(.*?)<\/section>/.exec(out)?.[1] ?? "";
    expect(renderedText(en).replace(/\s+/g, " ").trim()).toBe("Something went wrong on our side. Please try again in a moment.");
    expect(renderedText(es).replace(/\s+/g, " ").trim()).toBe("Algo salió mal de nuestro lado. Por favor intente de nuevo en un momento.");
    expect(renderedText(out)).toContain("Try again / Intentar de nuevo");
  });

  it("names nothing that broke: the error's own message never reaches the page", () => {
    expect(renderedText(html())).not.toContain("boom");
  });

  it("its one button calls reset (mutation: a button with no onClick → FAILS)", () => {
    const reset = vi.fn();
    const button = findButton(DocRequestError({ error: new Error("boom"), reset }));
    expect(button?.props.className).toBe("bis-docreq-primary");
    button?.props.onClick();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("carries the page's own stylesheet (the page's <style> never rendered when it threw)", () => {
    expect(html()).toContain(".bis-docreq-primary");
  });

  it("imports nothing from @bis/db, and from the catalogue only m (mutation: import the barrel → FAILS)", () => {
    const imports = importsOf(SOURCE);
    expect(imports.filter((i) => i.from === "@bis/db" || i.from.startsWith("@bis/db/"))).toEqual([]);
    expect(imports).toEqual([{ from: "@/lib/messages", names: ["m"] }, { from: "./docreq-css", names: ["DOCREQ_CSS"] }]);
  });

  it("the import reader itself sees a barrel import, a subpath, a dynamic import and a require (so the check above can fail)", () => {
    const seen = importsOf(`import { serviceDb } from "@bis/db"; import type { X } from "@bis/db/document-rules"; void import("a"); require("b");`).map((i) => i.from);
    expect(seen).toEqual(["@bis/db", "@bis/db/document-rules", "a", "b"]);
  });
});
