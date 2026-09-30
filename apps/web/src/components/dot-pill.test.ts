import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DotPill } from "./dot-pill";

/**
 * Dot + word (DESIGN.md rule 3), the one pill the automation history and the
 * calendar's confirmation answer share. It was two hand-built copies of the
 * same `Badge variant="chip"` + 7px dot; `LogStatusPill` is now a thin
 * wrapper over this, and the calendar renders it `dense`.
 */
const WARN = { chip: "border-transparent bg-[var(--warn-bg)] text-foreground", dot: "bg-[var(--warn)]" };

/** The pill's opening tag and its FIRST child, or a throw. */
function parts(html: string): { tag: string; dot: string; rest: string } {
  const match = html.match(/^(<span[^>]*data-slot="badge"[^>]*>)(<span[^>]*aria-hidden="true"[^>]*><\/span>)(.*)<\/span>$/);
  if (!match) throw new Error(`not a badge whose FIRST child is the aria-hidden dot: ${html}`);
  return { tag: match[1]!, dot: match[2]!, rest: match[3]! };
}

describe("DotPill", () => {
  it("renders the dot FIRST, aria-hidden, then the word", () => {
    // Mutation: render the label before the dot → `parts()` throws, reds BY NAME.
    const p = parts(renderToStaticMarkup(createElement(DotPill, { label: "Asked for a different time", ...WARN })));
    expect(p.dot).toContain("size-[7px] rounded-full");
    expect(p.dot).toContain(WARN.dot);
    expect(p.rest).toBe("Asked for a different time");
  });

  it("is the chip Badge wearing the caller's treatment: the treatment's ground and ink win the merge", () => {
    // tailwind-merge drops the chip variant's own --chip-bg / --chip-text /
    // --chip-line; a pill that kept them would read as neutral whatever the
    // treatment said. Mutation: drop `chip` from the className → reds BY NAME.
    const { tag } = parts(renderToStaticMarkup(createElement(DotPill, { label: "x", ...WARN })));
    expect(tag).toContain('data-variant="chip"');
    for (const cls of WARN.chip.split(" ")) expect(tag).toContain(cls);
    expect(tag).not.toContain("bg-[var(--chip-bg)]");
    expect(tag).not.toContain("text-[var(--chip-text)]");
  });

  it("carries LogStatusPill's padding by default; `dense` keeps the badge's own px-2 py-0.5", () => {
    // Mutation: ignore `dense` (always pad, or never) → reds BY NAME.
    const roomy = parts(renderToStaticMarkup(createElement(DotPill, { label: "x", ...WARN }))).tag;
    for (const cls of ["gap-1.5", "py-1", "pr-2.5", "pl-2"]) expect(roomy).toContain(cls);
    // tailwind-merge drops the badge's `py-0.5` for `py-1`; its `px-2` stays
    // in the string (a later `pr-`/`pl-` does not remove an earlier `px-`)
    // and loses in the cascade instead, so only the `py` is asserted gone.
    expect(roomy).not.toMatch(/\bpy-0\.5\b/);
    const dense = parts(renderToStaticMarkup(createElement(DotPill, { label: "x", ...WARN, dense: true }))).tag;
    expect(dense).toContain("gap-1.5");
    expect(dense).toMatch(/\bpx-2\b/);
    expect(dense).toMatch(/\bpy-0\.5\b/);
    expect(dense).not.toMatch(/\bpy-1\b|\bpr-2\.5\b|\bpl-2\b/);
  });

  it("puts `testId` on the pill as data-testid and passes other attributes through", () => {
    // Mutation: drop the testId → reds BY NAME. `data-status` is how
    // LogStatusPill's rows are addressed (activity-table.test.ts).
    const { tag } = parts(renderToStaticMarkup(createElement(DotPill, {
      label: "x", ...WARN, testId: "booking-confirm-reply", "data-status": "sent",
    } as Parameters<typeof DotPill>[0])));
    expect(tag).toContain('data-testid="booking-confirm-reply"');
    expect(tag).toContain('data-status="sent"');
  });
});
