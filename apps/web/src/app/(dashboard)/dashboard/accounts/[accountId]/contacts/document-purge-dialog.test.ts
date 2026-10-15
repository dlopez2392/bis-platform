import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "@/components/ui/dialog";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { canPurge, DocumentPurgeBody, DocumentPurgeForm } from "./document-purge-dialog";

const form = (typed: string, locale: "en" | "es" = "en", busy = false, versionCount = 2) => renderToStaticMarkup(createElement(DocumentPurgeForm, {
  title: "Lease", versionCount, typed, busy, locale, onTyped: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
}));
const confirmTag = (html: string) => /<button[^>]*data-variant="destructive"[^>]*>/.exec(html)![0];
const inputTag = (html: string) => /<input[^>]*>/.exec(html)![0];
// The title is its own `<span lang="">` inside the body sentence (review M6), and renderedText turns
// every tag into a space: collapse whitespace so a copy assertion reads the sentence as a reader does.
const text = (html: string) => renderedText(html).replace(/\s+/g, " ");

describe("Delete forever's typed name (spec 4.4; DESIGN.md Documents; plan deviation 8)", () => {
  it("only the exact title confirms: case and edge spaces count (mutation: trim or lowercase -> FAILS)", () => {
    expect(canPurge("Lease", "Lease")).toBe(true);
    for (const typed of ["lease", "Lease ", " Lease", "LEASE", "Leas", ""]) expect(canPurge(typed, "Lease"), typed).toBe(false);
  });
  it("what the screen shows confirms: a run of spaces, a non-breaking space and a decomposed accent compare as typed; another letter refuses (Task 7 review I2; mutation: compare raw strings -> FAILS)", () => {
    expect(canPurge("Lease 2026", "Lease  2026")).toBe(true);
    expect(canPurge("Lease 2026", "Lease\u00a02026")).toBe(true);
    expect(canPurge("Pe\u00f1a", "Pen\u0303a")).toBe(true);
    expect(canPurge("Pena", "Pen\u0303a")).toBe(false);
    expect(canPurge("Lease 2025", "Lease  2026")).toBe(false);
  });
  it("the destructive button is disabled until the name matches, and while the purge runs (mutation: drop disabled -> FAILS)", () => {
    expect(confirmTag(form(""))).toContain('disabled=""');
    expect(confirmTag(form("Leas"))).toContain('disabled=""');
    // The attribute, never the word: the button's own classes carry "disabled:opacity-50" on every render.
    expect(confirmTag(form("Lease"))).not.toContain('disabled=""');
    expect(confirmTag(form("Lease", "en", true))).toContain('disabled=""');
  });
  it("a near miss says why, an empty box does not (mutation: show the hint whenever it does not match -> FAILS on the empty box)", () => {
    expect(text(form("lease"))).toContain(m["documents.purge.mismatch"]);
    expect(text(form(""))).not.toContain(m["documents.purge.mismatch"]);
    expect(text(form("Lease"))).not.toContain(m["documents.purge.mismatch"]);
  });
  it("the name box is described by the hint while it shows, and by nothing otherwise (Task 7 review M5; mutation: drop aria-describedby -> FAILS)", () => {
    const html = form("lease");
    const hintId = /<p[^>]*data-purge-mismatch[^>]*>/.exec(html)![0].match(/id="([^"]+)"/)![1];
    expect(inputTag(html)).toContain(`aria-describedby="${hintId}"`);
    expect(inputTag(form(""))).not.toContain("aria-describedby");
  });
  it("says what goes and that it cannot come back; ONE primary, the destructive one, and a ghost Cancel (rule 8; mutation: make Cancel default -> FAILS)", () => {
    const html = form("");
    expect(text(html)).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
    expect(text(html)).toContain(m["documents.purge.label"]);
    expect(html.match(/data-variant="destructive"/g)).toHaveLength(1);
    expect(html).not.toContain('data-variant="default"');
    expect(html).toMatch(/data-variant="ghost"[^>]*>Cancel</);
    expect(html).toMatch(/data-variant="destructive"[^>]*>Delete forever</);
  });
  it("the title inside the sentence carries no language of its own (Task 7 review M6; mutation: interpolate it as plain text -> FAILS)", () => {
    expect(form("")).toMatch(/<p[^>]*>[^<]*<span lang="">Lease<\/span>[^<]*<\/p>/);
    expect(form("", "es", false, 1)).toMatch(/<p[^>]*>[^<]*<span lang="">Lease<\/span>[^<]*<\/p>/);
  });
  it("Spanish: the body, the label, the hint and both buttons are the Spanish catalogue's (mutation: an English word in es -> FAILS)", () => {
    const t = text(form("lease", "es"));
    expect(t).toContain(m["documents.purge.body.es"].replace("{title}", "Lease"));
    expect(t).toContain(m["documents.purge.label.es"]);
    expect(t).toContain(m["documents.purge.mismatch.es"]);
    expect(t).toContain(m["documents.deleteForever.es"]);
    expect(t).toContain(m["documents.cancel.es"]);
  });
  it("a file with one version is not told it has versions; two or more are (review M11; mutation: always the plural body -> FAILS)", () => {
    expect(text(form("", "en", false, 1))).toContain(m["documents.purge.bodyOne"].replace("{title}", "Lease"));
    expect(text(form("", "en", false, 1))).not.toContain("versions");
    expect(text(form("", "es", false, 1))).toContain(m["documents.purge.bodyOne.es"].replace("{title}", "Lease"));
    expect(text(form("", "en", false, 3))).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
  });
  it("the name box carries no language of its own, so a screen reader reads a title as typed (mutation: drop lang=\"\" -> FAILS)", () => {
    expect(form("")).toMatch(/<input[^>]*lang=""/);
  });
});

describe("the dialog's body hands the form the file's real version count (Task 7 review M3)", () => {
  const v = (id: string) => ({ id, contentType: "application/pdf" as never, bytes: 10, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-10-01", scan: "clean" as const });
  const doc = (versions: ReturnType<typeof v>[]) => ({
    id: "d", title: "Lease", category: "contract" as const, expiresOn: null, ownersOnly: false, source: "upload" as const,
    addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-10-01", deletedAt: "2026-10-13T00:00:00Z",
    version: { id: versions[0]!.id, contentType: "application/pdf" as never, bytes: 10, scan: "clean" as const, createdAt: "2026-10-01T00:00:00Z" }, versions, purging: false,
  });
  // Radix's Title needs its Dialog's context; the Root draws its children (only Content portals).
  const body = (d: ReturnType<typeof doc>) => text(renderToStaticMarkup(createElement(Dialog, { open: false },
    createElement(DocumentPurgeBody, { doc: d, locale: "en", bodyId: "b", onClose: vi.fn(), onConfirm: vi.fn() }))));
  it("three versions read the plural body, one reads the one-version body (mutation: versionCount={1} -> FAILS)", () => {
    expect(body(doc([v("v3"), v("v2"), v("v1")]))).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
    expect(body(doc([v("v1")]))).toContain(m["documents.purge.bodyOne"].replace("{title}", "Lease"));
  });
});
