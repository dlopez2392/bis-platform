import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
vi.mock("./documents-actions", () => ({ getDocumentUrlAction: vi.fn() }));
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const {
  DocumentViewerBody, DocumentVersionsList, viewerStateFor, fetchKeyFor, imageErrorStep,
  FIRST_SESSION, sessionAfterImageError, sessionOnOpenChange,
} = await import("./document-viewer");

const doc = (contentType: string) => ({
  id: "d", title: "Lease", category: "contract" as const, expiresOn: null, ownersOnly: false, source: "upload" as const,
  addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
  version: { id: "v", contentType: contentType as never, bytes: 10 },
  versions: [{ id: "v", contentType: contentType as never, bytes: 10, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30" }],
  purging: false,
});
const body = (contentType: string, state: Parameters<typeof DocumentViewerBody>[0]["state"]) =>
  renderToStaticMarkup(createElement(DocumentViewerBody, { doc: doc(contentType), state, locale: "en", onRetry: vi.fn(), onImageError: vi.fn() }));

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

describe("one automatic retry for a broken image (PR 1a review M7)", () => {
  it("the first error for a version re-mints once; the second is the error state; a new version gets its own retry (mutation: always 'retry' -> FAILS)", () => {
    expect(imageErrorStep("v1", null)).toBe("retry");
    expect(imageErrorStep("v1", "v1")).toBe("fail");
    expect(imageErrorStep("v2", "v1")).toBe("retry");
    expect(imageErrorStep(null, null)).toBe("fail");
  });
  it("the image's onError is the bounded handler, never the Retry button's re-mint (mutation: onError={onRetry} -> FAILS)", () => {
    const onRetry = vi.fn();
    const onImageError = vi.fn();
    const el = DocumentViewerBody({
      doc: doc("image/png"), state: { status: "ready", url: "https://s/i", contentType: "image/png" }, locale: "en", onRetry, onImageError,
    }) as ReactElement<{ onError?: unknown; src?: string }>;
    expect(el.props.src).toBe("https://s/i");
    expect(el.props.onError).toBe(onImageError);
  });
});

describe("the viewer's session is pure: the image's error step and a close (Task 7 review I1, M1)", () => {
  const ready = (key: string) => ({ key, value: { status: "ready" as const, url: "https://s/i", contentType: "image/png" as never } });
  it("the first error re-mints once and records the version; a second error does not re-mint (mutation: drop the record of the spent retry -> FAILS)", () => {
    const s0 = { ...FIRST_SESSION, open: true, result: ready("v1:0") };
    const s1 = sessionAfterImageError(s0, "v1");
    expect(s1.attempt).toBe(1);
    expect(s1.autoRetriedFor).toBe("v1");
    const s2 = sessionAfterImageError({ ...s1, result: ready("v1:1") }, "v1");
    expect(s2.attempt).toBe(1);
  });
  it("the second error is the viewer's error state for the CURRENT key, where Retry lives (mutation: drop the fail branch -> FAILS)", () => {
    const s1 = { ...FIRST_SESSION, open: true, attempt: 1, autoRetriedFor: "v1", result: ready("v1:1") };
    const s2 = sessionAfterImageError(s1, "v1");
    expect(viewerStateFor(fetchKeyFor("v1", s2.attempt), s2.result)).toEqual({ status: "error" });
  });
  it("closing bumps the attempt, so reopening the same file mints a fresh link, never the cached one (mutation: a close keeps the attempt -> FAILS)", () => {
    const opened = sessionOnOpenChange(FIRST_SESSION, true);
    const landed = { ...opened, result: ready(fetchKeyFor("v1", opened.attempt)!) };
    expect(viewerStateFor(fetchKeyFor("v1", landed.attempt), landed.result)).toEqual(landed.result.value);
    const reopened = sessionOnOpenChange(sessionOnOpenChange(landed, false), true);
    expect(viewerStateFor(fetchKeyFor("v1", reopened.attempt), reopened.result)).toEqual({ status: "loading" });
  });
  it("an unchanged open state answers the SAME session, so the render-time adjustment settles (mutation: always a new object -> FAILS)", () => {
    const opened = sessionOnOpenChange(FIRST_SESSION, true);
    expect(sessionOnOpenChange(opened, true)).toBe(opened);
    expect(sessionOnOpenChange(FIRST_SESSION, false)).toBe(FIRST_SESSION);
  });
});

describe("the Versions list (spec 4.3)", () => {
  const three = {
    ...doc("application/pdf"),
    version: { id: "v3", contentType: "application/pdf" as never, bytes: 30 },
    versions: [
      { id: "v3", contentType: "application/pdf" as never, bytes: 30, createdAt: "2026-10-13T10:00:00Z", addedOn: "2026-10-13" },
      { id: "v2", contentType: "image/jpeg" as never, bytes: 20, createdAt: "2026-10-10T10:00:00Z", addedOn: "2026-10-10" },
      { id: "v1", contentType: "application/pdf" as never, bytes: 10, createdAt: "2026-10-01T10:00:00Z", addedOn: "2026-10-01" },
    ],
  };
  const list = (d: typeof three, locale: "en" | "es" = "en") =>
    renderToStaticMarkup(createElement(DocumentVersionsList, { doc: d, locale, when: (day: string) => `on ${day}`, onDownload: vi.fn() }));
  const rowOf = (html: string, id: string) => {
    const at = html.indexOf(`data-document-version-row="${id}"`);
    return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
  };
  it("newest first, numbered by upload order, the newest the highest (mutation: number by index + 1 -> FAILS)", () => {
    const html = list(three);
    expect(html.indexOf('"v3"')).toBeLessThan(html.indexOf('"v2"'));
    expect(html.indexOf('"v2"')).toBeLessThan(html.indexOf('"v1"'));
    expect(renderedText(rowOf(html, "v3"))).toContain("Version 3 · on 2026-10-13");
    expect(renderedText(rowOf(html, "v1"))).toContain("Version 1 · on 2026-10-01");
  });
  it("the current version is marked Current and offers no second Download; each older one has a ghost Download named for its number (mutation: a Download on the current row -> FAILS)", () => {
    const html = list(three);
    expect(renderedText(rowOf(html, "v3"))).toContain(m["documents.versionCurrent"]);
    expect(rowOf(html, "v3")).not.toContain("<button");
    expect(rowOf(html, "v2")).toMatch(/<button[^>]*aria-label="Download version 2"/);
    expect(rowOf(html, "v2")).toMatch(/data-variant="ghost"/);
    expect(html).not.toContain('data-variant="default"');
  });
  it("its heading is the label role, as record-section.tsx writes it (mutation: drop the mono label -> FAILS)", () => {
    expect(list(three)).toMatch(/<h3[^>]*class="[^"]*font-mono[^"]*tracking-\[0\.14em\][^"]*"[^>]*>Versions</);
  });
  it("Spanish: the line, Current and the Download name are the Spanish catalogue's (mutation: an English word in es -> FAILS)", () => {
    const html = list(three, "es");
    expect(renderedText(rowOf(html, "v2"))).toContain(m["documents.versionLine.es"].replace("{n}", "2").replace("{when}", "on 2026-10-10"));
    expect(renderedText(rowOf(html, "v3"))).toContain(m["documents.versionCurrent.es"]);
    expect(rowOf(html, "v2")).toContain(`aria-label="${m["documents.downloadVersion.es"].replace("{n}", "2")}"`);
    expect(renderedText(html)).toContain(m["documents.versions.es"]);
  });
  it("Current follows the current version's id, not the top row (deviation 7; Task 7 review M2; mutation: i === 0 -> FAILS)", () => {
    const html = list({ ...three, version: { id: "v2", contentType: "image/jpeg" as never, bytes: 20 } });
    expect(renderedText(rowOf(html, "v2"))).toContain(m["documents.versionCurrent"]);
    expect(rowOf(html, "v2")).not.toContain("<button");
    expect(rowOf(html, "v3")).toMatch(/<button[^>]*aria-label="Download version 3"/);
  });
  it("a file with one version draws no list at all (mutation: render for one version -> FAILS)", () => {
    expect(list({ ...three, versions: [three.versions[0]!] })).toBe("");
  });
});
