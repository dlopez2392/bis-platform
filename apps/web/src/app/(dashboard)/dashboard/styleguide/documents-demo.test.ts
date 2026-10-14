import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../accounts/[accountId]/contacts/documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
}));
const { DocumentsDemo } = await import("./documents-demo");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

describe("styleguide: the Documents card in every state (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(DocumentsDemo));
  const text = renderedText(html);

  it("loaded in English and Spanish, empty, loading, error, and the card with its upload panel open mid-batch (mutation: drop a state -> FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-documents"');
    expect(html.match(/data-documents-card(?=[\s>=])/g)).toHaveLength(6);
    expect(text).toContain(m["documents.empty.contact"]);
    expect(text).toContain(m["documents.loadFailed"]);
    expect(html).toContain("data-documents-skeleton");
    expect(html).toContain("data-documents-panel");
    expect(text).toContain(m["documents.progress.uploading"].replace("{percent}", "45"));
    expect(text).toContain(m["documents.progress.checking"]);
    expect(text).toContain(m["documents.error.quota"]);
  });

  it("the Spanish copy is the Spanish catalogue's, under lang=es (mutation: render the Spanish box in English -> FAILS)", () => {
    expect(html).toMatch(/lang="es"/);
    const es = html.slice(html.indexOf('lang="es"'));
    const esText = renderedText(es.slice(0, es.indexOf("data-documents-card", es.indexOf("data-documents-card") + 1)));
    expect(esText).toContain(m["documents.ownersOnly.es"]);
    expect(esText).toContain(m["documents.count.es"].replace("{count}", "3"));
    expect(esText).toContain(m["documents.trashList.es"].replace("{count}", "1"));
  });

  it("shows every rule-3 mark the card has: a near expiry, a past one, Owners only and the trash (mutation: drop the expiring file -> FAILS)", () => {
    // Two per loaded card (the contract 12 days out, the ID that expired), three loaded cards.
    expect(html.match(/data-expiry-dot/g)).toHaveLength(6);
    expect(html).toContain("data-owners-only");
    expect(html).toContain("data-document-restore");
  });
});
