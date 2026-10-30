import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

// F-006 part 1 (plan Task 11, spec §6.1, §6.4; fix round, design I1): the record header's duplicate
// line, the timeline's merge/mergeUndone row with its own "Undo merge", the Possible-duplicates
// view's own row (DuplicatesList) and the compare screen's conflict layout (MergeScreen), on the
// styleguide (DESIGN.md's DoD: a new component is on the styleguide). The timeline row's button here
// is plain markup (design M-9's own rule); DuplicatesList and MergeScreen are the REAL components,
// with no-op actions, so both need next/navigation's useRouter (archive-demo.test.ts's own pattern).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const { MergeDemo } = await import("./merge-demo");

describe("styleguide: possible duplicates and merge (F-006 part 1, plan Task 11)", () => {
  const html = renderToStaticMarkup(createElement(MergeDemo));
  const text = renderedText(html);

  it("the duplicate line, in English and Spanish (mutation: render only one locale -> FAILS)", () => {
    expect(html.match(/data-duplicate-line/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("May be the same person as");
    expect(text).toContain("Puede ser la misma persona que");
    expect(text).toContain("Compare");
    expect(text).toContain("Comparar");
  });

  it("a merge row and a mergeUndone row, each with its own icon, in both languages (mutation: drop a kind or a locale -> FAILS)", () => {
    expect(html.match(/lucide-merge\b/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/lucide-undo-2\b/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the merge row's own 'Undo merge' control shows, inert, in both languages (mutation: drop it -> FAILS)", () => {
    expect(html.match(/Undo merge/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/Deshacer unión/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("nothing in it is fixed-width (never w-[Npx], max-w-[...] still shrinks), so /styleguide never scrolls sideways at 375px (e2e/phone-width.spec.ts)", () => {
    expect(html).toMatch(/^<div class="[^"]*\bmin-w-0\b/);
    expect(html).not.toMatch(/(?<!max-)\bw-\[\d+px\]/);
    expect(html).not.toMatch(/\bmin-w-\[\d+px\]/);
  });

  it("the Possible-duplicates row (DuplicatesList), with its own dismiss control, in both languages (fix round, design I1; mutation: drop a locale -> FAILS)", () => {
    expect(html.match(/data-duplicates-list/g)?.length).toBe(2);
    expect(html.match(/data-duplicate-row="flag-1"/g)?.length).toBe(2);
    expect(text).toContain("Not the same person");
    expect(text).toContain("No es la misma persona");
  });

  it("the compare screen's conflict layout (MergeScreen), with a conflict, an Also-keeps line and a Moves line, in both languages (fix round, design I1; mutation: drop a locale or the conflicts -> FAILS)", () => {
    expect(html.match(/data-sg-merge-compare/g)?.length).toBe(2);
    expect(text).toContain("Merge");
    expect(text).toContain("Unir");
    expect(text).toContain("Also keeps:");
    expect(text).toContain("También conserva:");
  });

  it("the compare screen demo is INERT — no-op handlers only, nothing reaching merge-actions.ts (design M-9; mutation: wire mergeContactsAction -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./merge-demo.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/merge-actions/);
  });
});
