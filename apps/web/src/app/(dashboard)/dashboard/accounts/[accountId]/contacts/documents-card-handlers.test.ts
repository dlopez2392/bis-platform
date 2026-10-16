import { describe, it, expect, vi, beforeEach } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(), purgeDocumentAction: vi.fn(),
}));
vi.mock("./documents-actions", () => actions);
const requestActions = vi.hoisted(() => ({
  createDocumentRequestAction: vi.fn(), documentRequestLinkAction: vi.fn(), revokeDocumentRequestAction: vi.fn(), undoRevokeDocumentRequestAction: vi.fn(),
}));
vi.mock("./document-requests-actions", () => requestActions);
const { documentHandlers } = await import("./documents-card-handlers");
const { m } = await import("@/lib/messages");

const DOC = {
  id: "d1", title: "Lease", category: "contract" as const, expiresOn: null, ownersOnly: false, source: "upload" as const,
  addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf" as const, bytes: 1, scan: "clean" as const, createdAt: "2026-10-01T00:00:00Z" },
  versions: [{ id: "v1", contentType: "application/pdf" as const, bytes: 1, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", scan: "clean" as const }], purging: false,
};
const undoOf = () => (toast.success.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } }).action;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe("trash, restore and Owners only run at once with an Undo (rule 6)", () => {
  it("Move to trash toasts with Undo; Undo restores against the instant the trash wrote (mutation: undo passes the row's old deletedAt -> FAILS)", async () => {
    const reload = vi.fn();
    actions.trashDocumentAction.mockResolvedValue({ ok: true, deletedAt: "2026-10-13T15:00:00.1+00:00" });
    actions.restoreDocumentAction.mockResolvedValue({ ok: true });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() });
    await h.trash(DOC);
    expect(actions.trashDocumentAction).toHaveBeenCalledWith("acc", "d1");
    expect(toast.success.mock.calls[0]![0]).toBe("Lease moved to the trash.");
    expect(undoOf().label).toBe(m["common.undo"]);
    undoOf().onClick();
    await flush();
    expect(actions.restoreDocumentAction).toHaveBeenCalledWith("acc", "d1", "2026-10-13T15:00:00.1+00:00");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("an Undo that lost the race says so, in the reader's language (mutation: swallow the undo error -> FAILS)", async () => {
    actions.trashDocumentAction.mockResolvedValue({ ok: true, deletedAt: "x" });
    actions.restoreDocumentAction.mockResolvedValue({ ok: false, error: "documents.undoChanged" });
    const reload = vi.fn();
    const h = documentHandlers({ accountId: "acc", locale: "es", reload, reloadRequests: vi.fn() });
    await h.trash(DOC);
    expect(toast.success.mock.calls[0]![0]).toBe(m["documents.trashed.es"].replace("{title}", "Lease"));
    expect(undoOf().label).toBe(m["common.undo.es"]);
    undoOf().onClick();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["documents.undoChanged.es"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a trash the server refused says why and offers no Undo (mutation: toast success before checking ok -> FAILS)", async () => {
    actions.trashDocumentAction.mockResolvedValue({ ok: false, error: "documents.error.refused" });
    const reload = vi.fn();
    const h = documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() });
    await h.trash(DOC);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.refused"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a trash that threw (a stale tab after a redeploy) is a plain failure, never a silent one (mutation: drop the .catch -> FAILS)", async () => {
    actions.trashDocumentAction.mockRejectedValue(new Error("gone"));
    const h = documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn(), reloadRequests: vi.fn() });
    await h.trash(DOC);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.failed.es"]);
  });

  it("Restore from the trash toasts with an Undo that trashes again (mutation: no Undo on restore -> FAILS)", async () => {
    actions.restoreDocumentAction.mockResolvedValue({ ok: true });
    actions.trashDocumentAction.mockResolvedValue({ ok: true, deletedAt: "y" });
    const reload = vi.fn();
    const h = documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() });
    await h.restore({ ...DOC, deletedAt: "2026-10-10T00:00:00Z" });
    expect(actions.restoreDocumentAction).toHaveBeenCalledWith("acc", "d1", "2026-10-10T00:00:00Z");
    expect(toast.success.mock.calls[0]![0]).toBe("Lease is back.");
    undoOf().onClick();
    await flush();
    expect(actions.trashDocumentAction).toHaveBeenCalledWith("acc", "d1");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("a Restore someone beat says it could not, and re-reads so the card shows the truth (mutation: no reload on a lost restore -> FAILS)", async () => {
    actions.restoreDocumentAction.mockResolvedValue({ ok: false, error: "documents.undoChanged" });
    const reload = vi.fn();
    const h = documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() });
    await h.restore({ ...DOC, deletedAt: "2026-10-10T00:00:00Z" });
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.failed"]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Owners only: the Undo is a compare-and-set of prior against written (mutation: undo calls setOwnersOnlyAction(prior) blind -> FAILS)", async () => {
    actions.setOwnersOnlyAction.mockResolvedValue({ ok: true, prior: false });
    actions.undoOwnersOnlyAction.mockResolvedValue({ ok: true });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), reloadRequests: vi.fn() });
    await h.setOwnersOnly(DOC, true);
    expect(actions.setOwnersOnlyAction).toHaveBeenCalledWith("acc", "d1", true);
    expect(toast.success.mock.calls[0]![0]).toBe("Lease is now Owners only.");
    undoOf().onClick();
    await flush();
    expect(actions.undoOwnersOnlyAction).toHaveBeenCalledWith("acc", "d1", false, true);
    expect(actions.setOwnersOnlyAction).toHaveBeenCalledTimes(1);
  });

  it("an Owners-only change the server refused says why and offers no Undo (mutation: delete the !r.ok guard in setOwnersOnly -> FAILS)", async () => {
    actions.setOwnersOnlyAction.mockResolvedValue({ ok: false, error: "documents.error.ownersOnlyRole" });
    const reload = vi.fn();
    const h = documentHandlers({ accountId: "acc", locale: "es", reload, reloadRequests: vi.fn() });
    await h.setOwnersOnly(DOC, true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.ownersOnlyRole.es"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("letting the team see it again says so in its own words (mutation: always the Owners-only sentence -> FAILS)", async () => {
    actions.setOwnersOnlyAction.mockResolvedValue({ ok: true, prior: true });
    const h = documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn(), reloadRequests: vi.fn() });
    await h.setOwnersOnly({ ...DOC, ownersOnly: true }, false);
    expect(toast.success.mock.calls[0]![0]).toBe(m["documents.madeTeam.es"].replace("{title}", "Lease"));
  });

  it("a second click while a write is in flight does nothing (mutation: drop the inFlight guard -> FAILS)", async () => {
    let release!: (v: unknown) => void;
    actions.trashDocumentAction.mockReturnValue(new Promise((r) => { release = r; }));
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), reloadRequests: vi.fn() });
    const first = h.trash(DOC);
    const second = h.trash(DOC);
    release({ ok: true, deletedAt: "z" });
    await Promise.all([first, second]);
    expect(actions.trashDocumentAction).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});

describe("Download", () => {
  it("a file the reader can no longer see says so in the reader's language and goes nowhere (mutation: ignore ok -> FAILS)", async () => {
    actions.getDocumentUrlAction.mockResolvedValue({ ok: false, error: "documents.error.fileNotFound" });
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    try {
      const h = documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn(), reloadRequests: vi.fn() });
      await h.download(DOC);
      expect(actions.getDocumentUrlAction).toHaveBeenCalledWith("acc", "v1", "download");
      expect(toast.error).toHaveBeenCalledWith(m["documents.error.fileNotFound.es"]);
      expect(assign).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a minted URL is followed (mutation: never navigate -> FAILS)", async () => {
    actions.getDocumentUrlAction.mockResolvedValue({ ok: true, url: "https://files.example/x", contentType: "application/pdf" });
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    try {
      const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), reloadRequests: vi.fn() });
      await h.download(DOC);
      expect(assign).toHaveBeenCalledWith("https://files.example/x");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("inline edits go through the handlers (PR 1a review M6: the styleguide injects inert ones)", () => {
  it("a save answers InlineField's shape and re-reads the card; its Undo payload is the server's own (mutation: drop reload on success -> FAILS)", async () => {
    const reload = vi.fn();
    const undoPayload = { documentId: "d1", field: "title", prior: "Lease", written: "New lease" };
    actions.updateDocumentFieldAction.mockResolvedValue({ ok: true, shown: "New lease", undoPayload });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() });
    expect(await h.saveField(DOC, "title", "New lease")).toEqual({ ok: true, undoPayload, shown: "New lease" });
    expect(actions.updateDocumentFieldAction).toHaveBeenCalledWith("acc", "d1", "title", "New lease");
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("a refused save is the reader's own words, with its params, and re-reads nothing (mutation: answer the raw key -> FAILS)", async () => {
    const reload = vi.fn();
    actions.updateDocumentFieldAction.mockResolvedValue({ ok: false, error: "documents.error.tooLarge", params: { size: "31 MB" } });
    const h = documentHandlers({ accountId: "acc", locale: "es", reload, reloadRequests: vi.fn() });
    expect(await h.saveField(DOC, "title", "x")).toEqual({ ok: false, error: m["documents.error.tooLarge.es"].replace("{size}", "31 MB") });
    expect(reload).not.toHaveBeenCalled();
  });
  it("an Undo someone beat says so in the reader's language (mutation: swallow the error -> FAILS)", async () => {
    actions.undoDocumentFieldAction.mockResolvedValue({ ok: false, error: "documents.undoChanged" });
    const h = documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn(), reloadRequests: vi.fn() });
    expect(await h.undoField({ any: "payload" })).toEqual({ ok: false, error: m["documents.undoChanged.es"] });
    expect(actions.undoDocumentFieldAction).toHaveBeenCalledWith("acc", { any: "payload" });
  });
  it("a save that throws (a stale tab) is the plain failure, never a crash (mutation: drop the .catch -> FAILS)", async () => {
    actions.updateDocumentFieldAction.mockRejectedValue(new Error("stale"));
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), reloadRequests: vi.fn() });
    expect(await h.saveField(DOC, "title", "x")).toEqual({ ok: false, error: m["documents.error.failed"] });
  });
});

describe("Delete forever (spec 4.4; rule 6)", () => {
  it("gone for good: a plain success toast with NO Undo, a re-read, and true so the dialog closes (mutation: offer an Undo -> FAILS)", async () => {
    const reload = vi.fn();
    actions.purgeDocumentAction.mockResolvedValue({ ok: true });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() });
    expect(await h.purge(DOC, "Lease")).toBe(true);
    expect(actions.purgeDocumentAction).toHaveBeenCalledWith("acc", "d1", "Lease");
    expect(toast.success.mock.calls).toEqual([["Lease was deleted for good."]]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("Spanish success words are the Spanish catalogue's (mutation: an English toast in es -> FAILS)", async () => {
    actions.purgeDocumentAction.mockResolvedValue({ ok: true });
    await documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn(), reloadRequests: vi.fn() }).purge(DOC, "Lease");
    expect(toast.success.mock.calls).toEqual([[m["documents.purged.es"].replace("{title}", "Lease")]]);
  });
  it("a server mismatch means the title changed underneath (the button only enables on the card's own title): it says why, re-reads, and closes (review I2; mutation: no reload on a mismatch -> FAILS)", async () => {
    const reload = vi.fn();
    actions.purgeDocumentAction.mockResolvedValue({ ok: false, error: "documents.purge.mismatch" });
    expect(await documentHandlers({ accountId: "acc", locale: "es", reload, reloadRequests: vi.fn() }).purge(DOC, "Lease")).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.purge.mismatch.es"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("any refusal (changed, in flight, not an Owner) says so, re-reads and closes, never a silent no-op (review I2; mutation: return false on a refusal -> FAILS)", async () => {
    const reload = vi.fn();
    actions.purgeDocumentAction.mockResolvedValue({ ok: false, error: "documents.error.purgeChanged" });
    expect(await documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() }).purge(DOC, "Lease")).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.purgeChanged"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("a second click while the purge is in flight sends nothing and keeps the dialog (mutation: drop the once() guard -> FAILS)", async () => {
    let finish!: (v: { ok: true }) => void;
    actions.purgeDocumentAction.mockReturnValue(new Promise((r) => { finish = r; }));
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), reloadRequests: vi.fn(), inFlight: new Set() });
    const first = h.purge(DOC, "Lease");
    expect(await h.purge(DOC, "Lease")).toBe(false);
    finish({ ok: true });
    expect(await first).toBe(true);
    expect(actions.purgeDocumentAction).toHaveBeenCalledTimes(1);
  });
  it("a purge that throws is the purge failure, in words (mutation: drop the .catch -> FAILS)", async () => {
    actions.purgeDocumentAction.mockRejectedValue(new Error("stale"));
    const reload = vi.fn();
    expect(await documentHandlers({ accountId: "acc", locale: "en", reload, reloadRequests: vi.fn() }).purge(DOC, "Lease")).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.purge"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("Download of an older version (spec 4.3)", () => {
  it("mints the named version, not the current one (mutation: ignore versionId -> FAILS)", async () => {
    actions.getDocumentUrlAction.mockResolvedValue({ ok: true, url: "https://files.example/old", contentType: "application/pdf" });
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    try {
      await documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), reloadRequests: vi.fn() }).download(DOC, "v0");
      expect(actions.getDocumentUrlAction).toHaveBeenCalledWith("acc", "v0", "download");
      expect(assign).toHaveBeenCalledWith("https://files.example/old");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Ask the customer, Copy link and Revoke (S-07 2b, spec 4.2; rule 6)", () => {
  const RECORD = { kind: "contact" as const, id: "c1" };
  const ITEMS = [{ key: "insurance" as const, category: "insurance" as const, note: null }];
  const URL = "https://app.example/d/tok";
  const created = (delivery: unknown) => ({ ok: true, requestId: "r1", url: URL, delivery });
  const withClipboard = async (writeText: ReturnType<typeof vi.fn> | null, run: () => Promise<unknown>) => {
    vi.stubGlobal("navigator", writeText ? { clipboard: { writeText } } : {});
    try { await run(); } finally { vi.unstubAllGlobals(); }
  };
  const handlers = (locale: "en" | "es" = "en") => {
    const reload = vi.fn();
    const reloadRequests = vi.fn();
    return { reload, reloadRequests, h: documentHandlers({ accountId: "acc", locale, reload, reloadRequests }) };
  };

  it("a link answer copies the URL and says it works for 7 days; the requests list re-reads once, the files never (mutation: no clipboard write -> FAILS)", async () => {
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "link" }));
    const writeText = vi.fn(async () => {});
    const { h, reload, reloadRequests } = handlers();
    await withClipboard(writeText, async () => {
      expect(await h.askCustomer({ record: RECORD, items: ITEMS, channel: "link" })).toBeNull();
    });
    expect(requestActions.createDocumentRequestAction).toHaveBeenCalledWith("acc", { record: RECORD, items: ITEMS, channel: "link" });
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(toast.success).toHaveBeenCalledWith("Link copied. It works for 7 days.");
    expect(reloadRequests).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("a refused clipboard puts the URL itself in a toast that stays (billing-card's pattern; mutation: a generic failure with no URL -> FAILS)", async () => {
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "link" }));
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    const { h, reloadRequests } = handlers("es");
    await withClipboard(writeText, () => h.askCustomer({ record: RECORD, items: ITEMS, channel: "link" }));
    expect(toast.error).toHaveBeenCalledWith(m["documents.request.copyFailed.es"], { description: URL, duration: Infinity, closeButton: true });
    expect(toast.success).not.toHaveBeenCalled();
    expect(reloadRequests).toHaveBeenCalledTimes(1);
    // No clipboard at all (a non-secure origin) is the same toast.
    vi.clearAllMocks();
    await withClipboard(null, () => h.askCustomer({ record: RECORD, items: ITEMS, channel: "link" }));
    expect(toast.error).toHaveBeenCalledWith(m["documents.request.copyFailed.es"], { description: URL, duration: Infinity, closeButton: true });
  });

  it("sent by text and by email say which, in the reader's language; nothing is copied", async () => {
    const writeText = vi.fn(async () => {});
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "sent" }));
    const { h, reloadRequests } = handlers();
    await withClipboard(writeText, async () => {
      await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" });
      await h.askCustomer({ record: RECORD, items: ITEMS, channel: "email" });
    });
    expect(toast.success.mock.calls).toEqual([["Request sent by text."], ["Request sent by email."]]);
    expect(writeText).not.toHaveBeenCalled();
    expect(reloadRequests).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
    await handlers("es").h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" });
    expect(toast.success).toHaveBeenCalledWith("Pedido enviado por mensaje de texto.");
  });

  it("held: the time it goes out, in the zone the answer names, never the browser's or UTC (mutation: drop timeZone -> FAILS)", async () => {
    // ONE instant, two zones, two different times: dropping timeZone would read both in the machine's own
    // zone and say the same time twice, whatever zone the machine is in (this one is in Chicago, where
    // a single Chicago case passed with timeZone dropped). 13:00Z is 8:00 AM in Chicago (CDT), 6:00 AM in Los Angeles (PDT).
    const until = "2026-10-15T13:00:00.000Z";
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "held", until, zone: "America/Chicago" }));
    const { h, reloadRequests } = handlers();
    expect(await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" })).toBeNull();
    expect(toast.success.mock.calls[0]![0]).toMatch(/^Request saved\. It goes out at 8:00\sAM, after quiet hours\.$/);
    expect(reloadRequests).toHaveBeenCalledTimes(1);
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "held", until, zone: "America/Los_Angeles" }));
    await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" });
    expect(toast.success.mock.calls[1]![0]).toMatch(/^Request saved\. It goes out at 6:00\sAM, after quiet hours\.$/);
    vi.clearAllMocks();
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "held", until, zone: "America/Chicago" }));
    await handlers("es").h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" });
    expect(toast.success.mock.calls[0]![0]).toMatch(/^Pedido guardado\. Sale a las 8:00\sa\.\s?m\., después del horario de descanso\.$/);
  });

  it("blocked: saved but not sent, with the reason's words; a failed delivery says it couldn't be delivered (mutation: show the raw reason key -> FAILS)", async () => {
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "blocked", reason: "documents.request.reason.textsStopped" }));
    const { h, reloadRequests } = handlers();
    expect(await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" })).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Request saved, but not sent: they asked not to get texts. Copy the link instead.");
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "failed" }));
    await h.askCustomer({ record: RECORD, items: ITEMS, channel: "email" });
    expect(toast.error).toHaveBeenLastCalledWith("Request saved, but not sent: it couldn't be delivered. Copy the link instead.");
    expect(reloadRequests).toHaveBeenCalledTimes(2);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a refusal answers the action's key for the dialog to show, toasts nothing, and still re-reads the requests (fresh channels) once", async () => {
    requestActions.createDocumentRequestAction.mockResolvedValue({ ok: false, error: "documents.request.textOff" });
    const { h, reloadRequests } = handlers();
    expect(await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" })).toBe("documents.request.textOff");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(reloadRequests).toHaveBeenCalledTimes(1);
  });

  it("Revoke runs at once and offers Undo, whose action restores against the instant the revoke answered (rule 6; mutation: undo with new Date() -> FAILS)", async () => {
    requestActions.revokeDocumentRequestAction.mockResolvedValue({ ok: true, revokedAt: "2026-10-15T15:00:00.123456+00:00" });
    requestActions.undoRevokeDocumentRequestAction.mockResolvedValue({ ok: true });
    const { h, reload, reloadRequests } = handlers();
    await h.revokeRequest("r1");
    expect(requestActions.revokeDocumentRequestAction).toHaveBeenCalledWith("acc", "r1");
    expect(toast.success.mock.calls[0]![0]).toBe("Request revoked.");
    expect(undoOf().label).toBe(m["common.undo"]);
    expect(reloadRequests).toHaveBeenCalledTimes(1);
    undoOf().onClick();
    await flush();
    expect(requestActions.undoRevokeDocumentRequestAction).toHaveBeenCalledWith("acc", "r1", "2026-10-15T15:00:00.123456+00:00");
    expect(reloadRequests).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("a refused Revoke says why in the reader's language, offers no Undo, and re-reads the list (mutation: toast success before ok -> FAILS)", async () => {
    // The action's real answer for a request that is over (Task 7 fix round, e20c0de7).
    requestActions.revokeDocumentRequestAction.mockResolvedValue({ ok: false, error: "documents.request.notOpen" });
    const { h, reloadRequests } = handlers("es");
    await h.revokeRequest("r1");
    expect(toast.error).toHaveBeenCalledWith("Este pedido ya no está abierto.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(reloadRequests).toHaveBeenCalledTimes(1);
  });

  it("an Undo someone beat says so (mutation: swallow the undo error -> FAILS)", async () => {
    requestActions.revokeDocumentRequestAction.mockResolvedValue({ ok: true, revokedAt: "t" });
    requestActions.undoRevokeDocumentRequestAction.mockResolvedValue({ ok: false, error: "documents.error.refused" });
    const { h } = handlers();
    await h.revokeRequest("r1");
    undoOf().onClick();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.refused"]);
  });

  it("a second Revoke while the first is in flight sends nothing (mutation: drop once() -> FAILS)", async () => {
    let release!: (v: unknown) => void;
    requestActions.revokeDocumentRequestAction.mockReturnValue(new Promise((r) => { release = r; }));
    const { h } = handlers();
    const first = h.revokeRequest("r1");
    const second = h.revokeRequest("r1");
    release({ ok: true, revokedAt: "t" });
    await Promise.all([first, second]);
    expect(requestActions.revokeDocumentRequestAction).toHaveBeenCalledTimes(1);
  });

  it("Copy link mints the request's link and copies it (mutation: copy without asking the server -> FAILS)", async () => {
    requestActions.documentRequestLinkAction.mockResolvedValue({ ok: true, url: URL });
    const writeText = vi.fn(async () => {});
    const { h } = handlers();
    await withClipboard(writeText, () => h.copyRequestLink("r1"));
    expect(requestActions.documentRequestLinkAction).toHaveBeenCalledWith("acc", "r1");
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(toast.success).toHaveBeenCalledWith("Link copied. It works for 7 days.");
  });

  it("Copy link on a request that closed says why, copies nothing, and re-reads the list", async () => {
    requestActions.documentRequestLinkAction.mockResolvedValue({ ok: false, error: "documents.request.notOpen" });
    const writeText = vi.fn(async () => {});
    const { h, reloadRequests } = handlers("es");
    await withClipboard(writeText, () => h.copyRequestLink("r1"));
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Este pedido ya no está abierto.");
    expect(reloadRequests).toHaveBeenCalledTimes(1);
  });

  it("a request created whose held time cannot be put in its zone still says it was saved, never 'couldn't create' (review M5; mutation: no fallback -> FAILS)", async () => {
    requestActions.createDocumentRequestAction.mockResolvedValue(created({ kind: "held", until: "2026-10-15T13:00:00.000Z", zone: "Not/AZone" }));
    const { h, reloadRequests } = handlers();
    expect(await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" })).toBeNull();
    expect(toast.success.mock.calls[0]![0]).toMatch(/^Request saved\. It goes out at \d{1,2}:\d{2}\s[AP]M, after quiet hours\.$/);
    expect(toast.error).not.toHaveBeenCalled();
    expect(reloadRequests).toHaveBeenCalledTimes(1);
  });

  it("an action that threw or never answered may still have created the request: it says the page may be out of date, never 'couldn't create', and the dialog closes onto the re-read list (review M5; mutation: answer documents.request.failed -> FAILS)", async () => {
    requestActions.createDocumentRequestAction.mockRejectedValue(new Error("lost"));
    const { h, reloadRequests } = handlers("es");
    expect(await h.askCustomer({ record: RECORD, items: ITEMS, channel: "text" })).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed.es"]);
    expect(toast.error).not.toHaveBeenCalledWith(m["documents.request.failed.es"]);
    expect(reloadRequests).toHaveBeenCalledTimes(1);
  });
});
