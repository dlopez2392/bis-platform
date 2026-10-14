import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("./documents-actions", () => ({ getDocumentUrlAction: vi.fn() }));
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentViewerBody, viewerStateFor, fetchKeyFor } = await import("./document-viewer");

const doc = (contentType: string) => ({
  id: "d", title: "Lease", category: "contract" as const, expiresOn: null, ownersOnly: false, source: "upload" as const,
  addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
  version: { id: "v", contentType: contentType as never, bytes: 10 },
});
const body = (contentType: string, state: Parameters<typeof DocumentViewerBody>[0]["state"]) =>
  renderToStaticMarkup(createElement(DocumentViewerBody, { doc: doc(contentType), state, locale: "en", onRetry: vi.fn() }));

describe("the viewer's body (spec 4.3)", () => {
  it("an image renders inline from the minted URL; a PDF in a frame (mutation: render a PDF as <img> -> FAILS)", () => {
    expect(body("image/jpeg", { status: "ready", url: "https://s/x", contentType: "image/jpeg" })).toMatch(/<img[^>]+src="https:\/\/s\/x"/);
    expect(body("application/pdf", { status: "ready", url: "https://s/y", contentType: "application/pdf" })).toMatch(/<iframe[^>]+src="https:\/\/s\/y"/);
  });
  it("Word and Excel are never rendered: the sentence, no frame, no image (mutation: render office in the frame -> FAILS)", () => {
    const html = body("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      { status: "ready", url: "https://s/z", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(html).not.toMatch(/<iframe|<img/);
    expect(html).toContain(m["documents.viewer.noPreview"]);
  });
  it("loading is a skeleton, never a spinner; an error says so with Retry (rule 7, rule 5)", () => {
    expect(body("application/pdf", { status: "loading" })).toContain("data-viewer-skeleton");
    // React escapes the apostrophe in "Couldn't" to &#x27; in static markup (rendered-text.ts's documented
    // trap): a direct toContain against raw html can never pass on correct code, so compare decoded text.
    expect(renderedText(body("application/pdf", { status: "error" }))).toContain(m["documents.error.open"]);
  });
});

describe("the fetch decision is pure (review I1): loading while the last answer is for a different key", () => {
  const ready: Parameters<typeof viewerStateFor>[1] = { key: "v1:0", value: { status: "ready", url: "https://s/a", contentType: "application/pdf" } };
  it("loading while result.key !== fetchKey (mutation: drop the key match -> FAILS)", () => {
    expect(viewerStateFor("v1:0", null)).toEqual({ status: "loading" });
    expect(viewerStateFor("v1:1", ready)).toEqual({ status: "loading" });
    expect(viewerStateFor("v1:0", ready)).toEqual(ready.value);
  });
  it("a stale result for an older versionId is never shown after versionId changes", () => {
    // The old document's answer (keyed "v1:0") must not leak into the new document's view.
    const newKey = fetchKeyFor("v2", 0);
    expect(viewerStateFor(newKey, ready)).toEqual({ status: "loading" });
  });
  it("Retry (attempt+1) shows loading again until the new answer lands (mutation: ignore attempt -> FAILS)", () => {
    const beforeRetry = fetchKeyFor("v1", 0);
    expect(viewerStateFor(beforeRetry, ready)).toEqual(ready.value);
    const afterRetry = fetchKeyFor("v1", 1);
    expect(viewerStateFor(afterRetry, ready)).toEqual({ status: "loading" });
    const landed: Parameters<typeof viewerStateFor>[1] = { key: afterRetry!, value: { status: "error" } };
    expect(viewerStateFor(afterRetry, landed)).toEqual({ status: "error" });
  });
});
