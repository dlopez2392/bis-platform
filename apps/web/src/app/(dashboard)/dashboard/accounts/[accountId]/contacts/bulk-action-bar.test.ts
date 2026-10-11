import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";

const bulkAddTagAction = vi.fn();
const bulkRemoveTagAction = vi.fn();
const bulkDeleteContactsAction = vi.fn();
const assignContactsAction = vi.fn();
const undoAssignContactsAction = vi.fn();
vi.mock("./actions", () => ({
  bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction, assignContactsAction, undoAssignContactsAction,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { applyBulkTag, BulkActionBar, assignSelected, bulkAssignChoices } = await import("./bulk-action-bar");
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
    expect(BAR_SRC).toMatch(/bulkAssignChoices\(members\)\.map\(\(c\) => \([\s\S]{0,200}?assignSelected\(accountId, \[\.\.\.selectedIds\], c\.assignee, c\.label, onDone\)/);
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

  it("the sentences are chosen by plural() over the One twins, both with Spanish (fix round 1, M6; mutation: hand-pick by ids.length === 1 -> FAILS)", () => {
    expect(BAR_SRC).toContain('plural(m, "assign.bulkDone", ids.length, "en", { count: ids.length, name })');
    expect(BAR_SRC).toContain('plural(m, "assign.bulkUnassigned", ids.length, "en", { count: ids.length })');
    const cat = m as Record<string, string>;
    expect(cat["assign.bulkUnassigned.es"]).toBe("{count} clientes ahora están sin asignar.");
    expect(cat["assign.bulkUnassignedOne.es"]).toBe("1 cliente ahora está sin asignar.");
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
