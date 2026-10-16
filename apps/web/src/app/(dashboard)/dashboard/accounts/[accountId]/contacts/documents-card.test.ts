import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
  startDocumentVersionUploadAction: vi.fn(), purgeDocumentAction: vi.fn(),
}));
vi.mock("./document-requests-actions", () => ({
  createDocumentRequestAction: vi.fn(), documentRequestLinkAction: vi.fn(), revokeDocumentRequestAction: vi.fn(), undoRevokeDocumentRequestAction: vi.fn(),
}));
vi.mock("./document-requirements-actions", () => ({
  skipDocumentRequirementAction: vi.fn(), undoSkipDocumentRequirementAction: vi.fn(), unskipDocumentRequirementAction: vi.fn(), undoUnskipDocumentRequirementAction: vi.fn(),
}));
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentsCardView, addedWhen, sourceLine, rowMenuItems, documentsRouteFor, exclusive, keepOpen, keepPurge, dropRefusal, rowSavers, versionToast, pollTimerKey,
  shouldReloadRequests, askAfter, keepRequests, requestsPollMs, requestsChanged, REQUESTS_POLL_MS, panelFiles } = await import("./documents-card");
type Props = Parameters<typeof DocumentsCardView>[0];
type Load = Props["load"];

const view = (over: Record<string, unknown> = {}) => ({
  id: "d1", title: "Signed lease", category: "contract", expiresOn: null, ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf", bytes: 1200, scan: "clean", createdAt: "2026-10-10T15:00:00.000Z" },
  versions: [{ id: "v1", contentType: "application/pdf", bytes: 1200, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", scan: "clean" }],
  purging: false, ...over,
});
const ready = (live: unknown[], trashed: unknown[] = [], capped = false, space: { used: number; quota: number } | null = null): Load => ({ status: "ready", data: {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" }, live, trashed, capped, space } } as Load);
const handlers = { trash: vi.fn(), restore: vi.fn(), setOwnersOnly: vi.fn(), download: vi.fn(), saveField: vi.fn(), undoField: vi.fn(), purge: vi.fn(), changed: vi.fn(),
  askCustomer: vi.fn(), copyRequestLink: vi.fn(), revokeRequest: vi.fn() };
type RequestsLoad = Props["requests"]["load"];
const openRequest = { id: "r1", channel: "link", createdAt: "2026-10-13T15:00:00.000Z", expiresAt: "2026-10-19T15:00:00.000Z",
  items: [{ key: "insurance", category: "insurance", note: null, answered: false }] };
const requestsReady = (requests: unknown[] = []): RequestsLoad =>
  ({ kind: "ready", data: { now: "2026-10-13T15:00:00.000Z", channels: { text: true, email: true }, requests } } as RequestsLoad);
const slot = (load: RequestsLoad = requestsReady()) => ({ load, onAsk: vi.fn(), onRetry: vi.fn(), onCopy: vi.fn(), onRevoke: vi.fn() });
// Every case renders with the requests read ready (so "Ask the customer" is drawn): the card's one-primary assertions below hold with it.
const render = (load: Load, over: Partial<Props> = {}) => renderToStaticMarkup(createElement(DocumentsCardView, {
  accountId: "acc", load, canManage: true, emptyText: m["documents.empty.contact"], locale: "en", handlers,
  onRetry: vi.fn(), onFiles: vi.fn(), onOpen: vi.fn(), panel: null, versionPhases: {}, onNewVersion: vi.fn(), onPurge: vi.fn(),
  requests: slot(), ...over,
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

  it("the row menu: Upload new version for everyone who sees the file, Owners only for an Owner only, in the spec's order (mutations: drop newVersion; drop the canManage guard -> FAILS)", () => {
    expect(rowMenuItems(view() as never, false).map((i) => i.id)).toEqual(["edit", "newVersion", "download", "trash"]);
    expect(rowMenuItems(view() as never, true).map((i) => [i.id, i.labelKey])).toEqual([
      ["edit", "documents.edit"], ["ownersOnly", "documents.makeOwnersOnly"], ["newVersion", "documents.newVersion"],
      ["download", "documents.download"], ["trash", "documents.trash"]]);
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
  it("a drop while the lock is held is refused with the wait sentence, never silently; over ten is refused as too many; otherwise it opens (mutation: answer null while held -> FAILS)", () => {
    expect(dropRefusal(true, 1)).toBe("documents.error.busy");
    expect(dropRefusal(true, 11)).toBe("documents.error.busy");
    expect(dropRefusal(false, 11)).toBe("documents.error.tooMany");
    expect(dropRefusal(false, 10)).toBeNull();
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

describe("versions, Delete forever and the space line on the card (PR 1b)", () => {
  const GIB = 1_073_741_824;
  const three = [
    { id: "v3", contentType: "application/pdf", bytes: 30, createdAt: "2026-10-12T15:00:00.000Z", addedOn: "2026-10-12", scan: "clean" },
    { id: "v2", contentType: "application/pdf", bytes: 20, createdAt: "2026-10-11T15:00:00.000Z", addedOn: "2026-10-11", scan: "clean" },
    { id: "v1", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", scan: "clean" },
  ];
  it("'Version 3' on a row with three ready versions, nothing on a row with one, in both languages (mutation: show it from one version -> FAILS)", () => {
    const multi = view({ version: { id: "v3", contentType: "application/pdf", bytes: 30, scan: "clean", createdAt: "2026-10-12T15:00:00.000Z" }, versions: three });
    const html = render(ready([multi, view({ id: "d2", title: "Roof" })]));
    expect(rowOf(html, "d1")).toContain("data-document-version");
    expect(renderedText(rowOf(html, "d1"))).toContain("Version 3");
    expect(rowOf(html, "d2")).not.toContain("data-document-version");
    const es = render(ready([multi]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(rowOf(es, "d1"))).toContain(m["documents.version.es"].replace("{n}", "3"));
  });
  it("a new version on its way shows its progress on its own row only (mutation: never draw the phase -> FAILS)", () => {
    const html = render(ready([view(), view({ id: "d2", title: "Roof" })]), { versionPhases: { d1: { kind: "uploading", percent: 45 } } });
    expect(renderedText(rowOf(html, "d1"))).toContain(m["documents.progress.uploading"].replace("{percent}", "45"));
    expect(rowOf(html, "d2")).not.toContain("data-version-progress");
    const checking = render(ready([view()]), { versionPhases: { d1: { kind: "checking" } }, locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(rowOf(checking, "d1"))).toContain(m["documents.progress.checking.es"]);
  });
  it("each trashed file offers Delete forever as a ghost beside Restore; the card still has ONE primary (rule 6, rule 8; mutation: make Delete forever default -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z" })]));
    const trashed = html.slice(html.indexOf('data-document-trashed="t1"'));
    expect(/<button[^>]*data-document-purge[^>]*>/.exec(trashed)![0]).toContain('data-variant="ghost"');
    expect(renderedText(trashed)).toContain(m["documents.deleteForever"]);
    expect(renderedText(trashed)).toContain(m["documents.restore"]);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    const es = render(ready([view()], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z" })]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain(m["documents.deleteForever.es"]);
  });
  it("a file whose Delete forever stopped part-way shows 'Being deleted' as a dot and a word, no Restore, and an Owner keeps Delete forever to finish it (review m1; mutation: ignore purging and draw Restore -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z", purging: true })]));
    const trashed = html.slice(html.indexOf('data-document-trashed="t1"'));
    expect(trashed).not.toContain("data-document-restore");
    expect(trashed).toMatch(/data-document-purging[^>]*><span aria-hidden="true"[^>]*><\/span>/);
    expect(renderedText(trashed)).toContain(m["documents.status.purging"]);
    expect(trashed).toContain("data-document-purge");
    const es = render(ready([view()], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z", purging: true })]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain(m["documents.status.purging.es"]);
    // A trashed file with no purge begun keeps its Restore.
    expect(render(ready([view()], [view({ id: "t2", deletedAt: "2026-10-10T15:00:00.000Z" })]))).toContain("data-document-restore");
  });
  it("Staff and Technicians see the trashed file and Restore, but no Delete forever (owner ruling R1; mutation: draw it for everyone -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z" })]), { canManage: false });
    expect(html).toContain('data-document-trashed="t1"');
    expect(html).toContain("data-document-restore");
    expect(html).not.toContain("data-document-purge");
  });
  it("the space line shows above 80% of the quota only, in both languages, and adds no primary (spec 4.2 item 4; mutation: always draw it -> FAILS)", () => {
    const over = render(ready([view()], [], false, { used: 4_500_000_000, quota: 5 * GIB }));
    expect(over).toContain("data-space-used");
    expect(renderedText(over)).toContain("4.1 of 5 GB used");
    expect(over.match(/data-variant="default"/g)).toHaveLength(1);
    expect(render(ready([view()], [], false, { used: 4 * GIB, quota: 5 * GIB }))).not.toContain("data-space-used");
    expect(render(ready([view()]))).not.toContain("data-space-used");
    const es = render(ready([view()], [], false, { used: 4_500_000_000, quota: 5 * GIB }), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain(m["documents.spaceUsed.es"].replace("{used}", "4.1").replace("{quota}", "5"));
  });
  it("a row's inline edits reach the HANDLERS, never a server action directly (PR 1a review M6; mutation: rowSavers calls updateDocumentFieldAction -> FAILS)", async () => {
    const actions = await import("./documents-actions");
    const h = { saveField: vi.fn(async () => ({ ok: true as const, undoPayload: { documentId: "d1", field: "title" as const, prior: "a", written: "b" }, shown: "b" })),
      undoField: vi.fn(async () => ({ ok: true as const })) };
    const doc = view() as never;
    const s = rowSavers(doc, h);
    await s.save("title")("b");
    await s.undoWith({ p: 1 });
    expect(h.saveField).toHaveBeenCalledWith(doc, "title", "b");
    expect(h.undoField).toHaveBeenCalledWith({ p: 1 });
    expect(actions.updateDocumentFieldAction).not.toHaveBeenCalled();
    expect(actions.undoDocumentFieldAction).not.toHaveBeenCalled();
  });
  it("the new-version toast: success words, or the refusal in the reader's language with its params; nothing mid-way (mutation: drop params -> FAILS)", () => {
    expect(versionToast({ kind: "done" }, "Lease", "en")).toEqual({ ok: true, text: "New version of Lease added." });
    expect(versionToast({ kind: "done" }, "Lease", "es")).toEqual({ ok: true, text: m["documents.versionAdded.es"].replace("{title}", "Lease") });
    expect(versionToast({ kind: "failed", error: "documents.error.tooLarge", params: { size: "31 MB" } }, "Lease", "es"))
      .toEqual({ ok: false, text: m["documents.error.tooLarge.es"].replace("{size}", "31 MB") });
    expect(versionToast({ kind: "uploading", percent: 10 }, "Lease", "en")).toBeNull();
  });
});

describe("keepPurge: the Delete forever target outlives a re-read only while the trash still lists it (final review 1)", () => {
  it("a file gone from the trash is forgotten, so a later re-trash never reopens the dialog by itself (mutation: settle leaves purgeId alone / keepPurge returns its input -> FAILS)", () => {
    const trashed = view({ id: "t1", deletedAt: "2026-10-12T00:00:00.000Z" });
    expect(keepPurge("t1", ready([view()], [trashed]))).toBe("t1");
    expect(keepPurge("t1", ready([view()], []))).toBeNull();
    // Restored elsewhere: live again, not in the trash, so the dialog must not survive to the next trash.
    expect(keepPurge("t1", ready([view({ id: "t1" })], []))).toBeNull();
    expect(keepPurge("t1", { status: "error" })).toBe("t1");
    expect(keepPurge(null, ready([view()], [trashed]))).toBeNull();
  });
});

describe("virus scanning on the card (S-07 2a; spec 3.5; rule 3)", () => {
  const pending = (createdAt: string) => view({ id: "dp", title: "Scan", version: { id: "vp", contentType: "application/pdf", bytes: 10, scan: "pending", createdAt },
    versions: [{ id: "vp", contentType: "application/pdf", bytes: 10, createdAt, addedOn: "2026-10-13", scan: "pending" }] });
  const removed = view({ id: "dx", title: "Bad", version: { id: "vx", contentType: "application/pdf", bytes: 10, scan: "infected", createdAt: "2026-10-13T14:00:00.000Z" },
    versions: [{ id: "vx", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13", scan: "infected" }] });

  it("a Checking row is a warn dot AND the word, in Spanish too; after 15 minutes it adds the slow words; a clean row draws neither (mutations: drop the dot -> FAILS; drop the word -> FAILS)", () => {
    const html = render(ready([view(), pending("2026-10-13T14:59:00.000Z"), { ...pending("2026-10-13T14:30:00.000Z"), id: "ds" }]), { locale: "es" });
    const fresh = rowOf(html, "dp");
    expect(fresh).toContain('data-document-scan="pending"');
    expect(fresh).toContain("bg-[var(--warn)]");
    expect(renderedText(fresh)).toContain(m["documents.status.scanning.es"]);
    expect(renderedText(fresh)).not.toContain(m["documents.status.scanSlow.es"]);
    expect(renderedText(rowOf(html, "ds"))).toContain(`${m["documents.status.scanning.es"]} · ${m["documents.status.scanSlow.es"]}`);
    expect(rowOf(html, "d1")).not.toContain("data-document-scan");
  });

  it("a removed row is a crit dot and 'Removed: it had a virus', and its menu keeps Move to trash but has no Download (mutations: crit -> warn -> FAILS; keep Download -> FAILS)", () => {
    const row = rowOf(render(ready([removed]), { locale: "es" }), "dx");
    expect(row).toContain('data-document-scan="infected"');
    expect(row).toContain("bg-[var(--crit)]");
    expect(renderedText(row)).toContain(m["documents.status.virusRemoved.es"]);
    expect(renderedText(rowOf(render(ready([removed])), "dx"))).toContain(m["documents.status.virusRemoved"]);
    expect(rowMenuItems(removed as never, true).map((i) => i.id)).toEqual(["edit", "ownersOnly", "newVersion", "trash"]);
    expect(rowMenuItems(pending("2026-10-13T14:59:00.000Z") as never, false).map((i) => i.id)).toEqual(["edit", "newVersion", "trash"]);
    expect(rowMenuItems(view() as never, false).map((i) => i.id)).toEqual(["edit", "newVersion", "download", "trash"]);
  });

  it("the card still has exactly ONE primary button with Checking and removed rows on it (rule 8; mutation: a primary 'Retry scan' -> FAILS)", () => {
    const html = render(ready([view(), pending("2026-10-13T14:59:00.000Z"), removed]));
    expect(html.match(/data-variant="default"/g) ?? []).toHaveLength(1);
  });

  it("a password-protected file's row says so as a crit dot and the owner's words, in both languages, never 'Couldn't check this file' (mutation: draw the generic word for locked -> FAILS)", () => {
    const locked = view({ id: "dl", title: "Bank", version: { id: "vl", contentType: "application/pdf", bytes: 10, scan: "locked", createdAt: "2026-10-13T14:00:00.000Z" },
      versions: [{ id: "vl", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13", scan: "locked" }] });
    for (const [locale, sfx] of [["en", ""], ["es", ".es"]] as const) {
      const row = rowOf(render(ready([locked]), { locale }), "dl");
      expect(row).toContain('data-document-scan="locked"');
      expect(row).toContain("bg-[var(--crit)]");
      expect(renderedText(row)).toContain(m[`documents.status.passwordRemoved${sfx}` as keyof typeof m]);
      expect(renderedText(row)).not.toContain(m[`documents.status.unscannable${sfx}` as keyof typeof m]);
    }
    expect(rowMenuItems(locked as never, true).map((i) => i.id)).toEqual(["edit", "ownersOnly", "newVersion", "trash"]);
  });
});

describe("pollTimerKey: the re-read timer's own key (review I1)", () => {
  it("changes on every successive settle even when nextPollMs repeats the exact same number (a constant while the same version stays pending, or a failed read answering the same number again) (mutation: key = String(pollMs) alone, ignoring reads -> FAILS)", () => {
    expect(pollTimerKey(5000, 0)).not.toBe(pollTimerKey(5000, 1));
    expect(pollTimerKey(5000, 1)).not.toBe(pollTimerKey(5000, 2));
    // The slow interval, after two minutes: still a constant across reads, still must change.
    expect(pollTimerKey(30000, 7)).not.toBe(pollTimerKey(30000, 8));
    // A failed read: reads still bumps (DocumentsCard's settle runs on the error branch too), so the
    // key still changes even though nextPollMs would answer the very same 5000 again.
    expect(pollTimerKey(5000, 4)).not.toBe(pollTimerKey(5000, 5));
  });
  it("answers null (no timer) once nothing is left to poll, whatever reads has reached (mutation: return a key for null -> FAILS)", () => {
    expect(pollTimerKey(null, 0)).toBeNull();
    expect(pollTimerKey(null, 9)).toBeNull();
  });
});

describe("Ask the customer on the card (S-07 2b, spec 4.2)", () => {
  const askTag = (html: string) => /<button[^>]*data-ask-customer[^>]*>/.exec(html)?.[0] ?? null;

  it("the header gains a ghost 'Ask the customer' beside Take photo, and the card STILL has exactly one primary, Upload (rule 8; mutation: the new button as default -> FAILS)", () => {
    const html = render(ready([view()]));
    expect(askTag(html)).toContain('data-variant="ghost"');
    expect(html).toMatch(/data-ask-customer[^>]*>Ask the customer</);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="default"[^>]*>Upload</);
    // Beside Take photo, in the header's button row: after the count, before the file list.
    expect(html.indexOf("data-ask-customer")).toBeLessThan(html.indexOf("data-take-photo"));
    expect(html.indexOf("data-ask-customer")).toBeLessThan(html.indexOf("data-document-row"));
    expect(renderedText(render(ready([view()]), { locale: "es", emptyText: m["documents.empty.contact.es"] }))).toContain("Pedir al cliente");
  });

  it("is not drawn while the upload panel is open (the panel's Upload is the one primary), nor before the requests read is ready (the dialog needs its channels)", () => {
    expect(askTag(render(ready([view()]), { panel: createElement("div", { "data-documents-panel": "" }) }))).toBeNull();
    expect(askTag(render(ready([view()]), { requests: slot({ kind: "loading" }) }))).toBeNull();
    expect(askTag(render(ready([view()]), { requests: slot({ kind: "error" }) }))).toBeNull();
  });

  it("the open requests sit after the file list and before the trash (mutation: never draw them -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z" })]), { requests: slot(requestsReady([openRequest])) });
    const at = html.indexOf("data-document-requests");
    expect(at).toBeGreaterThan(html.indexOf('data-document-row="d1"'));
    expect(at).toBeLessThan(html.indexOf("data-documents-trash"));
    expect(renderedText(html)).toContain("Asked for");
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
  });

  it("a failed requests read is its own alert and never blanks the files (spec 6, rule 5; mutation: the files' error state for it -> FAILS)", () => {
    const html = render(ready([view()]), { requests: slot({ kind: "error" }) });
    expect(html).toContain('data-document-row="d1"');
    expect(renderedText(html)).toContain(m["documents.requests.loadFailed"]);
    expect(renderedText(html)).not.toContain(m["documents.loadFailed"]);
    expect(html).not.toContain("data-record-error");
  });

  it("a customer's file reads 'Sent by the customer · <when>', never 'Added by …', in both languages (mutation: the staff line for a customer file -> FAILS)", () => {
    const sent = view({ source: "customer", addedBy: { you: false, name: null } });
    const html = render(ready([sent]));
    expect(renderedText(html)).toContain("Sent by the customer · 3 days ago");
    expect(renderedText(html)).not.toContain("Added by");
    const es = render(ready([sent]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain("Enviado por el cliente · hace 3 días");
    expect(sourceLine(sent as never, "2026-10-13", "en")).toBe("Sent by the customer · 3 days ago");
  });
});

describe("shouldReloadRequests: the files' poll keeps the open requests honest (review I2)", () => {
  const scanned = (id: string, scan: string, over: Record<string, unknown> = {}) =>
    view({ id, source: "customer", version: { id: `v-${id}`, contentType: "application/pdf", bytes: 1, scan, createdAt: "2026-10-13T14:00:00.000Z" }, ...over });
  const open = requestsReady([openRequest]);

  it("a file's scan state changing while a request is open re-reads the requests (mutation: never reload -> FAILS)", () => {
    expect(shouldReloadRequests(ready([scanned("d1", "pending")]), ready([scanned("d1", "clean")]), open)).toBe(true);
    expect(shouldReloadRequests(ready([scanned("d1", "pending")]), ready([scanned("d1", "infected")]), open)).toBe(true);
  });

  it("the same read again does not: a re-read the reload itself caused can never trigger another (no loop; mutation: answer true whenever a request is open -> FAILS)", () => {
    expect(shouldReloadRequests(ready([scanned("d1", "clean")]), ready([scanned("d1", "clean")]), open)).toBe(false);
    expect(shouldReloadRequests(ready([scanned("d1", "pending")]), ready([scanned("d1", "pending")]), open)).toBe(false);
  });

  it("a customer's file new to this read does; a staff upload new to it does not", () => {
    expect(shouldReloadRequests(ready([]), ready([scanned("d9", "pending")]), open)).toBe(true);
    expect(shouldReloadRequests(ready([]), ready([scanned("d9", "pending", { source: "upload" })]), open)).toBe(false);
  });

  it("nothing open, or the requests not read yet or failed: no re-read (mutation: drop the open-request guard -> FAILS)", () => {
    const prev = ready([scanned("d1", "pending")]);
    const next = ready([scanned("d1", "clean")]);
    expect(shouldReloadRequests(prev, next, requestsReady([]))).toBe(false);
    expect(shouldReloadRequests(prev, next, { kind: "loading" })).toBe(false);
    expect(shouldReloadRequests(prev, next, { kind: "error" })).toBe(false);
  });

  it("no ready read to compare with (the first read, or a failed one) is no change", () => {
    expect(shouldReloadRequests(null, ready([scanned("d1", "clean")]), open)).toBe(false);
    expect(shouldReloadRequests(ready([scanned("d1", "pending")]), { status: "error" }, open)).toBe(false);
  });

  it("another record's read is not a change on this one", () => {
    const other = { status: "ready", data: { ...(ready([scanned("d1", "clean")]) as { data: object }).data, record: { kind: "contact", id: "c2" } } } as Load;
    expect(shouldReloadRequests(ready([scanned("d1", "pending")]), other, open)).toBe(false);
  });
});

describe("askAfter: what the dialog does once the handler answers (review M1)", () => {
  it("a request created closes it; a refusal keeps it open with the refusal's words (mutation: close on a refusal -> FAILS)", () => {
    expect(askAfter(null)).toEqual({ open: false, error: null });
    expect(askAfter("documents.request.textOff")).toEqual({ open: true, error: "documents.request.textOff" });
  });
});

describe("keepRequests: a failed re-read keeps what the list shows (review M2)", () => {
  const R = "/api/accounts/acc/contacts/c1/document-requests";
  it("an error over this route's ready list keeps the list; a first read's error, or another route's, shows the error (mutation: always take the new load -> FAILS)", () => {
    const shown = { route: R, load: requestsReady([openRequest]) };
    expect(keepRequests(shown, R, { kind: "error" })).toBe(shown);
    expect(keepRequests({ route: "", load: { kind: "loading" } }, R, { kind: "error" })).toEqual({ route: R, load: { kind: "error" } });
    expect(keepRequests({ route: "/other", load: requestsReady([openRequest]) }, R, { kind: "error" })).toEqual({ route: R, load: { kind: "error" } });
    const fresh = requestsReady([]);
    expect(keepRequests(shown, R, fresh)).toEqual({ route: R, load: fresh });
  });
});

describe("requestsPollMs: the open requests' own 20s check (S-07 2b follow-up, owner ruling 2026-10-16)", () => {
  const open = requestsReady([openRequest]);
  it("an open request on a visible tab checks every 20 seconds", () => {
    expect(REQUESTS_POLL_MS).toBe(20_000);
    expect(requestsPollMs(open, false)).toBe(20_000);
  });
  it("a hidden tab schedules nothing (mutation: ignore hidden -> FAILS)", () => {
    expect(requestsPollMs(open, true)).toBeNull();
  });
  it("nothing open schedules nothing (mutation: poll with no open request -> FAILS)", () => {
    expect(requestsPollMs(requestsReady([]), false)).toBeNull();
  });
  it("a read still loading, or failed, schedules nothing (mutation: poll whatever the read's kind -> FAILS)", () => {
    expect(requestsPollMs({ kind: "loading" }, false)).toBeNull();
    expect(requestsPollMs({ kind: "error" }, false)).toBeNull();
  });
  it("its timer key re-arms on every settle, like the files' (mutation: a key that ignores the reads counter -> FAILS)", () => {
    const ms = requestsPollMs(open, false);
    expect(pollTimerKey(ms, 3)).not.toBe(pollTimerKey(ms, 4));
    expect(pollTimerKey(requestsPollMs(open, true), 3)).toBeNull();
  });
});

describe("requestsChanged: did a customer's file arrive between two requests reads (S-07 2b follow-up)", () => {
  const req = (over: Record<string, unknown> = {}, answered = false) => ({ ...openRequest,
    items: [{ key: "insurance", category: "insurance", note: null, answered }, { key: "other", category: "other", note: "Pool permit", answered: false }], ...over });
  const at = (now: string, requests: unknown[]) =>
    ({ kind: "ready", data: { now, channels: { text: true, email: true }, requests } } as RequestsLoad);
  const T1 = "2026-10-13T15:00:00.000Z";
  const T2 = "2026-10-13T15:00:20.000Z";

  it("the same read twice is no change, so a refresh (or the files' re-read it causes) can never cause another (mutation: always true -> FAILS)", () => {
    expect(requestsChanged(at(T1, [req()]), at(T1, [req()]))).toBe(false);
    expect(requestsChanged(at(T1, [req({}, true)]), at(T1, [req({}, true)]))).toBe(false);
    expect(requestsChanged(at(T1, []), at(T1, []))).toBe(false);
  });
  it("only the clock moving (now, and with it the days-left words) is no change (mutation: compare the whole read -> FAILS)", () => {
    expect(requestsChanged(at(T1, [req()]), at("2026-10-14T15:00:00.000Z", [req()]))).toBe(false);
    expect(requestsChanged(at(T1, [req()]), at(T2, [req()]))).toBe(false);
  });
  it("an item answered is a change (mutation: ignore answered -> FAILS)", () => {
    expect(requestsChanged(at(T1, [req()]), at(T2, [req({}, true)]))).toBe(true);
  });
  it("a request that completed, or was revoked, leaves the open list: a change (mutation: only compare requests present in both -> FAILS)", () => {
    expect(requestsChanged(at(T1, [req()]), at(T2, []))).toBe(true);
    expect(requestsChanged(at(T1, [req(), req({ id: "r2" })]), at(T2, [req({ id: "r2" })]))).toBe(true);
  });
  it("a NEW request is not a file arriving: no refresh (staff's own Ask already re-reads)", () => {
    expect(requestsChanged(at(T1, []), at(T2, [req()]))).toBe(false);
  });
  it("no ready read on either side is no change: the first read, a failed tick, a Retry's skeleton", () => {
    expect(requestsChanged({ kind: "loading" }, at(T1, [req()]))).toBe(false);
    expect(requestsChanged(at(T1, [req()]), { kind: "error" })).toBe(false);
    expect(requestsChanged({ kind: "error" }, at(T1, []))).toBe(false);
  });
});

describe("the required documents on the card (S-07 2c, spec 5.4; D3, D9, I6)", () => {
  type Checklist = NonNullable<Props["checklist"]>;
  const reqs = (items: [string, string][]) =>
    ({ kind: "ready", data: { items: items.map(([category, state]) => ({ category, state })) } } as Checklist["load"]);
  const PARTIAL = reqs([["insurance", "met"], ["id", "missing"], ["permit", "missing"]]);
  const checklist = (load: Checklist["load"] = PARTIAL): Checklist =>
    ({ load, canSkip: true, canAsk: true, onAsk: vi.fn(), onSkip: vi.fn(), onUnskip: vi.fn(), onRetry: vi.fn() });

  it("D9: 'Required 1 of 3' sits in the card's TOP ROW with the file count, before the header's buttons and before the checklist, in both languages (mutation: render the meter inside the checklist section -> FAILS by position)", () => {
    const html = render(ready([view(), view({ id: "d2" })]), { checklist: checklist() });
    const count = html.indexOf(">2 files<");
    const meter = html.indexOf("data-requirements-meter");
    expect(count).toBeGreaterThan(0);
    expect(meter).toBeGreaterThan(count);
    expect(meter).toBeLessThan(html.indexOf("data-ask-customer"));
    expect(meter).toBeLessThan(html.indexOf("data-document-checklist"));
    const top = renderedText(html.slice(meter, html.indexOf("data-ask-customer"))).replace(/\s+/g, " ");
    expect(top).toContain("Required");
    expect(top).toContain("1 of 3");
    const es = render(ready([view(), view({ id: "d2" })]), { checklist: checklist(), locale: "es", emptyText: m["documents.empty.contact.es"] });
    const esMeter = es.indexOf("data-requirements-meter");
    expect(esMeter).toBeLessThan(es.indexOf("data-document-checklist"));
    const esTop = renderedText(es.slice(esMeter, es.indexOf("data-ask-customer"))).replace(/\s+/g, " ");
    expect(esTop).toContain("Requeridos");
    expect(esTop).toContain("1 de 3");
  });

  it("the checklist sits under the top row, before the file list; the card STILL has exactly one primary, Upload (rule 8; mutation: the checklist's Upload as default -> FAILS)", () => {
    const html = render(ready([view()]), { checklist: checklist() });
    expect(html.indexOf("data-document-checklist")).toBeLessThan(html.indexOf("data-document-row"));
    expect(html).toContain('data-checklist-action="upload"');
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="default"[^>]*>Upload</);
  });

  it("I6: with the upload panel open, the checklist draws no Upload and no Ask the customer, and the header draws neither (mutation: pass panelOpen={false} always -> FAILS)", () => {
    const html = render(ready([view()]), { checklist: checklist(), panel: createElement("div", { "data-documents-panel": "" }) });
    expect(html).toContain("data-document-checklist");
    expect(html).not.toContain('data-checklist-action="upload"');
    expect(html).not.toContain('data-checklist-action="ask"');
    expect(html).not.toContain("data-ask-customer");
    expect(html).not.toContain('data-variant="default"');
  });

  it("D3: without a checklist slot (a household's card, and every card before 2c) there is neither checklist nor meter (mutation: draw them unconditionally -> FAILS)", () => {
    const html = render(ready([view()]));
    expect(html).not.toContain("data-document-checklist");
    expect(html).not.toContain("data-requirements-meter");
  });

  it("while the files read is loading or failed, neither the checklist nor the meter is drawn (the files' state alone, rule 5)", () => {
    for (const load of [{ status: "loading" }, { status: "error" }] as Load[]) {
      const html = render(load, { checklist: checklist() });
      expect(html).not.toContain("data-document-checklist");
      expect(html).not.toContain("data-requirements-meter");
    }
  });

  it("panelFiles: a gap's Upload files every chosen file under its category; with no preset, each type's default (mutation: ignore the preset -> FAILS)", () => {
    const pdf = new File([new Uint8Array(1)], "lease.pdf", { type: "application/pdf" });
    const jpg = new File([new Uint8Array(1)], "roof.jpg", { type: "image/jpeg" });
    const preset = panelFiles([pdf, jpg], "insurance", "en");
    expect(preset.map((f) => f.category)).toEqual(["insurance", "insurance"]);
    expect(preset.map((f) => f.title)).toEqual(["lease", "roof"]);
    expect(preset.map((f) => f.phase)).toEqual([null, null]);
    expect(new Set(preset.map((f) => f.key)).size).toBe(2);
    expect(panelFiles([pdf, jpg], null, "en").map((f) => f.category)).toEqual(["other", "photo"]);
  });
});
