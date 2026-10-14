import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../accounts/[accountId]/contacts/documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
  startDocumentVersionUploadAction: vi.fn(), purgeDocumentAction: vi.fn(),
}));
const { DocumentsDemo, demoHandlers } = await import("./documents-demo");
const actions = await import("../accounts/[accountId]/contacts/documents-actions");
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
    expect(esText).toContain(m["documents.trashList.es"].replace("{count}", "2"));
  });

  it("shows every rule-3 mark the card has: a near expiry, a past one, Owners only and the trash (mutation: drop the expiring file -> FAILS)", () => {
    // Two per loaded card (the contract 12 days out, the ID that expired), three loaded cards.
    expect(html.match(/data-expiry-dot/g)).toHaveLength(6);
    expect(html).toContain("data-owners-only");
    expect(html).toContain("data-document-restore");
  });

  it("shows PR 1b's states: 'Version 2' on each loaded card, the space line where the account is above 80%, a version uploading, Delete forever in each trash, the Versions list and the typed-name form (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-document-version(?=[\s>=])/g)).toHaveLength(3);
    expect(html.match(/data-space-used/g)).toHaveLength(3);
    expect(html.match(/data-version-progress/g)).toHaveLength(1);
    // Two trashed files per loaded card (one ordinary, one whose Delete forever stopped part-way), three loaded cards.
    expect(html.match(/data-document-purge(?=[\s>=])/g)).toHaveLength(6);
    expect(html.match(/data-document-restore/g)).toHaveLength(3);
    expect(html.match(/data-document-purging[^>]*><span aria-hidden="true"[^>]*><\/span>/g)).toHaveLength(3);
    expect(text).toContain(m["documents.status.purging"]);
    expect(renderedText(html.slice(html.indexOf('lang="es"')))).toContain(m["documents.status.purging.es"]);
    expect(html).toContain("data-document-versions");
    expect(html).toContain("data-document-purge-form");
    expect(text).toContain(m["documents.purge.mismatch"]);
  });

  it("the demo's handlers are inert: none reaches a server action (PR 1a review M6; mutation: build demoHandlers from documentHandlers -> FAILS)", async () => {
    const doc = { id: "sg-1", title: "Signed contract" } as never;
    await demoHandlers.trash(doc);
    await demoHandlers.restore(doc);
    await demoHandlers.setOwnersOnly(doc, true);
    await demoHandlers.download(doc, "sg-v0");
    expect(await demoHandlers.saveField(doc, "title", "Renamed")).toMatchObject({ ok: true, shown: "Renamed" });
    expect(await demoHandlers.undoField({})).toEqual({ ok: true });
    expect(await demoHandlers.purge(doc, "Signed contract")).toBe(false);
    for (const fn of Object.values(actions)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });
});
