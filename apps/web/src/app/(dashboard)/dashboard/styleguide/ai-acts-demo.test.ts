import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// The demo must never reach a server action (design M-9): if anything it renders called one, this throws.
vi.mock("@/lib/ai-acts/actions", () => ({
  undoAiActAction: () => { throw new Error("the styleguide reached undoAiActAction"); },
  redoAiFieldFillAction: () => { throw new Error("the styleguide reached redoAiFieldFillAction"); },
}));

const { AiActsDemo, INERT } = await import("./ai-acts-demo");

/** One column of the demo, by its key. */
const column = (h: string, key: string) => h.split('data-sg-ai-acts="').find((part) => part.startsWith(`${key}"`)) ?? "";

describe("styleguide: Sofía's actions and their Undo (item 8c, Task 9 design I-8, M-9)", () => {
  const h = renderToStaticMarkup(createElement(AiActsDemo));

  it("each of en, es and pseudo draws the seven row states, the two popover bodies and the two dialog bodies", () => {
    for (const key of ["en", "es", "pseudo"]) {
      const col = column(h, key);
      expect([...col.matchAll(/data-ai-act-state="([a-z]+)"/g)].map((x) => x[1]))
        .toEqual(["available", "available", "available", "available", "blocked", "undone", "unknown"]);
      expect([...col.matchAll(/data-sg-ai-act-form="([a-z-]+)"/g)].map((x) => x[1]))
        .toEqual(["booking-ticked", "booking-no-email", "contact-empty", "contact-matched"]);
    }
  });

  it("the contact body is disabled empty and enabled matched", () => {
    const col = column(h, "en");
    const remove = (form: string) => /<button[^>]*data-variant="destructive"[^>]*>/.exec(col.split(`data-sg-ai-act-form="${form}"`)[1]!)![0];
    expect(remove("contact-empty")).toContain('disabled=""');
    expect(remove("contact-matched")).not.toContain('disabled=""');
  });

  it("no English mark or time typed into the Spanish and pseudo specimens (design M-9; mutation: a literal 'Sofía · AI' -> FAILS)", () => {
    expect(column(h, "es")).toContain("Sofía · IA");
    expect(column(h, "es")).not.toContain("Sofía · AI");
    expect(column(h, "pseudo")).toMatch(/\[Sófíá · ÁÍ/);
    expect(column(h, "en")).toContain("9:42 AM");
    expect(column(h, "es")).not.toContain("9:42 AM");
  });

  it("every row is on the timeline's row rule, and each column's act ids are its own (one sentence id per row)", () => {
    expect((h.match(/data-sg-ai-act="[a-z-]+" class="border-t border-\[var\(--row-line\)\] first:border-t-0"/g) ?? []).length).toBe(21);
    const ids = [...h.matchAll(/<p id="(ai-act-[^"]+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is inert: every row hands its controls INERT, and INERT answers without a server (mutation: drop run={INERT} -> FAILS)", async () => {
    const src = readFileSync(join(__dirname, "ai-acts-demo.tsx"), "utf8");
    expect(src).toMatch(/<ActRow[^>]*run=\{INERT\}/);
    expect(src).not.toMatch(/from "@\/lib\/ai-acts\/actions"/);
    await expect(INERT.undo("x")).resolves.toEqual({ ok: false, reason: "notAvailable" });
    await expect(INERT.redo("x")).resolves.toEqual({ ok: false, reason: "notAvailable" });
  });
});
