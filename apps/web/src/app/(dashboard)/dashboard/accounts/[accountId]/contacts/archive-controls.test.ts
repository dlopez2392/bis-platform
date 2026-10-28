import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { formatDateInZone } from "@/lib/format";
import { LocaleProvider } from "@/components/locale-provider";
import { Dialog } from "@/components/ui/dialog";

/**
 * The record header's and the drawer's Archive, Restore and delete-for-good (contact archive, plan
 * Task 11). No DOM renderer in apps/web (contact-drawer.wiring.test.ts's header), so the handlers are
 * plain exported functions tested directly, in archiveSelected's style, and what each role SEES is read
 * off a real `renderToStaticMarkup` of the component (review M5: a source regex would pass on a dead branch).
 */
const archiveContactsAction = vi.fn();
const restoreContactsAction = vi.fn();
const contactDeleteBlockersAction = vi.fn();
vi.mock("./archive-actions", () => ({ archiveContactsAction, restoreContactsAction, contactDeleteBlockersAction }));
const bulkDeleteContactsAction = vi.fn();
const countContactDocumentsAction = vi.fn();
vi.mock("./actions", () => ({
  bulkDeleteContactsAction, countContactDocumentsAction,
  bulkAddTagAction: vi.fn(), bulkRemoveTagAction: vi.fn(), assignContactsAction: vi.fn(), undoAssignContactsAction: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const {
  ArchiveControls, ArchivedBanner, DeleteOneBody, archiveOne, restoreOne, confirmTyped, deleteConfirmToken,
  deleteOne, readOneDelete, lastFourDigits,
} = await import("./archive-controls");
type Props = ComponentProps<typeof ArchiveControls>;

const ZONE = "America/Chicago";
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
type ToastOpts = { description?: string; action?: { label: string; onClick: () => void } } | undefined;
const optsOf = (call: unknown[] | undefined) => call?.[1] as ToastOpts;
const ok = (changedIds: string[], extra: Partial<{ nextAppointment: { contactId: string; startsAt: string } | null; withAppointments: number }> = {}) =>
  ({ ok: true, changedIds, nextAppointment: null, withAppointments: 0, ...extra });
const deleted = (over: Partial<{ deleted: number; skippedBlocked: number; skippedFiles: number; skippedIds: string[]; lateKept: number }> = {}) =>
  ({ ok: true, deleted: 1, skippedBlocked: 0, skippedFiles: 0, skippedIds: [], lateKept: 0, ...over });

beforeEach(() => {
  for (const f of [archiveContactsAction, restoreContactsAction, contactDeleteBlockersAction, bulkDeleteContactsAction,
    countContactDocumentsAction, toasts.success, toasts.error, router.refresh, router.push]) f.mockReset();
});

describe("archiveOne: the record's Archive runs at once, with an Undo (rule 6)", () => {
  it("archives this one contact, says so by name, and the Undo restores exactly it, then refreshes (mutation: Undo calls archive again -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1"]));
    restoreContactsAction.mockResolvedValue(ok(["c1"]));
    const onDone = vi.fn();
    const onUndone = vi.fn();
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone, onUndone });
    expect(archiveContactsAction).toHaveBeenCalledWith("a1", ["c1"]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Maria Garcia archived");
    const opts = optsOf(toasts.success.mock.calls[0]);
    expect(opts?.action?.label).toBe(m["common.undo"]);
    expect(opts?.description).toBeUndefined();
    opts!.action!.onClick();
    await flush();
    expect(restoreContactsAction).toHaveBeenCalledWith("a1", ["c1"]);
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("an upcoming appointment is named in the toast, its date in the ACCOUNT's zone (owner ruling Q2; mutation: drop the description -> FAILS)", async () => {
    // 03:30 UTC on Nov 3 is still the evening of Nov 2 in Chicago.
    archiveContactsAction.mockResolvedValue(ok(["c1"], { nextAppointment: { contactId: "c1", startsAt: "2026-11-03T03:30:00Z" }, withAppointments: 1 }));
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone: () => {} });
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("They still have an appointment on Nov 2, 2026. Its reminders still go.");
  });

  it("…and in Spanish", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1"], { nextAppointment: { contactId: "c1", startsAt: "2026-11-03T03:30:00Z" }, withAppointments: 1 }));
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "es", onDone: () => {} });
    expect(toasts.success.mock.calls[0]![0]).toBe("Maria Garcia se archivó");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("Todavía tiene una cita el 2 nov 2026. Sus recordatorios se siguen enviando.");
    expect(optsOf(toasts.success.mock.calls[0])?.action?.label).toBe("Deshacer");
  });

  it("a refusal or a throw toasts contacts.archive.failed and changes nothing on screen (mutation: call onDone anyway -> FAILS)", async () => {
    const onDone = vi.fn();
    archiveContactsAction.mockResolvedValue({ ok: false, errorKey: "contacts.archive.failed" });
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone });
    archiveContactsAction.mockRejectedValue(new Error("stale tab"));
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone });
    expect(toasts.error.mock.calls).toEqual([[m["contacts.archive.failed"]], [m["contacts.archive.failed"]]]);
    expect(onDone).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("already archived (nothing changed) still confirms, with no Undo (mutation: offer Undo on an empty array -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue(ok([]));
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone: () => {} });
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(optsOf(toasts.success.mock.calls[0])?.action).toBeUndefined();
  });

  it("an Undo that fails says so, and does not refresh", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1"]));
    restoreContactsAction.mockResolvedValue({ ok: false, errorKey: "contacts.restore.failed" });
    const onUndone = vi.fn();
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone: () => {}, onUndone });
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.failed"]);
    expect(onUndone).not.toHaveBeenCalled();
  });
});

describe("a partial answer keeps the bulk bar's shape (Task 10 review I2)", () => {
  // One contact is one batch, so the server cannot answer it in part today; the shape is kept so that the
  // day it can, the record says so the way the list does: the success line with its Undo, then the partial line.
  it("Archive: the success line and its Undo, then contacts.archive.partial (mutation: ignore partial -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue({ ...ok(["c1"]), partial: true });
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone: () => {} });
    expect(toasts.success.mock.calls[0]![0]).toBe("Maria Garcia archived");
    expect(optsOf(toasts.success.mock.calls[0])?.action).toBeDefined();
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.archive.partial"]);
  });

  it("Restore and an Undo that answers in part say contacts.restore.partial", async () => {
    restoreContactsAction.mockResolvedValue({ ...ok(["c1"]), partial: true });
    await restoreOne("a1", "c1", "Maria Garcia", { locale: "en", onDone: () => {} });
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.partial"]);
    toasts.error.mockReset();
    archiveContactsAction.mockResolvedValue(ok(["c1"]));
    restoreContactsAction.mockResolvedValue({ ...ok(["c1"]), partial: true });
    await archiveOne("a1", "c1", "Maria Garcia", { timezone: ZONE, locale: "en", onDone: () => {} });
    optsOf(toasts.success.mock.calls.at(-1))!.action!.onClick();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.partial"]);
  });
});

describe("restoreOne: the banner's Restore, the same shape", () => {
  it("restores, says the contact is back, and the Undo archives exactly it (mutation: Undo restores again -> FAILS)", async () => {
    restoreContactsAction.mockResolvedValue(ok(["c1"]));
    archiveContactsAction.mockResolvedValue(ok(["c1"]));
    const onDone = vi.fn();
    await restoreOne("a1", "c1", "Maria Garcia", { locale: "en", onDone });
    expect(restoreContactsAction).toHaveBeenCalledWith("a1", ["c1"]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Maria Garcia is back on your list");
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(archiveContactsAction).toHaveBeenCalledWith("a1", ["c1"]);
  });

  it("a refusal toasts contacts.restore.failed", async () => {
    restoreContactsAction.mockResolvedValue({ ok: false, errorKey: "contacts.restore.failed" });
    const onDone = vi.fn();
    await restoreOne("a1", "c1", "Maria Garcia", { locale: "es", onDone });
    expect(toasts.error).toHaveBeenCalledWith((m as Record<string, string>)["contacts.restore.failed.es"]);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("confirmTyped: delete for good is confirmed by typing the name (rule 6)", () => {
  it("an exact, trimmed match of the name", () => {
    expect(confirmTyped("Maria Garcia", "Maria Garcia", null)).toBe(true);
    expect(confirmTyped("  Maria Garcia ", "Maria Garcia", "4567")).toBe(true);
    expect(confirmTyped("Maria", "Maria Garcia", null)).toBe(false);
    expect(confirmTyped("", "Maria Garcia", null)).toBe(false);
  });

  it("case-SENSITIVE (mutation: compare lower-cased -> FAILS)", () => {
    expect(confirmTyped("maria garcia", "Maria Garcia", null)).toBe(false);
    expect(confirmTyped("MARIA GARCIA", "Maria Garcia", null)).toBe(false);
  });

  it("no name: the phone's last four digits, and the name is never asked for (mutation: ignore digits -> FAILS)", () => {
    expect(confirmTyped("4567", null, "4567")).toBe(true);
    expect(confirmTyped(" 4567 ", null, "4567")).toBe(true);
    expect(confirmTyped("4568", null, "4567")).toBe(false);
    expect(confirmTyped("", null, "4567")).toBe(false);
  });

  it("nothing to type never confirms: an empty name and no digits stay off (mutation: compare to '' -> FAILS)", () => {
    expect(confirmTyped("", null, null)).toBe(false);
    expect(confirmTyped("", "  ", null)).toBe(false);
  });
});

describe("deleteConfirmToken: what the person types", () => {
  it("the name when there is one, the phone's last four when there is not, then the email, then the label", () => {
    expect(deleteConfirmToken({ first_name: "Maria", last_name: "Garcia", email: "m@x.test", phone: "+1 (956) 555-4567" }, "Maria Garcia"))
      .toEqual({ name: "Maria Garcia", digits: "4567" });
    expect(deleteConfirmToken({ first_name: null, last_name: null, email: "m@x.test", phone: "+1 (956) 555-4567" }, "(no name)"))
      .toEqual({ name: null, digits: "4567" });
    expect(deleteConfirmToken({ first_name: null, last_name: null, email: "m@x.test", phone: null }, "(no name)"))
      .toEqual({ name: "m@x.test", digits: null });
    expect(deleteConfirmToken({ first_name: null, last_name: null, email: null, phone: null }, "(no name)"))
      .toEqual({ name: "(no name)", digits: null });
  });

  it("lastFourDigits reads digits only, and needs four", () => {
    expect(lastFourDigits("+52 1 899 123 0042")).toBe("0042");
    expect(lastFourDigits("123")).toBeNull();
    expect(lastFourDigits(null)).toBeNull();
  });
});

describe("readOneDelete: what blocks this contact, then its files", () => {
  it("a contact with a history is archive-only and its files are never counted (mutation: count anyway -> FAILS)", async () => {
    contactDeleteBlockersAction.mockResolvedValue({ ok: true, blocked: { c1: ["calls"] } });
    countContactDocumentsAction.mockResolvedValue({ ok: true, count: 5 });
    const r = await readOneDelete("a1", "c1");
    expect(contactDeleteBlockersAction).toHaveBeenCalledWith("a1", ["c1"]);
    expect(r).toEqual({ blockers: { status: "ready", kept: ["c1"] }, files: { status: "ready", count: 0 } });
    expect(countContactDocumentsAction).not.toHaveBeenCalled();
  });

  it("a free contact's files are counted; a failed read is the error state, never 'nothing blocks'", async () => {
    contactDeleteBlockersAction.mockResolvedValue({ ok: true, blocked: {} });
    countContactDocumentsAction.mockResolvedValue({ ok: true, count: 3 });
    expect(await readOneDelete("a1", "c1")).toEqual({ blockers: { status: "ready", kept: [] }, files: { status: "ready", count: 3 } });
    expect(countContactDocumentsAction).toHaveBeenCalledWith("a1", ["c1"]);
    contactDeleteBlockersAction.mockResolvedValue({ ok: false });
    expect((await readOneDelete("a1", "c1")).blockers).toEqual({ status: "error" });
    contactDeleteBlockersAction.mockResolvedValue({ ok: true, blocked: {} });
    countContactDocumentsAction.mockResolvedValue({ ok: false });
    expect((await readOneDelete("a1", "c1")).files).toEqual({ status: "error" });
  });
});

describe("deleteOne: delete for good, only when nothing blocks it (spec §5)", () => {
  const ctx = (onGone = vi.fn()) => ({ locale: "en" as const, timezone: ZONE, onGone, view: "active" as const });

  it("after a blocked answer it never calls the delete, and the dialog shows contacts.delete.archiveOnly (mutation: call it anyway -> FAILS)", async () => {
    // The action would answer a clean delete: a call that slipped through fails on the spy, not on a missing answer.
    bulkDeleteContactsAction.mockResolvedValue(deleted());
    const blocked = { status: "ready" as const, kept: ["c1"] };
    const c = ctx();
    expect(await deleteOne("a1", "c1", blocked, c)).toBe("blocked");
    expect(bulkDeleteContactsAction).not.toHaveBeenCalled();
    expect(c.onGone).not.toHaveBeenCalled();
    for (const unread of [{ status: "loading" as const }, { status: "error" as const }]) {
      await deleteOne("a1", "c1", unread, c);
    }
    expect(bulkDeleteContactsAction).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(createElement(Dialog, { open: true }, createElement(DeleteOneBody, {
      view: "blocked", files: { status: "ready", count: 0 }, label: "Maria Garcia", name: "Maria Garcia", digits: null,
      typed: "", onTyped: () => {}, locale: "en",
    })));
    expect(renderedText(html)).toContain(m["contacts.delete.archiveOnly"].replace("{name}", "Maria Garcia"));
    expect(html).not.toContain("<input");
  });

  it("a free contact is deleted, said so, and the caller leaves (mutation: skip onGone -> FAILS)", async () => {
    bulkDeleteContactsAction.mockResolvedValue(deleted());
    const c = ctx();
    expect(await deleteOne("a1", "c1", { status: "ready", kept: [] }, c)).toBe("deleted");
    expect(bulkDeleteContactsAction).toHaveBeenCalledWith("a1", ["c1"]);
    expect(toasts.success).toHaveBeenCalledWith(m["bulk.deletedOne"]);
    expect(c.onGone).toHaveBeenCalledTimes(1);
  });

  it("one that gained a history since the dialog read it is kept: the dialog turns archive-only and nobody leaves (mutation: onGone on deleted 0 -> FAILS)", async () => {
    bulkDeleteContactsAction.mockResolvedValue(deleted({ deleted: 0, skippedBlocked: 1, skippedIds: ["c1"] }));
    const c = ctx();
    expect(await deleteOne("a1", "c1", { status: "ready", kept: [] }, c)).toBe("blocked");
    expect(c.onGone).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("…and when its files had already gone, says exactly that", async () => {
    bulkDeleteContactsAction.mockResolvedValue(deleted({ deleted: 0, skippedBlocked: 1, skippedIds: ["c1"], lateKept: 1 }));
    expect(await deleteOne("a1", "c1", { status: "ready", kept: [] }, ctx())).toBe("blocked");
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.delete.filesGoneKept"]);
  });

  it("a failure toasts and stays (mutation: onGone on a failure -> FAILS)", async () => {
    bulkDeleteContactsAction.mockResolvedValue({ ok: false, error: "Delete failed — please try again." });
    const c = ctx();
    expect(await deleteOne("a1", "c1", { status: "ready", kept: [] }, c)).toBe("failed");
    expect(toasts.error).toHaveBeenCalledWith("Delete failed — please try again.");
    bulkDeleteContactsAction.mockRejectedValue(new Error("stale tab"));
    expect(await deleteOne("a1", "c1", { status: "ready", kept: [] }, c)).toBe("failed");
    expect(c.onGone).not.toHaveBeenCalled();
  });
});

describe("DeleteOneBody: the dialog's words", () => {
  const body = (over: Partial<ComponentProps<typeof DeleteOneBody>> = {}) => renderToStaticMarkup(createElement(Dialog, { open: true },
    createElement(DeleteOneBody, {
      view: "deletable", files: { status: "ready", count: 2 }, label: "Maria Garcia", name: "Maria Garcia", digits: null,
      typed: "", onTyped: () => {}, locale: "en", ...over,
    })));

  it("names the contact, says how to confirm and how many files go, with the typed field (owner ruling 2026-10-13)", () => {
    const html = body();
    const text = renderedText(html);
    expect(text).toContain("Delete Maria Garcia for good?");
    expect(text).toContain("Type Maria Garcia to confirm.");
    expect(text).toContain("This also deletes 2 files.");
    expect(html).toMatch(/<input[^>]*aria-label="Delete Maria Garcia for good\?"/);
  });

  it("no name: asks for the phone's last four digits", () => {
    expect(renderedText(body({ name: null, digits: "4567", label: "(no name)" })))
      .toContain("Type the last four digits of their phone, 4567, to confirm.");
  });

  it("loading is a skeleton, never a spinner (rule 7); a failed read says so (rule 5)", () => {
    const loading = body({ view: "loading" });
    expect(loading).toContain('data-slot="skeleton"');
    expect(loading).not.toContain("<input");
    expect(renderedText(body({ view: "error" }))).toContain(m["contacts.delete.blockersFailed"]);
  });

  it("reads Spanish", () => {
    expect(renderedText(body({ locale: "es" }))).toContain("¿Borrar a Maria Garcia para siempre?");
  });
});

describe("ArchiveControls: who sees what (review M5, renderToStaticMarkup)", () => {
  const base: Props = {
    accountId: "a1", contactId: "c1", label: "Maria Garcia",
    contact: { first_name: "Maria", last_name: "Garcia", email: null, phone: null }, archived: null,
    canArchive: true, canDelete: true, timezone: ZONE, variant: "page",
  };
  const render = (over: Partial<Props> = {}, locale: "en" | "es" = "en") => renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(ArchiveControls, { ...base, ...over })));
  const actionsOf = (html: string) => [...html.matchAll(/data-archive-action="(\w+)"/g)].map((x) => x[1]);

  it("an Owner sees Archive and Delete…; a Technician sees neither (mutation: ignore canArchive -> FAILS)", () => {
    expect(actionsOf(render())).toEqual(["archive", "delete"]);
    expect(actionsOf(render({ canArchive: false, canDelete: false }))).toEqual([]);
  });

  it("Staff archive but never delete for good (mutation: ignore canDelete -> FAILS)", () => {
    expect(actionsOf(render({ canDelete: false }))).toEqual(["archive"]);
  });

  it("an archived contact offers Restore, not Archive (mutation: always Archive -> FAILS)", () => {
    expect(actionsOf(render({ archived: { at: "2026-10-28T15:00:00Z", byLabel: "Ana Me" } }))).toEqual(["restore", "delete"]);
  });

  it("every control is ghost: Call stays the header's one primary (rule 8; mutation: variant default -> FAILS)", () => {
    for (const html of [render(), render({ archived: { at: "2026-10-28T15:00:00Z", byLabel: null } })]) {
      expect(html).not.toContain('data-variant="default"');
      expect(html.match(/data-variant="ghost"/g)?.length).toBe(2);
    }
  });

  it("each control is named in the reader's language, and none is named Contacts (e2e locators)", () => {
    expect(renderedText(render({}, "es"))).toMatch(/Archivar[\s\S]*Borrar…/);
    expect(renderedText(render({ archived: { at: "2026-10-28T15:00:00Z", byLabel: null } }, "es"))).toContain("Restaurar");
  });

  it("in the drawer the labels are for screen readers only, so the controls fit beside the name at 375px (mutation: show the words -> FAILS)", () => {
    const labels = (html: string) => [...html.matchAll(/<span class="([^"]*)"[^>]*>(Archive|Delete…)<\/span>/g)].map((x) => x[1]!.split(/\s+/));
    const drawer = labels(render({ variant: "drawer" }));
    expect(drawer).toHaveLength(2);
    for (const cls of drawer) { expect(cls).toContain("sr-only"); expect(cls).not.toContain("sm:not-sr-only"); }
    // On the page the words come back from the small breakpoint up; on a phone they are icons.
    for (const cls of labels(render())) { expect(cls).toContain("sr-only"); expect(cls).toContain("sm:not-sr-only"); }
  });
});

describe("ArchivedBanner: the archived state is a dot plus a word (rule 3)", () => {
  const AT = "2026-10-28T03:30:00Z"; // Oct 27 in Chicago
  const banner = (over: Partial<ComponentProps<typeof ArchivedBanner>> = {}, locale: "en" | "es" = "en") => renderToStaticMarkup(
    createElement(ArchivedBanner, { archived: { at: AT, byLabel: "Ana Me" }, timezone: ZONE, variant: "page", locale, ...over }));

  it("says when, in the account's zone, and by whom, after a dot (mutation: drop the dot -> FAILS; mutation: UTC -> FAILS)", () => {
    const html = banner();
    expect(html).toMatch(/<span[^>]*data-status-dot[^>]*aria-hidden="true"/);
    expect(renderedText(html).replace(/\s+/g, " ").trim())
      .toBe(`Archived ${formatDateInZone(AT, ZONE, "en")} by Ana Me. Their calls and texts are kept.`);
    expect(formatDateInZone(AT, ZONE, "en")).toBe("Oct 27, 2026");
  });

  it("no name known (or in the drawer) is the short line", () => {
    expect(renderedText(banner({ archived: { at: AT, byLabel: null } }))).toContain("Archived Oct 27, 2026. Their calls and texts are kept.");
    expect(renderedText(banner({ variant: "drawer" }))).not.toContain("Ana Me");
  });

  it("reads Spanish", () => {
    expect(renderedText(banner({}, "es"))).toContain("Archivado el 27 oct 2026 por Ana Me.");
  });

  it("not archived, no banner", () => {
    expect(banner({ archived: null })).toBe("");
  });
});
