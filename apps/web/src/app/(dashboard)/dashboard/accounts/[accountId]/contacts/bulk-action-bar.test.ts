import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { LocaleProvider } from "@/components/locale-provider";

const bulkAddTagAction = vi.fn();
const bulkRemoveTagAction = vi.fn();
const bulkDeleteContactsAction = vi.fn();
const assignContactsAction = vi.fn();
const undoAssignContactsAction = vi.fn();
const countContactDocumentsAction = vi.fn();
vi.mock("./actions", () => ({
  bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction, assignContactsAction, undoAssignContactsAction,
  countContactDocumentsAction,
}));
const archiveContactsAction = vi.fn();
const restoreContactsAction = vi.fn();
const contactDeleteBlockersAction = vi.fn();
vi.mock("./archive-actions", () => ({ archiveContactsAction, restoreContactsAction, contactDeleteBlockersAction }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const {
  applyBulkTag, BulkActionBar, assignSelected, bulkAssignChoices,
  DeleteFilesLine, canConfirmDelete, deleteDialogCopy, announceDeleteResult, latestCountSettler,
  archiveSelected, restoreSelected, inChunks, readDeleteBlockers, deletableIds, DeleteKeptLine, deleteInChunks,
} = await import("./bulk-action-bar");
type FilesState = import("./bulk-action-bar").FilesState;
type BlockersState = import("./bulk-action-bar").BlockersState;
const BAR_SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "bulk-action-bar.tsx"), "utf8");

beforeEach(() => {
  archiveContactsAction.mockReset();
  restoreContactsAction.mockReset();
  contactDeleteBlockersAction.mockReset();
  bulkDeleteContactsAction.mockReset();
  countContactDocumentsAction.mockReset();
  bulkAddTagAction.mockReset();
  bulkRemoveTagAction.mockReset();
  assignContactsAction.mockReset();
  undoAssignContactsAction.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

// D-007: Undo after a bulk tag must remove the tag only from contacts that
// did NOT already carry it before the bulk-tag ran — never the whole
// original selection, which would strip the tag from a contact that already
// had it.
describe("applyBulkTag's undo (D-007)", () => {
  it("wires Undo to remove the tag ONLY from the newly-tagged ids (addedIds), not the full original selection", async () => {
    bulkAddTagAction.mockResolvedValue({ ok: true, tagId: "t9", applied: 3, addedIds: ["c2", "c3"] });
    bulkRemoveTagAction.mockResolvedValue({ ok: true });

    const r = await applyBulkTag("a1", ["c1", "c2", "c3"], "vip");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.applied).toBe(3);

    await r.undo();
    // S-10 T3: applyBulkTag's own "en" default rides through to both server actions.
    expect(bulkRemoveTagAction).toHaveBeenCalledWith("a1", ["c2", "c3"], "t9", "en");
    expect(bulkRemoveTagAction).not.toHaveBeenCalledWith("a1", ["c1", "c2", "c3"], "t9", "en");
  });

  it("propagates a failed add without calling remove at all", async () => {
    bulkAddTagAction.mockResolvedValue({ ok: false, error: "nope" });
    const r = await applyBulkTag("a1", ["c1"], "vip");
    expect(r).toEqual({ ok: false, error: "nope" });
    expect(bulkRemoveTagAction).not.toHaveBeenCalled();
  });

  // S-10 T3: the caller's own locale (the bar's useLocale(), passed into applyBulkTag) reaches
  // both server actions, not just the "crashed" toast applyBulkTag already translated.
  it("passes the caller's own locale through to both server actions (mutation: drop locale from either call -> FAILS)", async () => {
    bulkAddTagAction.mockResolvedValue({ ok: true, tagId: "t9", applied: 1, addedIds: ["c1"] });
    bulkRemoveTagAction.mockResolvedValue({ ok: true });
    const r = await applyBulkTag("a1", ["c1"], "vip", "es");
    expect(bulkAddTagAction).toHaveBeenCalledWith("a1", ["c1"], "vip", "es");
    if (!r.ok) throw new Error("unreachable");
    await r.undo();
    expect(bulkRemoveTagAction).toHaveBeenCalledWith("a1", ["c1"], "t9", "es");
  });
});

// Staff and roles (Task 6): delete is Owner-only. Staff still sees the bar
// (tag actions stay available — DESIGN.md rule 4's "never render checkboxes
// without bulk actions" still has to hold for Staff), it just loses the
// Delete control. `canDelete` is threaded in from the page's own
// `requireAccountAccess`-derived `canManage` through ContactsTable.
describe("BulkActionBar's Delete control is Owner-only (staff and roles)", () => {
  const render = (canDelete: boolean) => renderToStaticMarkup(createElement(BulkActionBar, {
    accountId: "a1", selectedIds: ["c1"], existingTags: [], view: "active", canArchive: true, timezone: "America/Chicago", canDelete, onDone: () => {},
  }));

  it("renders no Delete button when canDelete is false, but Add tag still renders (mutation: ignore the prop → FAILS)", () => {
    const html = render(false);
    expect(html).not.toContain(m["bulk.delete"]);
    expect(html).toContain(m["bulk.addTag"]);
  });

  it("renders the Delete button when canDelete is true", () => {
    const html = render(true);
    expect(html).toContain(m["bulk.delete"]);
  });
});

// F-085 follow-up (Task B): the bar's own labels — "N selected", Add tag,
// Assign to…, Delete…, Clear selection — read the LocaleProvider the
// contacts list seeds (same context AssigneeField already reads).
describe("BulkActionBar reads the LocaleProvider's locale (F-085 follow-up, Task B)", () => {
  const renderEs = (canAssign = true) => renderToStaticMarkup(
    createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>, createElement(BulkActionBar, {
      accountId: "a1", selectedIds: ["c1", "c2"], existingTags: [], view: "active", canArchive: true, timezone: "America/Chicago", canDelete: true, onDone: () => {},
      canAssign, members: [],
    })),
  );

  it("renders every bar label in Spanish (mutation: hard-code useLocale()'s default -> FAILS)", () => {
    const html = renderEs();
    expect(html).toContain(">2 seleccionados<");
    expect(html).toContain(">Agregar etiqueta<");
    expect(html).toContain(">Asignar a…<");
    expect(html).toContain(">Borrar…<");
    expect(html).toContain('aria-label="Quitar selección"');
  });
});

// F-085 follow-ups (design I4 / final M1): one selected is singular in both
// languages, through plural() like contacts.count — never "1 seleccionados".
describe("BulkActionBar counts one selected in the singular (F-085 follow-ups)", () => {
  const renderOne = (locale: "en" | "es") => renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(BulkActionBar, {
      accountId: "a1", selectedIds: ["c1"], existingTags: [], view: "active", canArchive: true, timezone: "America/Chicago", canDelete: true, onDone: () => {},
    })),
  );

  it("\"1 seleccionado\" and \"1 selected\", in the label and the toolbar's name (mutation: t(m, \"bulk.selected\") for every count -> FAILS)", () => {
    const es = renderOne("es");
    expect(es).toContain(">1 seleccionado<");
    expect(es).toContain('aria-label="1 seleccionado"');
    expect(es).not.toContain("1 seleccionados");
    const en = renderOne("en");
    expect(en).toContain(">1 selected<");
    expect(en).toContain('aria-label="1 selected"');
  });
});

// F-085 follow-ups (design I6, also English): at 390px the bar's own content
// was wider than the panel and the panel clips, so actions past the edge were
// unreachable. The bar wraps instead: every action keeps its own line if it
// must. No DOM layout in this vitest, so the class is pinned.
describe("BulkActionBar wraps at phone width (F-085 follow-ups)", () => {
  it("the toolbar is a wrapping flex row with a row gap (mutation: drop flex-wrap -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(BulkActionBar, {
      accountId: "a1", selectedIds: ["c1", "c2"], existingTags: [], view: "active", canArchive: true, timezone: "America/Chicago", canDelete: true, onDone: () => {}, canAssign: true, members: [],
    }));
    const cls = html.match(/<div role="toolbar"[^>]*class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    expect(cls).toContain("flex");
    expect(cls).toContain("flex-wrap");
    expect(cls).toContain("gap-y-2");
    expect(cls).not.toContain("flex-nowrap");
  });
});

// F-085 follow-ups (design m1): the Tag and Assign menus and the typed-delete
// dialog are portaled to the body, outside the list's lang wrapper, so each
// carries lang itself, and the dialog's X is named in the reader's language.
// Radix portals render nothing under a static render, so the wiring is pinned.
describe("BulkActionBar's portaled overlays carry lang (F-085 follow-ups)", () => {
  it("both menus and the delete dialog set lang={locale}; the dialog's close label is t(common.close) (mutation: drop lang from any one -> FAILS)", () => {
    expect(BAR_SRC.match(/<DropdownMenuContent align="start" lang=\{locale\}>/g)).toHaveLength(2);
    expect(BAR_SRC).toContain('<DialogContent lang={locale} closeLabel={t(m, "common.close", locale)}>');
    expect(BAR_SRC).not.toMatch(/<DropdownMenuContent align="start">/);
    expect((m as Record<string, string>)["common.close.es"]).toBe("Cerrar");
  });
});

// F-085 part 1 (spec §9, A2): "Assign to…" in the bulk bar for Owner, Staff
// and the agency. A Technician keeps the bar (bulk tagging, so the
// checkboxes stay: rule 4) but never the Assign control.
describe("BulkActionBar: Assign to… (F-085)", () => {
  const ANA = { userId: "11111111-1111-4111-8111-111111111111", label: "Ana Ruiz", role: "staff" as const };
  const TOM = { userId: "22222222-2222-4222-8222-222222222222", label: "tom@rio.test", role: "technician" as const };
  const PREVIOUS = [
    { contactId: "c1", assignee: null, target: ANA.userId, movedTaskIds: [] },
    { contactId: "c2", assignee: TOM.userId, target: ANA.userId, movedTaskIds: ["t1"] },
  ];
  const render = (canAssign: boolean) => renderToStaticMarkup(createElement(BulkActionBar, {
    accountId: "a1", selectedIds: ["c1"], existingTags: [], view: "active", canArchive: true, timezone: "America/Chicago", canDelete: false, onDone: () => {},
    canAssign, members: [ANA, TOM],
  }));
  const undoOf = (call: unknown[] | undefined) => {
    const opts = call?.[1] as { action?: { label: string; onClick: () => void } } | undefined;
    if (!opts?.action) throw new Error("no Undo on that toast");
    expect(opts.action.label).toBe(m["assign.undo"]);
    return opts.action.onClick;
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

  it("with canAssign the bar shows 'Assign to…' (mutation: drop the control -> FAILS)", () => {
    expect(render(true)).toContain(m["assign.bulk"]);
  });

  it("without canAssign (a Technician) there is no Assign control, but tagging stays (mutation: render it unconditionally -> FAILS)", () => {
    const html = render(false);
    expect(html).not.toContain(m["assign.bulk"]);
    expect(html).toContain(m["bulk.addTag"]);
  });

  it("the menu lists Unassigned FIRST, then each member by name, the field's own order (fix round 1, M5), and choosing one assigns the selection (mutation: put Unassigned last -> FAILS)", () => {
    expect(bulkAssignChoices([ANA, TOM])).toEqual([
      { assignee: null, label: m["assign.unassigned"] },
      { assignee: ANA.userId, label: ANA.label },
      { assignee: TOM.userId, label: TOM.label },
    ]);
    // F-085 follow-up (Task B): both the choices and the assign call now carry the bar's own locale.
    expect(BAR_SRC).toMatch(/bulkAssignChoices\(members, locale\)\.map\(\(c\) => \([\s\S]{0,200}?assignSelected\(accountId, \[\.\.\.selectedIds\], c\.assignee, c\.label, onDone, locale\)/);
  });

  it("choosing a member assigns the selected ids, clears the selection, and toasts the one-customer sentence with an Undo that hands back the returned array (mutation: Undo calls assignContactsAction -> FAILS)", async () => {
    const one = [PREVIOUS[0]!];
    assignContactsAction.mockResolvedValue({ ok: true, previous: one });
    undoAssignContactsAction.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    await assignSelected("a1", ["c1"], ANA.userId, ANA.label, onDone);
    expect(assignContactsAction).toHaveBeenCalledWith("a1", ["c1"], ANA.userId);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("1 customer assigned to Ana Ruiz.");
    undoOf(toasts.success.mock.calls[0])();
    await flush();
    expect(undoAssignContactsAction).toHaveBeenCalledWith("a1", one);
    expect(undoAssignContactsAction.mock.calls[0]![1]).toBe(one);
    expect(assignContactsAction).toHaveBeenCalledTimes(1);
  });

  it("an Undo that found every customer handed on since shows assign.changed's own sentence (final re-review; mutation: a fixed 'didn't save' -> FAILS)", async () => {
    assignContactsAction.mockResolvedValue({ ok: true, previous: PREVIOUS });
    undoAssignContactsAction.mockResolvedValue({ ok: false, error: "assign.changed" });
    await assignSelected("a1", ["c1", "c2", "c3"], ANA.userId, ANA.label, () => {});
    undoOf(toasts.success.mock.calls[0])();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["assign.changed"]);
  });

  it("several ids toast the plural sentence, with the same exact Undo (mutation: one sentence for every count -> FAILS)", async () => {
    assignContactsAction.mockResolvedValue({ ok: true, previous: PREVIOUS });
    undoAssignContactsAction.mockResolvedValue({ ok: true });
    await assignSelected("a1", ["c1", "c2", "c3"], ANA.userId, ANA.label, () => {});
    expect(toasts.success.mock.calls[0]![0]).toBe("3 customers assigned to Ana Ruiz.");
    undoOf(toasts.success.mock.calls[0])();
    await flush();
    expect(undoAssignContactsAction).toHaveBeenCalledWith("a1", PREVIOUS);
  });

  it("Unassigned on several says how many, explicitly (fix round 1, M6; mutation: the thin 'Now unassigned.' -> FAILS)", async () => {
    assignContactsAction.mockResolvedValue({ ok: true, previous: PREVIOUS });
    await assignSelected("a1", ["c1", "c2"], null, m["assign.unassigned"], () => {});
    expect(assignContactsAction).toHaveBeenCalledWith("a1", ["c1", "c2"], null);
    expect(toasts.success.mock.calls[0]![0]).toBe("2 customers are now unassigned.");
  });

  it("…and on one says it in the singular", async () => {
    assignContactsAction.mockResolvedValue({ ok: true, previous: [PREVIOUS[0]!] });
    await assignSelected("a1", ["c1"], null, m["assign.unassigned"], () => {});
    expect(toasts.success.mock.calls[0]![0]).toBe("1 customer is now unassigned.");
  });

  it("the sentences are chosen by plural() over the One twins, now in the reader's own language (F-085 follow-up, Task B; mutation: hand-pick by ids.length === 1 -> FAILS)", () => {
    expect(BAR_SRC).toContain('plural(m, "assign.bulkDone", ids.length, locale, { count: ids.length, name })');
    expect(BAR_SRC).toContain('plural(m, "assign.bulkUnassigned", ids.length, locale, { count: ids.length })');
    const cat = m as Record<string, string>;
    expect(cat["assign.bulkUnassigned.es"]).toBe("{count} clientes ahora están sin asignar.");
    expect(cat["assign.bulkUnassignedOne.es"]).toBe("1 cliente ahora está sin asignar.");
  });

  it("a Spanish-locale caller gets the Spanish sentence, not the English one (mutation: drop locale from assignSelected's plural() calls -> FAILS)", async () => {
    assignContactsAction.mockResolvedValue({ ok: true, previous: [] });
    await assignSelected("a1", ["c1"], ANA.userId, ANA.label, () => {}, "es");
    expect(toasts.success.mock.calls[0]![0]).toBe("1 cliente asignado a Ana Ruiz.");
  });

  it("nothing changed (previous = []) still confirms, but offers no Undo (mutation: offer Undo on an empty array -> FAILS)", async () => {
    assignContactsAction.mockResolvedValue({ ok: true, previous: [] });
    await assignSelected("a1", ["c1"], ANA.userId, ANA.label, () => {});
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![1]).toBeUndefined();
  });

  it("a refusal toasts its own sentence and keeps the selection (mutation: clear it anyway -> FAILS)", async () => {
    assignContactsAction.mockResolvedValue({ ok: false, error: "assign.refused" });
    const onDone = vi.fn();
    await assignSelected("a1", ["c1"], ANA.userId, ANA.label, onDone);
    expect(toasts.error).toHaveBeenCalledWith(m["assign.refused"]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a throw (a stale tab) is 'That didn't save'", async () => {
    assignContactsAction.mockRejectedValue(new Error("stale"));
    await assignSelected("a1", ["c1"], ANA.userId, ANA.label, () => {});
    expect(toasts.error).toHaveBeenCalledWith(m["assign.failed"]);
  });
});

// S-07, owner ruling 2026-10-13: deleting a customer deletes their files, and the dialog says how
// many BEFORE anything goes. Spanish is pinned to the literal owner's words, never t()'s output (a
// missing twin falls back to English silently).
describe("the delete dialog says how many files go (owner ruling 2026-10-13)", () => {
  const cat = m as Record<string, string>;
  const line = (state: FilesState, locale: "en" | "es" = "en") =>
    renderedText(renderToStaticMarkup(createElement(DeleteFilesLine, { state, locale }))).trim();
  it("in English and Spanish, singular and plural, the owner's words (mutation: drop the One form -> FAILS)", () => {
    expect(line({ status: "ready", count: 4 })).toBe("This also deletes 4 files.");
    expect(line({ status: "ready", count: 4 }, "es")).toBe("También se borrarán 4 archivos.");
    expect(line({ status: "ready", count: 1 })).toBe("This also deletes 1 file.");
    expect(line({ status: "ready", count: 1 }, "es")).toBe("También se borrará 1 archivo.");
  });
  it("no files, no line; counting is a skeleton; a failed count says so, in the reader's language (rule 7, rule 5; mutation: show nothing on error -> FAILS)", () => {
    expect(renderToStaticMarkup(createElement(DeleteFilesLine, { state: { status: "ready", count: 0 }, locale: "en" }))).toBe("");
    const loading = renderToStaticMarkup(createElement(DeleteFilesLine, { state: { status: "loading" }, locale: "en" }));
    expect(loading).toContain("data-delete-files-skeleton");
    expect(renderedText(loading).trim()).toBe("");
    expect(line({ status: "error" })).toBe(m["contacts.delete.filesFailed"]);
    expect(line({ status: "error" }, "es")).toBe(cat["contacts.delete.filesFailed.es"]);
    expect(cat["contacts.delete.filesFailed.es"]).toBe("No se pudo revisar si hay archivos. Cierre esto e intente de nuevo.");
  });
  it("Delete is enabled only with the typed count AND a known file count (mutation: ignore the file count -> FAILS)", () => {
    const free: BlockersState = { status: "ready", kept: [] };
    expect(canConfirmDelete("2", 2, { status: "ready", count: 3 }, free)).toBe(true);
    expect(canConfirmDelete(" 2 ", 2, { status: "ready", count: 0 }, free)).toBe(true);
    expect(canConfirmDelete("2", 2, { status: "loading" }, free)).toBe(false);
    expect(canConfirmDelete("2", 2, { status: "error" }, free)).toBe(false);
    expect(canConfirmDelete("3", 2, { status: "ready", count: 0 }, free)).toBe(false);
  });
  it("the dialog's own words are in the reader's language (plan review minor 10; mutation: read m[\"bulk.confirmBody\"] directly -> FAILS)", () => {
    expect(deleteDialogCopy(2, "es")).toEqual({
      title: "¿Borrar 2 contactos?", body: "Esto no se puede deshacer. Escriba 2 para confirmar.", cancel: "Cancelar", confirm: "Borrar…",
    });
    expect(deleteDialogCopy(1, "es").title).toBe("¿Borrar 1 contacto?");
    expect(deleteDialogCopy(1, "en").title).toBe("Delete 1 contact?");
    expect(deleteDialogCopy(3, "en")).toEqual({
      title: "Delete 3 contacts?", body: "This can't be undone. Type 3 to confirm.", cancel: "Cancel", confirm: "Delete…",
    });
  });
  it("the dialog is wired to them: Delete opens through openConfirm (which counts), the line sits in the header, the copy comes from deleteDialogCopy, and the destructive button is gated on canConfirmDelete (mutation: setConfirmOpen(true) on the Delete button -> FAILS)", () => {
    expect(BAR_SRC).toMatch(/onClick=\{openConfirm\}/);
    expect(BAR_SRC).not.toContain("onClick={() => setConfirmOpen(true)}");
    // Contact archive (plan Task 10): the files are counted for the DELETABLE ids only, once the blockers
    // read says which those are; a kept customer's files are not deleted, so they are never counted.
    expect(BAR_SRC).toMatch(/countContactDocumentsAction\(accountId, go\)/);
    // The dialog's body is DeleteDialogBody, rendered for real in bulk-action-bar.dialog.test.ts; the bar
    // hands it the live state, its own view, and whether this reader archives.
    expect(BAR_SRC).toMatch(/<DeleteDialogBody\b[\s\S]{0,400}?count=\{count\}[\s\S]{0,400}?blockers=\{blockers\}[\s\S]{0,400}?view=\{view\}[\s\S]{0,200}?canArchive=\{canArchive\}/);
    expect(BAR_SRC).not.toContain('m["bulk.confirmBody"]');
    // The delete's toasts know the view (Task 10 review I1: no "Archive them" in the Archived view).
    expect(BAR_SRC).toContain("const ctx = { accountId, timezone, view };");
    expect(BAR_SRC).toContain("announceDeleteResult(done, locale, ctx)");
    expect(BAR_SRC).toContain("announceDeleteResult(failure, locale, ctx)");
  });
});

const CTX = { accountId: "a1", timezone: "America/Chicago", view: "active" as const };
describe("what the delete says afterwards (owner ruling 2026-10-13)", () => {
  const cat = m as Record<string, string>;
  it("files gone but the customers kept says exactly that, in the reader's language (mutation: always toast r.error -> FAILS)", () => {
    announceDeleteResult({ ok: false, error: "Delete failed — please try again.", errorKey: "contacts.delete.filesGoneKept" }, "es", CTX);
    expect(toasts.error).toHaveBeenCalledWith(cat["contacts.delete.filesGoneKept.es"]);
    expect(cat["contacts.delete.filesGoneKept.es"]).toBe("Los archivos se borraron, pero los clientes se conservaron. Intente de nuevo.");
    expect(toasts.success).not.toHaveBeenCalled();
  });
  it("a plain failure toasts the action's own error", () => {
    announceDeleteResult({ ok: false, error: "Delete failed — please try again." }, "en", CTX);
    expect(toasts.error).toHaveBeenCalledWith("Delete failed — please try again.");
  });
  // F-085 follow-up (Task B): this success line used to stay in the bar's own English. That was S-07's
  // scope (translating the bar was not part of it), not the owner ruling of 2026-10-13, which is about
  // a customer's files going with them and says nothing about this line's language. Task B's brief is
  // that every toast fired from this list reads in the reader's language, so this line now does too
  // (plural() over bulk.deleted/.deletedOne, both with Spanish twins).
  it("customers kept because their files could not go are named after the success line, now in the reader's language (mutation: drop the skippedFiles toast -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 0, skippedFiles: 2, skippedIds: [], lateKept: 0 }, "es", CTX);
    expect(toasts.success).toHaveBeenCalledWith(m["bulk.deletedOne.es"]);
    expect(toasts.error).toHaveBeenCalledWith("Se borraron 1 · se conservaron 2 cuyos archivos no se pudieron borrar. Intente de nuevo.");
    toasts.error.mockReset();
    announceDeleteResult({ ok: true, deleted: 3, skippedBlocked: 0, skippedFiles: 0, skippedIds: [], lateKept: 0 }, "en", CTX);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith(m["bulk.deleted"].replace("{count}", "3"));
  });

  it("the plain English case still reads English, and the skipped-with-history line is localized too (mutation: ignore locale -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 2, skippedBlocked: 2, skippedFiles: 0, skippedIds: ["k1", "k2"], lateKept: 0 }, "en", CTX);
    expect(toasts.success.mock.calls[0]![0]).toBe(
      m["bulk.deletedSkipped"].replace("{count}", "2").replace("{skipped}", "2"),
    );
    toasts.success.mockReset();
    announceDeleteResult({ ok: true, deleted: 2, skippedBlocked: 2, skippedFiles: 0, skippedIds: ["k1", "k2"], lateKept: 0 }, "es", CTX);
    expect(toasts.success.mock.calls[0]![0]).toBe(
      m["bulk.deletedSkipped.es"].replace("{count}", "2").replace("{skipped}", "2"),
    );
  });

  // Task 10 review I3: one kept contact reads in the singular, picked by plural() on the KEPT count.
  it("one kept reads in the singular, in both languages (mutation: t(bulk.deletedSkipped) at every count -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 2, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["k1"], lateKept: 0 }, "en", CTX);
    expect(toasts.success.mock.calls[0]![0]).toBe("Deleted 2 · kept 1 that has a history with you. You can archive it instead.");
  });

  // F-085 follow-ups (final M2): "Se borraron 1 · se conservaron 1 ..." disagreed in number at a count
  // of one. Each count now follows a colon, so the words agree at any count, one included.
  it("the Spanish skipped line agrees at a count of one (mutation: restore \"Se borraron {count} · se conservaron {skipped}\" -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["k1"], lateKept: 0 }, "es", CTX);
    expect(toasts.success.mock.calls[0]![0]).toBe(
      "Contactos borrados: 1 · conservado porque tiene un historial con usted: 1. Puede archivarlo.",
    );
  });
});

describe("only the newest file count lands (review fix round)", () => {
  it("an earlier opening's slow answer never overwrites the current one, before or after it lands (mutation: drop the newest-only check -> FAILS)", () => {
    const seq = { current: 0 };
    const seen: FilesState[] = [];
    const first = latestCountSettler(seq, (s) => seen.push(s));
    const second = latestCountSettler(seq, (s) => seen.push(s));
    first({ status: "ready", count: 9 });
    expect(seen).toEqual([]);
    second({ status: "ready", count: 1 });
    first({ status: "error" });
    expect(seen).toEqual([{ status: "ready", count: 1 }]);
    expect(BAR_SRC).toContain("const settle = latestCountSettler(countSeq, setFiles);");
  });
});

// Contact archive (plan Task 10; owner rulings 2026-10-28). Archive runs at once with an Undo (rule 6); the
// Archived view's bar offers Restore instead; a Technician gets neither and keeps Add tag (rule 4).
describe("BulkActionBar: Archive on the list, Restore on the Archived view (plan Task 10)", () => {
  const render = (view: "active" | "archived", canArchive: boolean, locale: "en" | "es" = "en") => renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(BulkActionBar, {
      accountId: "a1", selectedIds: ["c1"], existingTags: [], view, canArchive, timezone: "America/Chicago",
      canDelete: false, onDone: () => {},
    })),
  );
  const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((b) => renderedText(b[1]!).trim());

  it("the list's bar shows Archive and no Restore (mutation: show Restore on the list -> FAILS)", () => {
    const names = buttons(render("active", true));
    expect(names).toContain(m["bulk.archive"]);
    expect(names).not.toContain(m["bulk.restore"]);
  });

  it("the Archived view's bar shows Restore and no Archive (mutation: ignore view -> FAILS)", () => {
    const names = buttons(render("archived", true));
    expect(names).toContain(m["bulk.restore"]);
    expect(names).not.toContain(m["bulk.archive"]);
  });

  it("a Technician (canArchive false) gets neither, and the bar still has Add tag (rule 4; mutation: ignore canArchive -> FAILS)", () => {
    for (const view of ["active", "archived"] as const) {
      const names = buttons(render(view, false));
      expect(names).not.toContain(m["bulk.archive"]);
      expect(names).not.toContain(m["bulk.restore"]);
      expect(names).toContain(m["bulk.addTag"]);
    }
  });

  it("both read Spanish from the LocaleProvider", () => {
    expect(buttons(render("active", true, "es"))).toContain("Archivar");
    expect(buttons(render("archived", true, "es"))).toContain("Restaurar");
  });

  it("no new control in the bar contains the word delete (the e2e's /delete/i locators; plan, e2e locators)", () => {
    const names = buttons(render("active", true)).concat(buttons(render("archived", true)));
    expect(names.filter((n) => /delete/i.test(n))).toEqual([]);
  });
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
type ToastOpts = { description?: string; action?: { label: string; onClick: () => void } } | undefined;
const optsOf = (call: unknown[] | undefined) => call?.[1] as ToastOpts;
const ok = (changedIds: string[], extra: Partial<{ nextAppointment: { contactId: string; startsAt: string } | null; withAppointments: number }> = {}) =>
  ({ ok: true, changedIds, nextAppointment: null, withAppointments: 0, ...extra });

describe("archiveSelected: at once, with an Undo for exactly what changed (rule 6, D-007's rule)", () => {
  it("archives the selection, clears it, and toasts the count with an Undo that restores EXACTLY changedIds (mutation: Undo restores the selection -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1", "c2"]));
    restoreContactsAction.mockResolvedValue(ok(["c1", "c2"]));
    const onDone = vi.fn();
    await archiveSelected("a1", ["c1", "c2", "c3"], onDone, "America/Chicago", "en");
    expect(archiveContactsAction).toHaveBeenCalledWith("a1", ["c1", "c2", "c3"]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Archived 2 contacts");
    const opts = optsOf(toasts.success.mock.calls[0]);
    expect(opts?.action?.label).toBe(m["common.undo"]);
    expect(opts?.description).toBeUndefined();
    opts!.action!.onClick();
    await flush();
    expect(restoreContactsAction).toHaveBeenCalledWith("a1", ["c1", "c2"]);
  });

  it("one archived contact with an appointment names its date IN THE ACCOUNT'S ZONE (owner ruling Q2; mutation: drop the description -> FAILS; mutation: format in UTC -> FAILS)", async () => {
    // 03:30 UTC on Nov 3 is still the evening of Nov 2 in Chicago.
    archiveContactsAction.mockResolvedValue(ok(["c1"], { nextAppointment: { contactId: "c1", startsAt: "2026-11-03T03:30:00Z" }, withAppointments: 1 }));
    await archiveSelected("a1", ["c1"], () => {}, "America/Chicago", "en");
    expect(toasts.success.mock.calls[0]![0]).toBe("Archived 1 contact");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("They still have an appointment on Nov 2, 2026. Its reminders still go.");
  });

  it("…and in Spanish, the date in the reader's language", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1"], { nextAppointment: { contactId: "c1", startsAt: "2026-11-03T03:30:00Z" }, withAppointments: 1 }));
    await archiveSelected("a1", ["c1"], () => {}, "America/Chicago", "es");
    expect(toasts.success.mock.calls[0]![0]).toBe("Se archivó 1 contacto");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("Todavía tiene una cita el 2 nov 2026. Sus recordatorios se siguen enviando.");
    expect(optsOf(toasts.success.mock.calls[0])?.action?.label).toBe("Deshacer");
  });

  it("one of several with an appointment reads in the singular (Task 10 review I3; mutation: t(keepsAppointments) at every count -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1", "c2", "c3"], { withAppointments: 1 }));
    await archiveSelected("a1", ["c1", "c2", "c3"], () => {}, "America/Chicago", "en");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("1 of them still has an appointment. Its reminders still go.");
    toasts.success.mockReset();
    await archiveSelected("a1", ["c1", "c2", "c3"], () => {}, "America/Chicago", "es");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("1 de ellos todavía tiene una cita. Sus recordatorios se siguen enviando.");
  });

  it("the dated line speaks of ONE customer: two calls that each archived one with an appointment get the count line, never one of their dates (review minor; mutation: drop the exactly-one guard -> FAILS)", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `c${i}`);
    archiveContactsAction
      .mockResolvedValueOnce(ok(["c0"], { nextAppointment: { contactId: "c0", startsAt: "2026-11-03T15:00:00Z" }, withAppointments: 1 }))
      .mockResolvedValueOnce(ok(["c500"], { nextAppointment: { contactId: "c500", startsAt: "2026-11-04T15:00:00Z" }, withAppointments: 1 }));
    await archiveSelected("a1", ids, () => {}, "America/Chicago", "en");
    expect(toasts.success.mock.calls[0]![0]).toBe("Archived 2 contacts");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("2 of them still have appointments. Their reminders still go.");
  });

  it("a call the server answered only in part (its ContactBatchError) gets the success line with its Undo AND the partial line (Task 10 review I2; mutation: ignore partial -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue({ ...ok(["c1"]), partial: true });
    await archiveSelected("a1", ["c1", "c2"], () => {}, "America/Chicago", "es");
    expect(toasts.success.mock.calls[0]![0]).toBe("Se archivó 1 contacto");
    expect(optsOf(toasts.success.mock.calls[0])?.action).toBeDefined();
    expect(toasts.error).toHaveBeenCalledWith((m as Record<string, string>)["contacts.archive.partial.es"]);
  });

  it("an Undo that restores only some says so with the restore twin", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1", "c2"]));
    restoreContactsAction.mockResolvedValue({ ...ok(["c1"]), partial: true });
    await archiveSelected("a1", ["c1", "c2"], () => {}, "America/Chicago", "en");
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.partial"]);
  });

  it("several with appointments say how many (contacts.archive.keepsAppointments)", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1", "c2", "c3"], { withAppointments: 2 }));
    await archiveSelected("a1", ["c1", "c2", "c3"], () => {}, "America/Chicago", "en");
    expect(optsOf(toasts.success.mock.calls[0])?.description).toBe("2 of them still have appointments. Their reminders still go.");
  });

  it("nothing changed (all already archived) still confirms, with no Undo (mutation: offer Undo on an empty array -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue(ok([]));
    await archiveSelected("a1", ["c1"], () => {}, "America/Chicago", "en");
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(optsOf(toasts.success.mock.calls[0])?.action).toBeUndefined();
  });

  it("a refusal toasts its own sentence and keeps the selection; a throw (a stale tab) is contacts.archive.failed", async () => {
    archiveContactsAction.mockResolvedValue({ ok: false, errorKey: "contacts.archive.failed" });
    const onDone = vi.fn();
    await archiveSelected("a1", ["c1"], onDone, "America/Chicago", "es");
    expect(toasts.error).toHaveBeenCalledWith((m as Record<string, string>)["contacts.archive.failed.es"]);
    expect(onDone).not.toHaveBeenCalled();
    archiveContactsAction.mockRejectedValue(new Error("stale"));
    await archiveSelected("a1", ["c1"], onDone, "America/Chicago", "en");
    expect(toasts.error).toHaveBeenLastCalledWith(m["contacts.archive.failed"]);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("an Undo that fails says so", async () => {
    archiveContactsAction.mockResolvedValue(ok(["c1"]));
    restoreContactsAction.mockResolvedValue({ ok: false, errorKey: "contacts.restore.failed" });
    await archiveSelected("a1", ["c1"], () => {}, "America/Chicago", "en");
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.failed"]);
  });

  it("a selection kept across pages past 500 goes in calls of 500, and the Undo restores every changed id the same way (mutation: one call for the whole selection -> FAILS)", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `c${i}`);
    archiveContactsAction.mockImplementation(async (_a: string, chunk: string[]) => ok(chunk));
    restoreContactsAction.mockImplementation(async (_a: string, chunk: string[]) => ok(chunk));
    await archiveSelected("a1", ids, () => {}, "America/Chicago", "en");
    expect(archiveContactsAction.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([500, 500, 200]);
    expect(toasts.success.mock.calls[0]![0]).toBe("Archived 1200 contacts");
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(restoreContactsAction.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([500, 500, 200]);
    expect(restoreContactsAction.mock.calls.flatMap((c) => c[1] as string[])).toEqual(ids);
  });

  it("a later call that fails after earlier ones changed contacts still offers Undo for exactly those (ContactBatchError's rule, across calls)", async () => {
    const ids = Array.from({ length: 700 }, (_, i) => `c${i}`);
    archiveContactsAction
      .mockImplementationOnce(async (_a: string, chunk: string[]) => ok(chunk))
      .mockResolvedValueOnce({ ok: false, errorKey: "contacts.archive.failed" });
    restoreContactsAction.mockImplementation(async (_a: string, chunk: string[]) => ok(chunk));
    const onDone = vi.fn();
    await archiveSelected("a1", ids, onDone, "America/Chicago", "en");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Archived 500 contacts");
    // Task 10 review I2: the rest did not go, and the screen says so (mutation: success only -> FAILS).
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.archive.partial"]);
    expect(toasts.error).not.toHaveBeenCalledWith(m["contacts.archive.failed"]);
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(restoreContactsAction.mock.calls.flatMap((c) => c[1] as string[])).toEqual(ids.slice(0, 500));
  });
});

describe("restoreSelected: the Archived view's Restore", () => {
  it("restores, clears the selection, and toasts with an Undo that archives EXACTLY changedIds again (mutation: Undo archives the selection -> FAILS)", async () => {
    restoreContactsAction.mockResolvedValue(ok(["c2"]));
    archiveContactsAction.mockResolvedValue(ok(["c2"]));
    const onDone = vi.fn();
    await restoreSelected("a1", ["c1", "c2"], onDone, "en");
    expect(restoreContactsAction).toHaveBeenCalledWith("a1", ["c1", "c2"]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Moved 1 contact back to your list");
    optsOf(toasts.success.mock.calls[0])!.action!.onClick();
    await flush();
    expect(archiveContactsAction).toHaveBeenCalledWith("a1", ["c2"]);
  });

  it("a restore that went only in part says so too (Task 10 review I2)", async () => {
    restoreContactsAction.mockResolvedValue({ ...ok(["c1"]), partial: true });
    await restoreSelected("a1", ["c1", "c2"], () => {}, "en");
    expect(toasts.success.mock.calls[0]![0]).toBe("Moved 1 contact back to your list");
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.partial"]);
  });

  it("several, in Spanish; a refusal is contacts.restore.failed and keeps the selection", async () => {
    restoreContactsAction.mockResolvedValue(ok(["c1", "c2"]));
    await restoreSelected("a1", ["c1", "c2"], () => {}, "es");
    expect(toasts.success.mock.calls[0]![0]).toBe("Se devolvieron 2 contactos a su lista");
    restoreContactsAction.mockResolvedValue({ ok: false, errorKey: "contacts.restore.failed" });
    const onDone = vi.fn();
    await restoreSelected("a1", ["c1"], onDone, "en");
    expect(toasts.error).toHaveBeenCalledWith(m["contacts.restore.failed"]);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("inChunks", () => {
  it("splits into calls of at most 500, the database's own cap (MAX_CONTACT_BATCH)", () => {
    expect(inChunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(inChunks([]).length).toBe(0);
    expect(inChunks(Array.from({ length: 1001 }, (_, i) => i)).map((c) => c.length)).toEqual([500, 500, 1]);
  });
});

// Spec §5.4: the bulk confirm is typing the count that WILL be deleted. A contact with a history is
// archive-only, so the dialog reads which are kept before anything can be confirmed.
describe("the delete dialog knows what it keeps before it can delete (spec §5.4)", () => {
  const files = { status: "ready", count: 0 } as const;
  const ready = (kept: string[]) => ({ status: "ready" as const, kept });

  it("Delete stays off while the blockers load, and after a failed read (rule 5, rule 7; mutation: ignore blockers -> FAILS)", () => {
    expect(canConfirmDelete("2", 2, files, { status: "loading" })).toBe(false);
    expect(canConfirmDelete("2", 2, files, { status: "error" })).toBe(false);
    expect(canConfirmDelete("2", 2, files, ready([]))).toBe(true);
  });

  it("the typed number is the DELETABLE count, not the selection (mutation: compare to the selection count -> FAILS)", () => {
    expect(canConfirmDelete("2", 3, files, ready(["c3"]))).toBe(true);
    expect(canConfirmDelete("3", 3, files, ready(["c3"]))).toBe(false);
  });

  it("nothing deletable never enables Delete, whatever is typed", () => {
    expect(canConfirmDelete("0", 2, files, ready(["c1", "c2"]))).toBe(false);
  });

  it("deletableIds leaves out exactly the kept ones", () => {
    expect(deletableIds(["c1", "c2", "c3"], ready(["c2"]))).toEqual(["c1", "c3"]);
  });

  it("readDeleteBlockers merges the kept ids across calls of 500; any failed call is the error state, never 'nothing blocks' (mutation: skip a failed call -> FAILS)", async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `c${i}`);
    contactDeleteBlockersAction
      .mockResolvedValueOnce({ ok: true, blocked: { c1: ["messages"] } })
      .mockResolvedValueOnce({ ok: true, blocked: { c550: ["bookings", "deals"] } });
    expect(await readDeleteBlockers("a1", ids)).toEqual({ status: "ready", kept: ["c1", "c550"] });
    expect(contactDeleteBlockersAction.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([500, 100]);
    contactDeleteBlockersAction.mockReset()
      .mockResolvedValueOnce({ ok: true, blocked: {} })
      .mockResolvedValueOnce({ ok: false });
    expect(await readDeleteBlockers("a1", ids)).toEqual({ status: "error" });
    contactDeleteBlockersAction.mockReset().mockRejectedValue(new Error("stale"));
    expect(await readDeleteBlockers("a1", ["c1"])).toEqual({ status: "error" });
  });

  it("the kept line: a skeleton while loading, the failure in words, and how many are kept (rule 7, rule 5)", () => {
    const line = (state: BlockersState, locale: "en" | "es" = "en") =>
      renderedText(renderToStaticMarkup(createElement(DeleteKeptLine, { state, locale }))).trim();
    const loading = renderToStaticMarkup(createElement(DeleteKeptLine, { state: { status: "loading" }, locale: "en" }));
    expect(loading).toContain("data-delete-kept-skeleton");
    expect(renderedText(loading).trim()).toBe("");
    expect(line({ status: "error" })).toBe(m["contacts.delete.blockersFailed"]);
    expect(line(ready(["c1"]))).toBe("1 of these has a history with you and will be kept.");
    expect(line(ready(["c1"]), "es")).toBe("1 de estos tiene un historial con usted y se conservará.");
    expect(line(ready(["c1", "c2"]), "es")).toBe("2 de estos tienen un historial con usted y se conservarán.");
    expect(line(ready([]))).toBe("");
  });

});

describe("deleteInChunks: a selection past 500 deletes in calls of 500, and says what really happened", () => {
  const res = (deleted: number, skippedIds: string[], lateKept = 0, skippedFiles = 0) =>
    ({ ok: true, deleted, skippedBlocked: skippedIds.length, skippedFiles, skippedIds, lateKept });

  it("sums every call into one answer (mutation: keep only the last call's answer -> FAILS)", async () => {
    const ids = Array.from({ length: 700 }, (_, i) => `c${i}`);
    bulkDeleteContactsAction.mockResolvedValueOnce(res(498, ["c1", "c2"], 1, 0)).mockResolvedValueOnce(res(199, ["c650"], 0, 1));
    const r = await deleteInChunks("a1", ids, "en");
    expect(bulkDeleteContactsAction.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([500, 200]);
    expect(r).toEqual({ done: res(697, ["c1", "c2", "c650"], 1, 1), failure: null });
  });

  it("a later call that fails keeps what the earlier ones did, and the failure", async () => {
    const ids = Array.from({ length: 700 }, (_, i) => `c${i}`);
    const fail = { ok: false, error: "Delete failed — please try again." };
    bulkDeleteContactsAction.mockResolvedValueOnce(res(500, [])).mockResolvedValueOnce(fail);
    expect(await deleteInChunks("a1", ids, "en")).toEqual({ done: res(500, []), failure: fail });
    bulkDeleteContactsAction.mockReset().mockRejectedValue(new Error("stale"));
    expect(await deleteInChunks("a1", ["c1"], "en")).toEqual({ done: null, failure: { ok: false, error: m["inline.crashed"] } });
  });

  // S-10 T3: the caller's own locale reaches the server action, not just the "crashed" toast
  // deleteInChunks already translated.
  it("passes the caller's own locale through to bulkDeleteContactsAction (mutation: drop locale from the call -> FAILS)", async () => {
    bulkDeleteContactsAction.mockResolvedValueOnce(res(1, []));
    await deleteInChunks("a1", ["c1"], "es");
    expect(bulkDeleteContactsAction).toHaveBeenCalledWith("a1", ["c1"], "es");
  });
});

describe("what the delete says about the ones it kept (spec §5.4, plan Task 10)", () => {
  it("Archive them archives EXACTLY skippedIds (mutation: archive the selection -> FAILS)", async () => {
    archiveContactsAction.mockResolvedValue(ok(["k1", "k2"]));
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 2, skippedFiles: 0, skippedIds: ["k1", "k2"], lateKept: 0 }, "en", CTX);
    const opts = optsOf(toasts.success.mock.calls[0]);
    expect(opts?.action?.label).toBe(m["bulk.archiveKept"]);
    opts!.action!.onClick();
    await flush();
    expect(archiveContactsAction).toHaveBeenCalledWith("a1", ["k1", "k2"]);
    expect(toasts.success.mock.calls[1]![0]).toBe("Archived 2 contacts");
  });

  it("in the Archived view the kept ones stay archived: its own line, and no Archive them (Task 10 review I1; mutation: ignore the view -> FAILS)", () => {
    const archivedCtx = { ...CTX, view: "archived" as const };
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 2, skippedFiles: 0, skippedIds: ["k1", "k2"], lateKept: 0 }, "en", archivedCtx);
    expect(toasts.success.mock.calls[0]![0]).toBe("Deleted 1 · kept 2 that have a history with you. They stay archived.");
    expect(optsOf(toasts.success.mock.calls[0])?.action).toBeUndefined();
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["k1"], lateKept: 0 }, "es", archivedCtx);
    expect(toasts.success.mock.calls[1]![0]).toBe("Contactos borrados: 1 · conservado porque tiene un historial con usted: 1. Sigue archivado.");
    expect(optsOf(toasts.success.mock.calls[1])?.action).toBeUndefined();
    expect(archiveContactsAction).not.toHaveBeenCalled();
  });

  it("closing the dialog by any route (Esc, the X, outside, Cancel) clears the typed number (review minor; mutation: onOpenChange={setConfirmOpen} -> FAILS)", () => {
    expect(BAR_SRC).toContain("onOpenChange={(open) => (open ? setConfirmOpen(true) : closeConfirm())}");
    expect(BAR_SRC).toMatch(/function closeConfirm\(\) \{\s*setConfirmOpen\(false\);\s*setTyped\(""\);/);
  });

  it("nothing kept offers no Archive them", () => {
    announceDeleteResult({ ok: true, deleted: 2, skippedBlocked: 0, skippedFiles: 0, skippedIds: [], lateKept: 0 }, "en", CTX);
    expect(optsOf(toasts.success.mock.calls[0])?.action).toBeUndefined();
  });

  it("customers the database kept after their files went also get the files-gone line (mutation: drop the lateKept toast -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["k1"], lateKept: 1 }, "es", CTX);
    expect(toasts.error).toHaveBeenCalledWith((m as Record<string, string>)["contacts.delete.filesGoneKept.es"]);
    toasts.error.mockReset();
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["k1"], lateKept: 0 }, "es", CTX);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

// Final review M3: a paused account refuses every delete, so the flag reaches both delete dialogs. No DOM
// renderer for this wiring (the dialogs portal; the page renders client components), so it is read.
describe("the bar hands its delete dialog the paused flag (final review M3)", () => {
  it("DeleteDialogBody gets paused={paused}", () => {
    expect(BAR_SRC).toMatch(/<DeleteDialogBody\b[\s\S]{0,700}?paused=\{paused\}/);
  });
});
