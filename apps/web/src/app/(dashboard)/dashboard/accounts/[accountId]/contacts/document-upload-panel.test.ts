import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { DocumentUploadPanel, type PanelFile } from "./document-upload-panel";

const f = (key: string, name: string, phase: PanelFile["phase"] = null): PanelFile =>
  ({ key, file: new File([new Uint8Array(3)], name), title: name.replace(/\..*$/, ""), category: name.endsWith(".jpg") ? "photo" : "other", phase });
const noop = vi.fn();
const render = (over: Partial<Parameters<typeof DocumentUploadPanel>[0]> = {}) => renderToStaticMarkup(createElement(DocumentUploadPanel, {
  files: [f("a", "lease.pdf"), f("b", "roof.jpg")], ownersOnly: false, expiresOn: "", canChooseOwnersOnly: true, busy: false, locale: "en",
  onCategory: noop, onRemove: noop, onOwnersOnly: noop, onExpires: noop, onUpload: noop, onRetry: noop, onCancel: noop, ...over,
}));

describe("the upload panel (spec 4.2)", () => {
  it("one category select per file, defaulted; ONE primary button, the panel's Upload (rule 8; mutation: make Cancel default -> FAILS)", () => {
    const html = render();
    expect(html.match(/data-panel-file=/g)).toHaveLength(2);
    expect(html).toMatch(/<option value="other" selected="">/);
    expect(html).toMatch(/<option value="photo" selected="">/);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(renderedText(html)).toContain(m["documents.upload"]);
  });
  it("Owners only is offered to an Owner only, once for the batch (mutation: drop the canChooseOwnersOnly guard -> FAILS)", () => {
    expect(render()).toContain("data-panel-owners-only");
    expect(render({ canChooseOwnersOnly: false })).not.toContain("data-panel-owners-only");
  });
  it("progress words, then a failed file keeps its reason and a ghost Retry; Spanish too (mutation: drop the failed branch -> FAILS)", () => {
    const html = render({ files: [f("a", "a.pdf", { kind: "uploading", percent: 45 }), f("b", "b.pdf", { kind: "checking" }),
      f("c", "c.pdf", { kind: "failed", error: "documents.error.tooLarge", params: { size: "31 MB" } })] });
    const text = renderedText(html);
    expect(text).toContain("Uploading 45%");
    expect(text).toContain(m["documents.progress.checking"]);
    expect(text).toContain("Too large: 31 MB. The limit is 25 MB.");
    expect(html).toMatch(/data-panel-retry[^>]*data-variant="ghost"|data-variant="ghost"[^>]*data-panel-retry/);
    expect(renderedText(render({ locale: "es", files: [f("a", "a.pdf", { kind: "checking" })] }))).toContain(m["documents.progress.checking.es"]);
  });
  it("the batch expiry is one date field bound to the whole batch (mutation: delete the expiry block -> FAILS)", () => {
    const html = render({ expiresOn: "2026-11-01" });
    expect(renderedText(html)).toContain(m["documents.panel.expires"]);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-01"/);
  });
  it("the progress bar respects prefers-reduced-motion (mutation: drop the motion-safe: prefixes -> FAILS)", () => {
    const html = render({ files: [f("a", "a.pdf", { kind: "uploading", percent: 45 })] });
    expect(html).toMatch(/class="[^"]*\bmotion-safe:transition-\[width\][^"]*\bmotion-safe:duration-150\b[^"]*"/);
  });
  it("a failed file's Retry is disabled while the batch or another retry runs, so a double click never files it twice (mutation: drop disabled={p.busy} on Retry -> FAILS)", () => {
    const failed = [f("c", "c.pdf", { kind: "failed", error: "documents.error.upload" })];
    const retryTag = (busy: boolean) => /<button[^>]*data-panel-retry[^>]*>/.exec(render({ files: failed, busy }))![0];
    expect(retryTag(true)).toMatch(/\sdisabled=""/);
    expect(retryTag(false)).not.toMatch(/\sdisabled=""/);
  });
});
