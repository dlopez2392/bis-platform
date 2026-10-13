import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";

const { DetailsCardView } = await import("./details-card");
const { renderedText } = await import("@/lib/rendered-text");

type ViewProps = Parameters<typeof DetailsCardView>[0];
const render = (locale: "en" | "es", over: Partial<ViewProps> = {}) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>,
    createElement(DetailsCardView, {
      accountId: "a1", groupId: "g1", name: "García", kind: "household", billingAddress: null,
      manager: true, onChanged: () => {}, ...over,
    })));

describe("DetailsCardView", () => {
  it("a manager gets two editable fields — name and billing address — and the type as plain, never editable, text (mutation: give the type an InlineField too -> FAILS)", () => {
    const html = render("en", { name: "García", billingAddress: "1 Main St" });
    // The two editable fields render as buttons (InlineField's at-rest state); the kind word never does.
    expect(html).toMatch(/<button type="button"[^>]*>García<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>1 Main St<\/button>/);
    expect(renderedText(html)).toContain("Household");
    expect(html).not.toMatch(/<button[^>]*>Household<\/button>/);
  });

  it("a narrow reader sees all three as plain text, none of them a button (mutation: render the editors regardless of manager -> FAILS)", () => {
    const html = render("en", { manager: false, name: "García", billingAddress: "1 Main St" });
    expect(html).not.toContain("<button");
    const text = renderedText(html);
    expect(text).toContain("García");
    expect(text).toContain("1 Main St");
    expect(text).toContain("Household");
  });

  it("a business shows the business word, in both roles (mutation: always say Household -> FAILS)", () => {
    expect(renderedText(render("en", { kind: "business" }))).toContain("Business customer");
    expect(renderedText(render("en", { kind: "business", manager: false }))).toContain("Business customer");
  });

  it("a null billing address shows the empty placeholder for a manager, and nothing (not the word 'null') for a narrow reader (mutation: print String(billingAddress) -> FAILS)", () => {
    const managerHtml = render("en", { billingAddress: null, manager: true });
    expect(managerHtml).not.toContain(">null<");
    const narrowHtml = render("en", { billingAddress: null, manager: false });
    expect(renderedText(narrowHtml)).not.toContain("null");
  });

  it("Spanish labels and the root lang (mutation: hard-code the English labels -> FAILS)", () => {
    const html = render("es", { name: "García", kind: "household", billingAddress: "Calle 1" });
    const text = renderedText(html);
    expect(text).toContain("Nombre del grupo");
    expect(text).toContain("Tipo");
    expect(text).toContain("Dirección de cobro");
    expect(text).toContain("Familia");
    expect(html).toMatch(/^<dl[^>]*lang="es"/);
  });
});
