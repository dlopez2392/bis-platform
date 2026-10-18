import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const { CategoryFilter, categoryCommit, ANY_CATEGORY } = await import("./category-filter");

const BASE = "/dashboard/accounts/a1/documents";
// The page's own shape: "" is Any, each href built on the server with the show kept and the cursor dropped.
const OPTIONS = [
  { value: "", label: "Any type", href: `${BASE}?show=expired` },
  { value: "permit", label: "Permit or license", href: `${BASE}?show=expired&category=permit` },
  { value: "insurance", label: "Insurance", href: `${BASE}?show=expired&category=insurance` },
];

describe("the category filter commits a choice, never a step (review I1)", () => {
  it("a chosen category pushes that category's server-built href, cursor dropped (mutation: always push Any -> FAILS)", () => {
    expect(categoryCommit(OPTIONS, "insurance")).toBe(`${BASE}?show=expired&category=insurance`);
    expect(categoryCommit(OPTIONS, "permit")).toBe(`${BASE}?show=expired&category=permit`);
    expect(categoryCommit(OPTIONS, "insurance")).not.toContain("before=");
  });
  it("Any travels as its own item value (Radix refuses an empty one) and pushes the unfiltered href; anything unknown pushes nothing", () => {
    expect(ANY_CATEGORY).not.toBe("");
    expect(categoryCommit(OPTIONS, ANY_CATEGORY)).toBe(`${BASE}?show=expired`);
    expect(categoryCommit(OPTIONS, "receipt")).toBeNull();
  });
  it("is the house Select, named by its visible label and showing the current choice", () => {
    const html = renderToStaticMarkup(createElement(CategoryFilter, { label: "Type", current: "permit", options: OPTIONS }));
    expect(html).toContain('data-slot="select-trigger"');
    const id = /<span id="([^"]+)"[^>]*>Type<\/span>/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toMatch(new RegExp(`data-slot="select-trigger"[^>]*aria-labelledby="${id}"|aria-labelledby="${id}"[^>]*data-slot="select-trigger"`));
    // The shown choice is in the trigger from the first paint (no blank box until hydration).
    expect(/data-slot="select-value"[^>]*>([^<]*)</.exec(html)?.[1]).toBe("Permit or license");
    // Radix's own form mirror is the only native select, hidden from everyone: no arrow key reaches it.
    for (const s of html.match(/<select[^>]*>/g) ?? []) expect(s).toMatch(/aria-hidden="true"[^>]*tabindex="-1"/);
  });
});
