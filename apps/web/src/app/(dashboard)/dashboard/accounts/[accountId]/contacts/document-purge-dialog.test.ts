import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { canPurge, DocumentPurgeForm } from "./document-purge-dialog";

const form = (typed: string, locale: "en" | "es" = "en", busy = false, versionCount = 2) => renderToStaticMarkup(createElement(DocumentPurgeForm, {
  title: "Lease", versionCount, typed, busy, locale, onTyped: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
}));
const confirmTag = (html: string) => /<button[^>]*data-variant="destructive"[^>]*>/.exec(html)![0];

describe("Delete forever's typed name (spec 4.4; DESIGN.md Documents; plan deviation 8)", () => {
  it("only the exact title confirms: case and edge spaces count (mutation: trim or lowercase -> FAILS)", () => {
    expect(canPurge("Lease", "Lease")).toBe(true);
    for (const typed of ["lease", "Lease ", " Lease", "LEASE", "Leas", ""]) expect(canPurge(typed, "Lease"), typed).toBe(false);
  });
  it("the destructive button is disabled until the name matches, and while the purge runs (mutation: drop disabled -> FAILS)", () => {
    expect(confirmTag(form(""))).toContain('disabled=""');
    expect(confirmTag(form("Leas"))).toContain('disabled=""');
    // The attribute, never the word: the button's own classes carry "disabled:opacity-50" on every render.
    expect(confirmTag(form("Lease"))).not.toContain('disabled=""');
    expect(confirmTag(form("Lease", "en", true))).toContain('disabled=""');
  });
  it("a near miss says why, an empty box does not (mutation: show the hint whenever it does not match -> FAILS on the empty box)", () => {
    expect(renderedText(form("lease"))).toContain(m["documents.purge.mismatch"]);
    expect(renderedText(form(""))).not.toContain(m["documents.purge.mismatch"]);
    expect(renderedText(form("Lease"))).not.toContain(m["documents.purge.mismatch"]);
  });
  it("says what goes and that it cannot come back; ONE primary, the destructive one, and a ghost Cancel (rule 8; mutation: make Cancel default -> FAILS)", () => {
    const html = form("");
    expect(renderedText(html)).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
    expect(renderedText(html)).toContain(m["documents.purge.label"]);
    expect(html.match(/data-variant="destructive"/g)).toHaveLength(1);
    expect(html).not.toContain('data-variant="default"');
    expect(html).toMatch(/data-variant="ghost"[^>]*>Cancel</);
    expect(html).toMatch(/data-variant="destructive"[^>]*>Delete forever</);
  });
  it("Spanish: the body, the label, the hint and both buttons are the Spanish catalogue's (mutation: an English word in es -> FAILS)", () => {
    const text = renderedText(form("lease", "es"));
    expect(text).toContain(m["documents.purge.body.es"].replace("{title}", "Lease"));
    expect(text).toContain(m["documents.purge.label.es"]);
    expect(text).toContain(m["documents.purge.mismatch.es"]);
    expect(text).toContain(m["documents.deleteForever.es"]);
    expect(text).toContain(m["documents.cancel.es"]);
  });
  it("a file with one version is not told it has versions; two or more are (review M11; mutation: always the plural body -> FAILS)", () => {
    expect(renderedText(form("", "en", false, 1))).toContain(m["documents.purge.bodyOne"].replace("{title}", "Lease"));
    expect(renderedText(form("", "en", false, 1))).not.toContain("versions");
    expect(renderedText(form("", "es", false, 1))).toContain(m["documents.purge.bodyOne.es"].replace("{title}", "Lease"));
    expect(renderedText(form("", "en", false, 3))).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
  });
  it("the name box carries no language of its own, so a screen reader reads a title as typed (mutation: drop lang=\"\" -> FAILS)", () => {
    expect(form("")).toMatch(/<input[^>]*lang=""/);
  });
});
