import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("../accounts/[accountId]/conversations/inbound-actions", () => ({
  fileHeldEmailAction: vi.fn(),
  dismissHeldEmailAction: vi.fn(),
  undoHeldEmailAction: vi.fn(),
}));

const { HeldEmailsDemo } = await import("./held-emails-demo");

describe("styleguide: the 'Needs a look' held-email list (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(HeldEmailsDemo));

  it("two held items, loaded, empty and the skeleton (mutation: drop a state -> FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-held-emails"');
    expect(html.match(/data-held-item=/g)).toHaveLength(4); // the same two items in English and Spanish
    expect(html).toContain("data-held-skeleton");
    expect(renderedText(html)).toContain("Emails we couldn't match to a customer wait here for you to file.");
  });

  it("the Spanish copy is the Spanish catalogue's, under lang=es (mutation: render the Spanish box in English -> FAILS)", () => {
    expect(html).toMatch(/lang="es"/);
    const es = html.slice(html.indexOf('lang="es"'));
    expect(renderedText(es.slice(0, es.indexOf("</div>", es.lastIndexOf("data-held-item"))))).toContain("Archivar con Ana Ruiz");
  });

  it("each item has exactly one primary (rule 8; mutation: Not a customer as default -> FAILS)", () => {
    // Four rendered items total (the two fixtures, shown once in English and once in Spanish).
    expect(html.match(/data-variant="default"/g)).toHaveLength(4);
  });
});
