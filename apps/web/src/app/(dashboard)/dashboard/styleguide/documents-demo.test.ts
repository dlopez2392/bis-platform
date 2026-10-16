import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../accounts/[accountId]/contacts/documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
  startDocumentVersionUploadAction: vi.fn(), purgeDocumentAction: vi.fn(),
}));
vi.mock("../accounts/[accountId]/contacts/document-requests-actions", () => ({
  createDocumentRequestAction: vi.fn(), documentRequestLinkAction: vi.fn(), revokeDocumentRequestAction: vi.fn(), undoRevokeDocumentRequestAction: vi.fn(),
}));
vi.mock("../accounts/[accountId]/contacts/document-requirements-actions", () => ({
  skipDocumentRequirementAction: vi.fn(), undoSkipDocumentRequirementAction: vi.fn(), unskipDocumentRequirementAction: vi.fn(), undoUnskipDocumentRequirementAction: vi.fn(),
}));
const requestActions = await import("../accounts/[accountId]/contacts/document-requests-actions");
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
    expect(esText).toContain(m["documents.count.es"].replace("{count}", "7"));
    expect(esText).toContain(m["documents.trashList.es"].replace("{count}", "2"));
  });

  it("shows one Checking row, one removed row, one password-protected row and one generic couldn't-check row, in both languages (S-07 2a; final review item 7; mutation: drop a scan state -> FAILS)", () => {
    expect(html.match(/data-document-scan="pending"/g)).toHaveLength(3);
    expect(html.match(/data-document-scan="infected"/g)).toHaveLength(3);
    expect(html.match(/data-document-scan="locked"/g)).toHaveLength(3);
    expect(html.match(/data-document-scan="unscannable"/g)).toHaveLength(3);
    expect(text).toContain(m["documents.status.scanning"]);
    expect(text).toContain(m["documents.status.virusRemoved"]);
    expect(text).toContain(m["documents.status.passwordRemoved"]);
    expect(text).toContain(m["documents.status.unscannable"]);
    const es = renderedText(html.slice(html.indexOf('lang="es"')));
    expect(es).toContain(m["documents.status.scanning.es"]);
    expect(es).toContain(m["documents.status.virusRemoved.es"]);
    expect(es).toContain(m["documents.status.passwordRemoved.es"]);
    expect(es).toContain(m["documents.status.unscannable.es"]);
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
    expect(await demoHandlers.askCustomer({ record: { kind: "contact", id: "sg-c" }, items: [{ key: "id", category: "id", note: null }], channel: "link" })).toBeNull();
    await demoHandlers.copyRequestLink("sg-r1");
    await demoHandlers.revokeRequest("sg-r1");
    for (const fn of Object.values(actions)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    for (const fn of Object.values(requestActions)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("styleguide: Ask the customer (S-07 2b)", () => {
  const html = renderToStaticMarkup(createElement(DocumentsDemo));
  const text = renderedText(html).replace(/\s+/g, " ");

  it("the request form in English (both channels) and Spanish (no texting, the Other error) (mutation: drop a form -> FAILS)", () => {
    expect(html.match(/data-document-request-form(?=[\s>=])/g)).toHaveLength(2);
    expect(text).toContain("Ask Ana for documents");
    expect(text).toContain("Pedir documentos a Ana");
    expect(text).toContain(m["documents.request.textOff.es"]);
    expect(html).toMatch(/role="alert"[^>]*>Diga qué necesita en Otro\.</);
  });

  it("the open requests loaded (one received and one waiting item) and in their error state (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-document-requests(?=[\s>=])/g)).toHaveLength(2);
    expect(text).toContain("Insurance · Received");
    expect(text).toContain("Pool permit · Waiting");
    expect(text).toContain("expires in 6 days");
    expect(text).toContain(m["documents.requests.loadFailed"]);
  });

  it("every loaded card offers Ask the customer as a ghost and still has one primary (rule 8)", () => {
    // Three loaded cards draw the header (the panel card gives its header to the panel).
    expect(html.match(/data-ask-customer/g)).toHaveLength(3);
    for (const tag of html.match(/<button[^>]*data-ask-customer[^>]*>/g)!) expect(tag).toContain('data-variant="ghost"');
  });

  it("a customer's file reads 'Sent by the customer' on the loaded cards, in both languages", () => {
    expect(text).toContain("Sent by the customer ·");
    expect(renderedText(html.slice(html.indexOf('lang="es"')))).toContain("Enviado por el cliente ·");
  });
});

describe("styleguide: the required documents (S-07 2c)", () => {
  const html = renderToStaticMarkup(createElement(DocumentsDemo));

  it("five standalone states (English partial, Spanish partial, complete with a skipped item, loading, error) and one card with the meter in its top row (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-document-checklist(?=[\s>=])/g)).toHaveLength(6);
    expect(html.match(/data-requirements-meter/g)).toHaveLength(1);
    for (const state of ["loading", "error"]) expect(html).toContain(`data-document-checklist="true" data-state="${state}"`);
    const text = renderedText(html).replace(/\s+/g, " ");
    expect(text).toContain("Missing: Insurance");
    expect(text).toContain("Expired: ID");
    expect(text).toContain("Checking: Warranty");
    expect(text).toContain("Falta: Seguro");
    expect(text).toContain(m["documents.checklist.loadFailed"]);
  });

  it("every button inside a checklist block is ghost (rule 8; mutation: a checklist Upload as default -> FAILS)", () => {
    // Every checklist button carries data-checklist-action; the error block adds its Retry.
    const tags = html.match(/<button[^>]*data-checklist-action[^>]*>/g) ?? [];
    for (const tag of tags) expect(tag).toContain('data-variant="ghost"');
    const error = html.slice(html.indexOf('data-state="error"'));
    expect(/<button[^>]*>/.exec(error)![0]).toContain('data-variant="ghost"');
    const buttons = tags.length;
    expect(buttons).toBeGreaterThan(0);
  });
});
