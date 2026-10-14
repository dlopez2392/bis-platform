import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
}));
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentsCardView, addedWhen, sourceLine, rowMenuItems, documentsRouteFor, exclusive, keepOpen } = await import("./documents-card");
type Props = Parameters<typeof DocumentsCardView>[0];
type Load = Props["load"];

const view = (over: Record<string, unknown> = {}) => ({
  id: "d1", title: "Signed lease", category: "contract", expiresOn: null, ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf", bytes: 1200 }, ...over,
});
const ready = (live: unknown[], trashed: unknown[] = [], capped = false): Load => ({ status: "ready", data: {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" }, live, trashed, capped } } as Load);
const handlers = { trash: vi.fn(), restore: vi.fn(), setOwnersOnly: vi.fn(), download: vi.fn(), changed: vi.fn() };
const render = (load: Load, over: Partial<Props> = {}) => renderToStaticMarkup(createElement(DocumentsCardView, {
  accountId: "acc", load, canManage: true, emptyText: m["documents.empty.contact"], locale: "en", handlers,
  onRetry: vi.fn(), onFiles: vi.fn(), onOpen: vi.fn(), panel: null, ...over,
} as Props));
/** One row's own markup, from its opening <li> to the next row or the end of the list. */
const rowOf = (html: string, id: string) => {
  const at = html.indexOf(`data-document-row="${id}"`);
  const end = html.indexOf("</li>", at);
  return html.slice(html.lastIndexOf("<li", at), end);
};

describe("the Documents card (spec 4.1, 4.5)", () => {
  it("loaded: rows in the order given, count, category word, source line, ONE primary (Upload), Take photo is ghost (mutation: make Take photo default -> FAILS)", () => {
    const html = render(ready([view(), view({ id: "d2", title: "Roof", category: "photo", source: "camera", addedBy: { you: true, name: null } })]));
    const text = renderedText(html);
    expect(html.match(/data-document-row=/g)).toHaveLength(2);
    expect(html.indexOf('data-document-row="d1"')).toBeLessThan(html.indexOf('data-document-row="d2"'));
    expect(text).toContain("2 files");
    expect(text).toContain("Contract");
    expect(text).toContain("Added by Ana · 3 days ago");
    expect(text).toContain("Photo taken by you · 3 days ago");
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="default"[^>]*>Upload</);
    expect(html).toMatch(/data-take-photo[^>]*data-variant="ghost"|data-variant="ghost"[^>]*data-take-photo/);
  });

  it("Take photo is shown only on a coarse pointer or a narrow screen (mutation: drop the pointer-coarse variant -> FAILS)", () => {
    const tag = /<button[^>]*data-take-photo[^>]*>/.exec(render(ready([view()])))![0];
    expect(tag).toMatch(/class="[^"]*\bhidden\b/);
    expect(tag).toContain("max-md:inline-flex");
    expect(tag).toContain("pointer-coarse:inline-flex");
  });

  it("the camera input asks for the back camera, the file input takes several files (mutation: drop capture -> FAILS)", () => {
    const html = render(ready([view()]));
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*multiple=""/);
  });

  it("with the upload panel open, the header's Upload and Take photo are not drawn: the panel's Upload is the one primary (rule 8; mutation: always draw the header buttons -> FAILS)", () => {
    const html = render(ready([view()]), { panel: createElement("div", { "data-documents-panel": "" }) });
    expect(html).toContain("data-documents-panel");
    expect(html).not.toContain('data-variant="default"');
    expect(html).not.toContain("data-take-photo");
    expect(html.match(/data-document-row=/g)).toHaveLength(1);
  });

  it("the whole row opens the viewer: one open button stretched over the row, hover --surface-3, a focus ring, no checkbox (rule 4; mutation: drop the stretch -> FAILS)", () => {
    const row = rowOf(render(ready([view()])), "d1");
    // The row's OWN tag: the ghost menu button inside it carries the same hover class, so the whole row's markup would prove nothing.
    expect(/^<li[^>]*>/.exec(row)![0]).toContain("hover:bg-[var(--surface-3)]");
    const open = /<button[^>]*aria-label="Open Signed lease"[^>]*>/.exec(row)![0];
    expect(open).toContain("after:absolute");
    expect(open).toContain("after:inset-0");
    expect(open).toMatch(/focus-visible:after:ring-\[3px\]/);
    expect(row).toMatch(/aria-label="More for Signed lease"/);
    expect(row).not.toContain('type="checkbox"');
    expect(row).not.toContain('role="checkbox"');
  });

  it("expiry: 12 days out is a dot AND the words; 31 days out is words with no dot (rule 3; mutation: drop the dot -> FAILS)", () => {
    const html = render(ready([view({ expiresOn: "2026-10-25" }), view({ id: "d2", expiresOn: "2026-11-13" }), view({ id: "d3", expiresOn: "2026-10-10" })]));
    expect(rowOf(html, "d1")).toContain("data-expiry-dot");
    expect(rowOf(html, "d2")).not.toContain("data-expiry-dot");
    expect(rowOf(html, "d3")).toContain("data-expiry-dot");
    expect(rowOf(html, "d3")).toContain("bg-[var(--crit)]");
    expect(rowOf(html, "d1")).toContain("bg-[var(--warn)]");
    const text = renderedText(html);
    expect(text).toContain("Expires in 12 days");
    expect(text).toContain("Expires in 31 days");
    expect(text).toContain("Expired 3 days ago");
  });

  it("Owners only is a lock and the word (mutation: drop the word -> FAILS)", () => {
    const html = render(ready([view({ ownersOnly: true }), view({ id: "d2" })]));
    const row = rowOf(html, "d1");
    expect(row).toContain("data-owners-only");
    expect(row).toMatch(/data-owners-only[^>]*><svg[^>]*lucide-lock/);
    expect(renderedText(row)).toContain(m["documents.ownersOnly"]);
    expect(rowOf(html, "d2")).not.toContain("data-owners-only");
  });

  it("trashed files leave the list and the count, and sit under Trash (n) with 'Deleted for good in N days' and a ghost Restore (mutation: count trashed files -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z" })]));
    const text = renderedText(html);
    expect(text).toContain("1 file");
    expect(text).not.toContain("2 files");
    expect(text).toContain("Trash (1)");
    expect(text).toContain("Deleted for good in 27 days");
    expect(html.match(/data-document-row=/g)).toHaveLength(1);
    expect(html).toMatch(/data-document-trashed="t1"/);
    expect(html).toMatch(/data-document-restore[^>]*data-variant="ghost"|data-variant="ghost"[^>]*data-document-restore/);
  });

  it("no Trash section when nothing is in the trash (mutation: always draw it -> FAILS)", () => {
    expect(render(ready([view()]))).not.toContain("data-documents-trash");
  });

  it("empty: the spec's sentence and Upload; loading: skeleton rows, no spinner; error: the card's own sentence with Retry (rule 5, rule 7)", () => {
    const empty = render(ready([]));
    expect(renderedText(empty)).toContain(m["documents.empty.contact"]);
    expect(empty).toMatch(/data-variant="default"[^>]*>Upload</);
    expect(renderedText(empty)).toContain("0 files");
    const loading = render({ status: "loading" });
    expect(loading).toContain("data-documents-skeleton");
    expect(loading).not.toMatch(/animate-spin|spinner/);
    const error = render({ status: "error" });
    expect(error).toMatch(/role="alert"[^>]*data-record-error|data-record-error[^>]*role="alert"/);
    expect(renderedText(error)).toContain(m["documents.loadFailed"]);
    expect(error).toMatch(/data-variant="ghost"[^>]*>Retry</);
  });

  it("capped: says only the newest 200 are shown (mutation: drop the capped line -> FAILS)", () => {
    expect(renderedText(render(ready([view()], [], true)))).toContain(m["documents.capped"]);
    expect(renderedText(render(ready([view()])))).not.toContain(m["documents.capped"]);
  });

  it("names no hero and paints no literal colour (rule 11, tokens only; mutation: a hex class -> FAILS)", () => {
    const html = render(ready([view({ ownersOnly: true, expiresOn: "2026-10-14" })], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z" })]));
    expect(html).not.toContain("data-hero");
    expect(html).not.toContain("gradient-hero");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("Spanish: the count, a category, the source line, an expiry and the trash (mutation: hard-code an English word -> FAILS)", () => {
    const html = render(ready([view({ expiresOn: "2026-10-13" })], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z" })]),
      { locale: "es", emptyText: m["documents.empty.contact.es"] });
    const text = renderedText(html);
    expect(text).toContain(m["documents.countOne.es"].replace("{count}", "1"));
    expect(text).toContain(m["documents.category.contract.es"]);
    expect(text).toContain(m["documents.addedBy.es"].replace("{name}", "Ana").replace("{when}", "hace 3 días"));
    expect(text).toContain(m["documents.expires.today.es"]);
    expect(text).toContain(m["documents.trashList.es"].replace("{count}", "1"));
    expect(text).toContain(m["documents.purgeIn.es"].replace("{count}", "27"));
    expect(text).toContain(m["documents.upload.es"]);
    expect(text).toContain(m["documents.takePhoto.es"]);
    expect(text).toContain(m["documents.restore.es"]);
    expect(html).toContain(`aria-label="${m["documents.open.es"].replace("{title}", "Signed lease")}"`);
  });

  it("Spanish error and empty states (mutation: an English Retry -> FAILS)", () => {
    const error = renderedText(render({ status: "error" }, { locale: "es" }));
    expect(error).toContain(m["documents.loadFailed.es"]);
    expect(error).toContain(m["documents.retry.es"]);
    expect(renderedText(render(ready([]), { locale: "es", emptyText: m["documents.empty.contact.es"] }))).toContain(m["documents.empty.contact.es"]);
  });

  it("the row menu offers Owners only to an Owner only, with the word for the file's current state (mutation: drop the canManage guard in rowMenuItems -> FAILS)", () => {
    expect(rowMenuItems(view() as never, false).map((i) => i.id)).toEqual(["edit", "download", "trash"]);
    expect(rowMenuItems(view() as never, true).map((i) => [i.id, i.labelKey])).toEqual([
      ["edit", "documents.edit"], ["ownersOnly", "documents.makeOwnersOnly"], ["download", "documents.download"], ["trash", "documents.trash"]]);
    expect(rowMenuItems(view({ ownersOnly: true }) as never, true).find((i) => i.id === "ownersOnly")!.labelKey).toBe("documents.makeTeam");
  });
});

describe("addedWhen, sourceLine and documentsRouteFor", () => {
  it("relative CALENDAR days in the reader's language; a name the reader cannot read is 'Someone on the team' (mutation: show null as blank -> FAILS)", () => {
    expect(addedWhen("2026-10-13", "2026-10-13", "en")).toBe("today");
    expect(addedWhen("2026-10-12", "2026-10-13", "es")).toBe("ayer");
    expect(sourceLine(view({ addedBy: { you: false, name: null } }) as never, "2026-10-13", "en")).toBe("Added by Someone on the team · 3 days ago");
    expect(sourceLine(view({ addedBy: { you: false, name: null } }) as never, "2026-10-13", "es"))
      .toBe(m["documents.addedBy.es"].replace("{name}", m["assign.someone.es"]).replace("{when}", "hace 3 días"));
    expect(sourceLine(view({ addedBy: { you: true, name: null }, source: "camera" }) as never, "2026-10-13", "es"))
      .toBe(m["documents.photoBy.es"].replace("{name}", m["documents.you.es"]).replace("{when}", "hace 3 días"));
  });

  it("an evening upload read the next morning says 'yesterday', in both languages, from the account's own days (mutation: elapsed-hours arithmetic on createdAt -> FAILS)", () => {
    // 21:30 on the 12th in the account's zone (02:30Z on the 13th), read at 08:00 on the 13th (13:00Z): 10.5 hours, one calendar day.
    const evening = view({ createdAt: "2026-10-13T02:30:00.000Z", addedOn: "2026-10-12" });
    const html = render(ready([evening]));
    expect(renderedText(html)).toContain("Added by Ana · yesterday");
    const es = renderedText(render(ready([evening]), { locale: "es", emptyText: m["documents.empty.contact.es"] }));
    expect(es).toContain(m["documents.addedBy.es"].replace("{name}", "Ana").replace("{when}", "ayer"));
  });

  it("a day ahead of the account's today (clock skew) reads 'today', never 'tomorrow' (mutation: drop the floor at zero -> FAILS)", () => {
    expect(addedWhen("2026-10-14", "2026-10-13", "en")).toBe("today");
    expect(addedWhen("2026-10-14", "2026-10-13", "es")).toBe("hoy");
  });

  it("a contact reads its own route, a group its own (mutation: one route for both -> FAILS)", () => {
    expect(documentsRouteFor("acc", { kind: "contact", id: "c1" })).toBe("/api/accounts/acc/contacts/c1/documents");
    expect(documentsRouteFor("acc", { kind: "group", id: "g1" })).toBe("/api/accounts/acc/groups/g1/documents");
  });
});

describe("the upload lock (one batch or one retry at a time)", () => {
  it("a second run while the first holds the lock does nothing, and the lock is free again however the first ends (mutation: drop the held check -> FAILS)", async () => {
    const lock = { held: false };
    let release!: () => void;
    const run = vi.fn(() => new Promise<string>((r) => { release = () => r("done"); }));
    const first = exclusive(lock, run);
    expect(lock.held).toBe(true);
    const second = exclusive(lock, run);
    // Asserted before either settles, so the mutation fails on this line rather than hanging on a second, never-released run.
    expect(run).toHaveBeenCalledTimes(1);
    expect(await second).toBeNull();
    release();
    expect(await first).toBe("done");
    expect(lock.held).toBe(false);
    await expect(exclusive(lock, () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(lock.held).toBe(false);
  });
});

describe("the viewer's open file", () => {
  it("is forgotten when a ready read no longer lists it, so a later Undo or Restore never reopens it by itself (mutation: keep the id -> FAILS)", () => {
    expect(keepOpen("d1", ready([view()]))).toBe("d1");
    expect(keepOpen("d1", ready([view({ id: "d2" })], [view({ deletedAt: "2026-10-12T00:00:00.000Z" })]))).toBeNull();
    expect(keepOpen("d1", { status: "error" })).toBe("d1");
    expect(keepOpen(null, ready([view()]))).toBeNull();
  });
});
