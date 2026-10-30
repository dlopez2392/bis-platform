import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * T11/T12 review: the Cancel dialog opened from a Spanish job drawer spoke English. Its words follow the
 * DRAWER's language (`locale`); the notice's own language (`defaultLocale`, the customer's) stays a separate
 * choice. Radix's dialog and select draw into portals, which a server render never reaches, so both are
 * flattened to plain markup here: this file reads the words, not the overlay.
 */
const pass = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
vi.mock("@/components/ui/dialog", () => ({
  Dialog: pass, DialogClose: pass, DialogContent: pass, DialogDescription: pass, DialogFooter: pass, DialogHeader: pass, DialogTitle: pass,
}));
vi.mock("@/components/ui/select", () => ({ Select: pass, SelectContent: pass, SelectItem: pass, SelectTrigger: pass, SelectValue: pass }));

const { CancelDialog } = await import("./cancel-dialog");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

const render = (locale: "en" | "es") => renderedText(renderToStaticMarkup(createElement(CancelDialog, {
  contactName: "Ana", when: "mar, 3 nov, 10:00 a.m.", defaultLocale: "en", locale, onOpenChange: () => {}, onConfirm: () => {},
})));

describe("CancelDialog speaks the drawer's language", () => {
  it("in Spanish every one of its own words is the Spanish twin (mutation: m[...] -> FAILS)", () => {
    const text = render("es");
    for (const k of ["calendar.cancelDialog.language", "calendar.cancelDialog.languageEnglish", "calendar.cancelDialog.languageSpanish",
      "calendar.cancelDialog.message", "calendar.cancelDialog.messageHint", "calendar.cancelDialog.confirm", "calendar.cancelDialog.keep"] as const) {
      expect(text, k).toContain(m[`${k}.es`]);
    }
    expect(text).toContain(m["calendar.cancelDialog.title.es"].replace("{name}", "Ana"));
    expect(text).toContain(m["calendar.cancelDialog.notify.es"].replace("{name}", "Ana"));
    expect(text).not.toContain(m["calendar.cancelDialog.keep"]);
  });

  it("in English, the English words", () => {
    const text = render("en");
    expect(text).toContain(m["calendar.cancelDialog.confirm"]);
    expect(text).toContain(m["calendar.cancelDialog.title"].replace("{name}", "Ana"));
  });
});
