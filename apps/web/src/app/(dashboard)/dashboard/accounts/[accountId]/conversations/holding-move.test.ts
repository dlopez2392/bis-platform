import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTr } from "@/lib/record/copy";
import { renderedText } from "@/lib/rendered-text";

/**
 * S-47e Task 17 design review (I-1, I-4, M-2, M-3, M-4, M-7, M-9): the holding thread's "Move to…". The search
 * results are a plain component, rendered here in both languages; what lives inside Radix's portals (closed in a
 * static render) is pinned on the source, as business-status-menu.test.ts pins its own overlays.
 */
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("./actions", () => ({ moveHoldingThreadAction: vi.fn(), undoMoveHoldingThreadAction: vi.fn() }));
vi.mock("../contacts/relationship-actions", () => ({ searchRelatableContactsAction: vi.fn() }));

const { HoldingFindResults, moveOtherKey } = await import("./holding-move");
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "holding-move.tsx"), "utf8");

type Results = Parameters<typeof HoldingFindResults>[0];
const render = (p: Partial<Results>) => renderToStaticMarkup(createElement(HoldingFindResults, {
  pending: false, failed: false, hits: null, busy: false, query: "", onPick: () => {}, tr: makeTr("en"), ...p,
}));

describe("HoldingFindResults", () => {
  it("while searching: skeleton rows shaped like the results, at the control radius (M-2; mutation: one h-8 bar -> FAILS)", () => {
    const html = render({ pending: true });
    const rows = html.match(/<div[^>]*data-slot="skeleton"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toContain("h-9");
      expect(r).toContain("rounded-[var(--radius-ctl)]");
    }
  });

  it("nobody found: says how to go on, in each language (I-4; mutation: the old dead end -> FAILS)", () => {
    expect(renderedText(render({ hits: [] })).trim()).toBe("No one found. Add them on Contacts first, then move these texts.");
    expect(renderedText(render({ hits: [], tr: makeTr("es") })).trim())
      .toBe("No se encontró a nadie. Agréguelo primero en Contactos y luego mueva estos mensajes.");
  });

  it("a hit: the name truncates, the phone sits muted beside it so two of one name differ, and no name reads in the reader's language (M-3; mutation: contactDisplayName -> \"(no name)\" in Spanish, FAILS)", () => {
    const html = render({
      tr: makeTr("es"),
      hits: [
        { id: "a1", firstName: "Ana", lastName: "Prueba", phone: "+19565550142" },
        { id: "a2", firstName: "Ana", lastName: "Prueba", phone: "+19565550199" },
        { id: "n1", firstName: null, lastName: null, phone: null },
      ],
    });
    expect(html).toContain('<span class="min-w-0 truncate">Ana Prueba</span><span class="shrink-0 tabular-nums text-muted-foreground">(956) 555-0142</span>');
    expect(html).toContain('<span class="shrink-0 tabular-nums text-muted-foreground">(956) 555-0199</span>');
    expect(html).toContain('<span class="min-w-0 truncate">(sin nombre)</span>');
    expect(html).not.toContain("(no name)");
  });

  it("a failed search says so as an alert (control)", () => {
    expect(render({ failed: true })).toMatch(/<p role="alert"[^>]*>Couldn&#x27;t search customers\. Try again\.<\/p>/);
  });

  it("the matched letters set apart, against the query these hits answered (F-092 part 1, plan Task 10; mutation: highlight against a fixed query instead of the query prop -> FAILS)", () => {
    const html = render({
      query: "garcia",
      hits: [{ id: "a1", firstName: "Ana", lastName: "García", phone: "+19565550199" }],
    });
    expect(html).toContain('<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">García</mark>');
    const none = render({ query: "zzzz", hits: [{ id: "a1", firstName: "Ana", lastName: "García", phone: "+19565550199" }] });
    expect(none).not.toContain("<mark");
  });

  it("a phone's matched digits are marked in the FORMATTED number (M-3's own display), punctuation and all", () => {
    const html = render({ query: "0199", hits: [{ id: "a1", firstName: "Ana", lastName: "Prueba", phone: "+19565550199" }] });
    expect(html).toContain('<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">0199</mark>');
  });
});

describe("moveOtherKey (M-7)", () => {
  it("\"Find a customer\" when nobody else is on the number, \"Find another customer\" when someone is (mutation: always \"another\" -> FAILS)", () => {
    expect(makeTr("en").text(moveOtherKey(0))).toBe("Find a customer");
    expect(makeTr("es").text(moveOtherKey(0))).toBe("Buscar un cliente");
    expect(makeTr("en").text(moveOtherKey(2))).toBe("Find another customer");
  });
});

describe("HoldingMove's overlays (source pins: Radix mounts none of them in a closed static render)", () => {
  it("the portaled menu carries the reader's lang, as the dialog does (I-1; mutation: drop it -> FAILS)", () => {
    expect(src).toMatch(/<DropdownMenuContent\b[^>]*\blang=\{locale\}/);
    expect(src).toMatch(/<DialogContent\b[^>]*\blang=\{locale\}/);
  });

  it("the dialog has its description, and closing it hands focus back to \"Move to…\" (M-4, M-9; mutation: drop either -> FAILS)", () => {
    expect(src).toContain('<DialogDescription>{tr.text("conversation.holding.findHint")}</DialogDescription>');
    expect(src).toMatch(/<DialogContent[^>]*onCloseAutoFocus=\{\(e\) => \{ e\.preventDefault\(\); triggerRef\.current\?\.focus\(\); \}\}/);
    expect(src).toMatch(/<Button\s+ref=\{triggerRef\}/);
  });

  it("the menu's people truncate, and the menu item and the dialog title both read moveOtherKey (M-3, M-7)", () => {
    expect(src).toContain('<span className="min-w-0 truncate">{p.name}</span>');
    expect(src.match(/tr\.text\(moveOtherKey\(people\.length\)\)/g)?.length).toBe(2);
  });
});
