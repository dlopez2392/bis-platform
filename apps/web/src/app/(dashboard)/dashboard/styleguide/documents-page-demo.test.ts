import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { DocumentsPageDemo, REQUIRED_DOCUMENTS_DEMO_STATES } = await import("./documents-page-demo");

describe("styleguide: the Documents page's Required documents card and list rows (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(DocumentsPageDemo));

  it("carries the Required card four times (English partial, Spanish partial, off, failed) and the list's three sample rows", () => {
    expect(html.match(/data-required-documents(?=[\s>=])/g)).toHaveLength(4);
    expect(html.match(/data-documents-page-row(?=[\s=])/g)).toHaveLength(3);
  });

  it("every one of the four states has at most one primary (rule 8; mutation: a second Save -> FAILS)", () => {
    expect(REQUIRED_DOCUMENTS_DEMO_STATES.length).toBe(4);
    for (const state of REQUIRED_DOCUMENTS_DEMO_STATES) {
      const stateHtml = renderToStaticMarkup(createElement("div", null, state));
      const count = (stateHtml.match(/data-variant="default"/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});
