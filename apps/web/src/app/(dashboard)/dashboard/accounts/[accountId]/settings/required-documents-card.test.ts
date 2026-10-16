import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { RequiredDocumentsCard, requiredFormEntries } = await import("./required-documents-card");

const action = vi.fn(async () => ({ ok: true as const, list: [] as string[] }));

const render = (required: readonly string[] = []) =>
  renderToStaticMarkup(createElement(RequiredDocumentsCard, { required: required as never, action }));

describe("RequiredDocumentsCard", () => {
  it(
    "renders the card's id and title, the sentence, EIGHT categories in the vault's order with no Other, and " +
      "Insurance checked only when required (D8; mutation: map DOCUMENT_CATEGORIES -> FAILS)",
    () => {
      const html = render(["insurance"]);
      expect(html).toContain('id="required-documents"');
      const text = renderedText(html);
      expect(text).toContain(m["settings.requiredDocuments.title"]);
      expect(text).toContain(m["settings.requiredDocuments.body"]);

      const order = ["ID", "Contract", "Estimate or quote", "Invoice or receipt", "Photo", "Permit or license", "Insurance", "Warranty"];
      let cursor = -1;
      for (const word of order) {
        const idx = text.indexOf(word, cursor + 1);
        expect(idx, `expected "${word}" after position ${cursor}`).toBeGreaterThan(cursor);
        cursor = idx;
      }
      expect(text).not.toContain("Other");

      // Insurance's checkbox is checked; the others are not.
      const insuranceRow = html.slice(html.indexOf("Insurance") - 900, html.indexOf("Insurance"));
      expect(insuranceRow).toContain('data-state="checked"');
      const idRow = html.slice(html.indexOf(">ID<") - 900, html.indexOf(">ID<"));
      expect(idRow).not.toContain('data-state="checked"');
    },
  );

  it("draws exactly ONE data-variant=\"default\" button, Save (rule 8; mutation: a second primary -> FAILS)", () => {
    const html = render(["id"]);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`data-variant="default"[^>]*>${m["common.save"]}<`));
  });

  it("draws settings.requiredDocuments.off only when the list is empty (mutation: always draw it -> FAILS)", () => {
    expect(renderedText(render([]))).toContain(m["settings.requiredDocuments.off"]);
    expect(renderedText(render(["id"]))).not.toContain(m["settings.requiredDocuments.off"]);
  });
});

describe("requiredFormEntries", () => {
  it("writes the hidden inputs in the vault's order (mutation: insertion order -> FAILS)", () => {
    expect(requiredFormEntries(new Set(["warranty", "id"] as never))).toEqual([
      ["category", "id"],
      ["category", "warranty"],
    ]);
  });
});
