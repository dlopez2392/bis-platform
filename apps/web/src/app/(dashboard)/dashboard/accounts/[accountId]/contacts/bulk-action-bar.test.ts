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
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const {
  applyBulkTag, BulkActionBar, assignSelected, bulkAssignChoices,
  DeleteFilesLine, canConfirmDelete, deleteDialogCopy, announceDeleteResult, latestCountSettler,
} = await import("./bulk-action-bar");
type FilesState = import("./bulk-action-bar").FilesState;
const BAR_SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "bulk-action-bar.tsx"), "utf8");

beforeEach(() => {
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
    expect(bulkRemoveTagAction).toHaveBeenCalledWith("a1", ["c2", "c3"], "t9");
    expect(bulkRemoveTagAction).not.toHaveBeenCalledWith("a1", ["c1", "c2", "c3"], "t9");
  });

  it("propagates a failed add without calling remove at all", async () => {
    bulkAddTagAction.mockResolvedValue({ ok: false, error: "nope" });
    const r = await applyBulkTag("a1", ["c1"], "vip");
    expect(r).toEqual({ ok: false, error: "nope" });
    expect(bulkRemoveTagAction).not.toHaveBeenCalled();
  });
});

// Staff and roles (Task 6): delete is Owner-only. Staff still sees the bar
// (tag actions stay available — DESIGN.md rule 4's "never render checkboxes
// without bulk actions" still has to hold for Staff), it just loses the
// Delete control. `canDelete` is threaded in from the page's own
// `requireAccountAccess`-derived `canManage` through ContactsTable.
describe("BulkActionBar's Delete control is Owner-only (staff and roles)", () => {
  const render = (canDelete: boolean) => renderToStaticMarkup(createElement(BulkActionBar, {
    accountId: "a1", selectedIds: ["c1"], existingTags: [], canDelete, onDone: () => {},
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
      accountId: "a1", selectedIds: ["c1", "c2"], existingTags: [], canDelete: true, onDone: () => {},
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
      accountId: "a1", selectedIds: ["c1"], existingTags: [], canDelete: true, onDone: () => {},
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
      accountId: "a1", selectedIds: ["c1", "c2"], existingTags: [], canDelete: true, onDone: () => {}, canAssign: true, members: [],
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
    accountId: "a1", selectedIds: ["c1"], existingTags: [], canDelete: false, onDone: () => {},
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
    expect(canConfirmDelete("2", 2, { status: "ready", count: 3 })).toBe(true);
    expect(canConfirmDelete(" 2 ", 2, { status: "ready", count: 0 })).toBe(true);
    expect(canConfirmDelete("2", 2, { status: "loading" })).toBe(false);
    expect(canConfirmDelete("2", 2, { status: "error" })).toBe(false);
    expect(canConfirmDelete("3", 2, { status: "ready", count: 0 })).toBe(false);
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
    expect(BAR_SRC).toMatch(/countContactDocumentsAction\(accountId, ids\)/);
    expect(BAR_SRC).toMatch(/<\/DialogDescription>\s*<DeleteFilesLine state=\{files\} locale=\{locale\} \/>\s*<\/DialogHeader>/);
    expect(BAR_SRC).toContain("disabled={!canConfirmDelete(typed, count, files)}");
    expect(BAR_SRC).toContain("deleteDialogCopy(count, locale)");
    expect(BAR_SRC).not.toContain('m["bulk.confirmBody"]');
    expect(BAR_SRC).toContain("announceDeleteResult(r, locale)");
  });
});

describe("what the delete says afterwards (owner ruling 2026-10-13)", () => {
  const cat = m as Record<string, string>;
  it("files gone but the customers kept says exactly that, in the reader's language (mutation: always toast r.error -> FAILS)", () => {
    announceDeleteResult({ ok: false, error: "Delete failed — please try again.", errorKey: "contacts.delete.filesGoneKept" }, "es");
    expect(toasts.error).toHaveBeenCalledWith(cat["contacts.delete.filesGoneKept.es"]);
    expect(cat["contacts.delete.filesGoneKept.es"]).toBe("Los archivos se borraron, pero los clientes se conservaron. Intente de nuevo.");
    expect(toasts.success).not.toHaveBeenCalled();
  });
  it("a plain failure toasts the action's own error", () => {
    announceDeleteResult({ ok: false, error: "Delete failed — please try again." }, "en");
    expect(toasts.error).toHaveBeenCalledWith("Delete failed — please try again.");
  });
  // F-085 follow-up (Task B): this success line used to stay in the bar's own English. That was S-07's
  // scope (translating the bar was not part of it), not the owner ruling of 2026-10-13, which is about
  // a customer's files going with them and says nothing about this line's language. Task B's brief is
  // that every toast fired from this list reads in the reader's language, so this line now does too
  // (plural() over bulk.deleted/.deletedOne, both with Spanish twins).
  it("customers kept because their files could not go are named after the success line, now in the reader's language (mutation: drop the skippedFiles toast -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 0, skippedFiles: 2 }, "es");
    expect(toasts.success).toHaveBeenCalledWith(m["bulk.deletedOne.es"]);
    expect(toasts.error).toHaveBeenCalledWith("Se borraron 1 · se conservaron 2 cuyos archivos no se pudieron borrar. Intente de nuevo.");
    toasts.error.mockReset();
    announceDeleteResult({ ok: true, deleted: 3, skippedBlocked: 0, skippedFiles: 0 }, "en");
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith(m["bulk.deleted"].replace("{count}", "3"));
  });

  it("the plain English case still reads English, and the skipped-with-history line is localized too (mutation: ignore locale -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 2, skippedBlocked: 1, skippedFiles: 0 }, "en");
    expect(toasts.success).toHaveBeenCalledWith(
      m["bulk.deletedSkipped"].replace("{count}", "2").replace("{skipped}", "1"),
    );
    toasts.success.mockReset();
    announceDeleteResult({ ok: true, deleted: 2, skippedBlocked: 1, skippedFiles: 0 }, "es");
    expect(toasts.success).toHaveBeenCalledWith(
      m["bulk.deletedSkipped.es"].replace("{count}", "2").replace("{skipped}", "1"),
    );
  });

  // F-085 follow-ups (final M2): "Se borraron 1 · se conservaron 1 ..." disagreed in number at a count
  // of one. Each count now follows a colon, so the words agree at any count, one included.
  it("the Spanish skipped line agrees at a count of one (mutation: restore \"Se borraron {count} · se conservaron {skipped}\" -> FAILS)", () => {
    announceDeleteResult({ ok: true, deleted: 1, skippedBlocked: 1, skippedFiles: 0 }, "es");
    expect(toasts.success).toHaveBeenCalledWith(
      "Contactos borrados: 1 · conservados por estar vinculados a citas, oportunidades o conversaciones: 1",
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
