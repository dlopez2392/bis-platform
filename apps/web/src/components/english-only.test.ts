// S-10 T9b: the English island an agency-only page sits in (owner decision Q4,
// 2026-10-31). Server-rendered lang="en" on the island's own wrapper, so the
// HTML is right before any script runs, plus an island claim on the document
// (document-lang.ts) for what the page portals into <body>.
import { describe, it, expect } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnglishOnly, EnglishOnlyLayout } from "./english-only";
import { DocumentLang } from "./document-lang";

function find(node: unknown, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => find(n, type));
  if (!("type" in node)) return [];
  const el = node as ReactElement<{ children?: unknown }>;
  return [...(el.type === type ? [el as ReactElement<Record<string, unknown>>] : []), ...find(el.props?.children, type)];
}

describe("EnglishOnly", () => {
  it("server-renders its children inside lang=\"en\" (mutation: drop lang from the wrapper -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(EnglishOnly, null, createElement("h1", null, "Work")));
    expect(html).toMatch(/^<div lang="en"[^>]*><h1>Work<\/h1><\/div>$/);
  });

  it("claims the document as an ISLAND, in English (mutation: island={false}, or lang=\"es\" -> FAILS)", () => {
    const tree = EnglishOnly({ children: "x" });
    expect(find(tree, DocumentLang).map((d) => d.props)).toEqual([{ lang: "en", island: true }]);
  });

  it("is also a segment layout, so an agency-only route's loading and error UI sit inside the island too", () => {
    const tree = EnglishOnlyLayout({ children: "x" });
    expect(find(tree, EnglishOnly)).toHaveLength(1);
  });
});
