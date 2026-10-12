import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

/**
 * The assignment controls (F-085 part 1, spec §9). Rendered with
 * `renderToStaticMarkup` + `createElement`, the house form for a client
 * component (team-card.test.ts). What a pick DOES lives in plain async
 * functions (assign-handlers.ts), so the toast, its Undo and a refusal are
 * reached here without a DOM. Radix renders a closed Select's options to
 * nothing on the server, so the option list is a pure function tested on
 * its own and pinned to the Select from source.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const contactActions = vi.hoisted(() => ({ assignContactsAction: vi.fn(), undoAssignContactsAction: vi.fn() }));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions", () => contactActions);
const taskActions = vi.hoisted(() => ({ setTaskAssigneeAction: vi.fn() }));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions", () => taskActions);

const { AssigneeField, ContactAssigneeField, assigneeChoices, assigneeName, NONE } = await import("./assignee-field");
const { applyAssignee, contactAssigneeSave, taskAssigneeSave } = await import("./assign-handlers");
const { WhoFilter } = await import("./who-filter");

const here = path.dirname(fileURLToPath(import.meta.url));
const FIELD_SRC = readFileSync(path.join(here, "assignee-field.tsx"), "utf8");

const ANA = { userId: "11111111-1111-4111-8111-111111111111", label: "Ana Ruiz" };
const TOM = { userId: "22222222-2222-4222-8222-222222222222", label: "tom@rio.test" };
const OPTIONS = [ANA, TOM];
const ACCT = "a0000000-0000-4000-8000-000000000001";
const CONTACT = "c0000000-0000-4000-8000-000000000001";
const TASK = "70000000-0000-4000-8000-000000000001";
const PREVIOUS = [{ contactId: CONTACT, assignee: TOM.userId, target: ANA.userId, movedTaskIds: [TASK] }];

const okSave = () => vi.fn(async () => ({ ok: true as const, undo: null }));
const field = (over: Partial<Parameters<typeof AssigneeField>[0]> = {}) => renderToStaticMarkup(createElement(AssigneeField, {
  label: m["assign.field.label"], value: ANA.userId, options: OPTIONS, readOnly: false, save: okSave(), ...over,
}));

/** The toast's Undo, as sonner would be handed it. */
function undoOf(call: unknown[] | undefined): () => void {
  const opts = call?.[1] as { action?: { label: string; onClick: () => void } } | undefined;
  if (!opts?.action) throw new Error("no Undo action on that toast");
  expect(opts.action.label).toBe(m["assign.undo"]);
  return opts.action.onClick;
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  contactActions.assignContactsAction.mockReset();
  contactActions.undoAssignContactsAction.mockReset();
  taskActions.setTaskAssigneeAction.mockReset();
});

describe("AssigneeField: read-only (a Technician, M4)", () => {
  it("shows the holder's name as text, with no combobox (mutation: ignore readOnly -> FAILS)", () => {
    const html = field({ readOnly: true });
    expect(renderedText(html).trim()).toBe(ANA.label);
    expect(html).not.toContain('role="combobox"');
  });

  it("shows Unassigned as text when nobody holds it", () => {
    const html = field({ readOnly: true, value: null });
    expect(renderedText(html).trim()).toBe(m["assign.unassigned"]);
    expect(html).not.toContain('role="combobox"');
  });
});

describe("AssigneeField: editable", () => {
  it("renders a combobox named by its label, reading as the current holder (mutation: render the read-only text for everyone -> FAILS)", () => {
    const html = field();
    expect(html).toContain('role="combobox"');
    expect(html).toContain(`aria-label="${m["assign.field.label"]}"`);
    expect(renderedText(html)).toContain(ANA.label);
  });

  it("the options are Unassigned first, then each member by label (mutation: drop Unassigned, or put it last -> FAILS)", () => {
    expect(assigneeChoices(OPTIONS)).toEqual([
      { value: NONE, label: m["assign.unassigned"] },
      { value: ANA.userId, label: ANA.label },
      { value: TOM.userId, label: TOM.label },
    ]);
  });

  it("the Select lists exactly those choices and maps Unassigned back to null (mutation: list the members only -> FAILS)", () => {
    expect(FIELD_SRC).toContain("{assigneeChoices(options).map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}");
    expect(FIELD_SRC).toMatch(/onValueChange=\{\(v\) => pick\(v === NONE \? null : v\)\}/);
  });

  it("names a holder the options do not list honestly, never as Unassigned (mutation: fall back to Unassigned -> FAILS)", () => {
    expect(assigneeName(null, OPTIONS)).toBe(m["assign.unassigned"]);
    expect(assigneeName(TOM.userId, OPTIONS)).toBe(TOM.label);
    expect(assigneeName("99999999-9999-4999-8999-999999999999", OPTIONS)).toBe(m["assign.someone"]);
  });

  // DESIGN DoD (phone tap targets, min-h-11 md:min-h-8 the timeline's own idiom): the Technician
  // assignment field (and so TaskAssigneeField, which renders through this same trigger in the
  // record timeline's task rows) was still a fixed h-8.
  it("the trigger is a 44px tap target on a phone, matching the record page's other inline controls (mutation: drop min-h-11 from INLINE_TRIGGER -> FAILS)", () => {
    const html = field();
    const trigger = html.match(/<button[^>]*role="combobox"[^>]*>/)?.[0] ?? "";
    expect(trigger).toMatch(/[\s"]min-h-11[\s"]/);
    expect(trigger).toMatch(/[\s"]md:min-h-8[\s"]/);
  });
});

describe("ContactAssigneeField: 'You' only for the viewer's own customer (fix round 1, I1/M2)", () => {
  const render = (over: Partial<Parameters<typeof ContactAssigneeField>[0]>) => renderToStaticMarkup(createElement(ContactAssigneeField, {
    accountId: ACCT, contactId: CONTACT, value: TOM.userId, options: [], readOnly: true, viewerId: TOM.userId, ...over,
  }));

  it("a read-only viewer who IS the holder reads You, as text (mutation: drop the You option -> FAILS)", () => {
    const html = render({});
    expect(renderedText(html).trim()).toBe(m["assign.you"]);
    expect(html).not.toContain('role="combobox"');
  });

  it("a read-only viewer looking at someone ELSE's customer (an Owner whose role read failed: RLS still shows every customer) reads 'Someone on the team', never You (mutation: You for any unlisted holder -> FAILS)", () => {
    const text = renderedText(render({ viewerId: ANA.userId })).trim();
    expect(text).toBe(m["assign.someone"]);
    expect(text).not.toBe(m["assign.you"]);
  });

  it("a read-only viewer whose own person is unknown (null) never reads You", () => {
    expect(renderedText(render({ viewerId: null })).trim()).toBe(m["assign.someone"]);
  });

  it("an EDITABLE field with an unlisted holder offers no You, even when the holder is the viewer: You is a read-only label, never a choice (mutation: drop the readOnly guard -> FAILS)", () => {
    const UNLISTED = "99999999-9999-4999-8999-999999999999";
    const html = render({ readOnly: false, options: OPTIONS, value: UNLISTED, viewerId: UNLISTED });
    expect(html).toContain('role="combobox"');
    expect(renderedText(html).trim()).toBe(m["assign.someone"]);
    expect(FIELD_SRC).toMatch(/readOnly && value !== null && value === viewerId && !options\.some/);
  });
});

describe("applyAssignee: a pick saves at once, then says so with Undo (rule 6)", () => {
  it("saves the pick, shows it, and toasts 'Assigned to {name}.' with an Undo that runs the save's own undo (mutation: Undo calls save(prior) -> FAILS)", async () => {
    const undo = vi.fn(async () => ({ ok: true as const }));
    const save = vi.fn(async () => ({ ok: true as const, undo }));
    const shown: (string | null)[] = [];
    await applyAssignee(save, ANA.userId, TOM.userId, (id) => assigneeName(id, OPTIONS), (v) => shown.push(v));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(ANA.userId);
    expect(shown).toEqual([ANA.userId]);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]![0]).toBe("Assigned to Ana Ruiz.");
    undoOf(toasts.success.mock.calls[0])();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(shown).toEqual([ANA.userId, TOM.userId]);
  });

  it("unassigning says 'Now unassigned.'", async () => {
    const save = vi.fn(async () => ({ ok: true as const, undo: vi.fn(async () => ({ ok: true as const })) }));
    await applyAssignee(save, null, ANA.userId, (id) => assigneeName(id, OPTIONS), () => {});
    expect(save).toHaveBeenCalledWith(null);
    expect(toasts.success.mock.calls[0]![0]).toBe(m["assign.doneUnassigned"]);
  });

  it("undo: null (nothing changed) shows NO toast (mutation: toast every success -> FAILS)", async () => {
    const save = okSave();
    const shown: (string | null)[] = [];
    await applyAssignee(save, ANA.userId, ANA.userId, (id) => assigneeName(id, OPTIONS), (v) => shown.push(v));
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("a refused save shows the code's own sentence and keeps the old value (mutation: show the pick anyway -> FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "assign.customerFirst" as const }));
    const shown: (string | null)[] = [];
    await applyAssignee(save, TOM.userId, ANA.userId, (id) => assigneeName(id, OPTIONS), (v) => shown.push(v));
    expect(toasts.error).toHaveBeenCalledWith(m["assign.customerFirst"]);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(shown).toEqual([]);
  });

  it("a save that throws (a stale tab) says 'That didn't save', keeps the old value", async () => {
    const save = vi.fn(async () => { throw new Error("stale action id"); });
    const shown: (string | null)[] = [];
    await applyAssignee(save, TOM.userId, ANA.userId, (id) => assigneeName(id, OPTIONS), (v) => shown.push(v));
    expect(toasts.error).toHaveBeenCalledWith(m["assign.failed"]);
    expect(shown).toEqual([]);
  });

  it("a refused Undo says so and leaves the pick on screen", async () => {
    const undo = vi.fn(async () => ({ ok: false as const, error: "assign.refused" as const }));
    const save = vi.fn(async () => ({ ok: true as const, undo }));
    const shown: (string | null)[] = [];
    await applyAssignee(save, ANA.userId, TOM.userId, (id) => assigneeName(id, OPTIONS), (v) => shown.push(v));
    undoOf(toasts.success.mock.calls[0])();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["assign.refused"]);
    expect(shown).toEqual([ANA.userId]);
  });
});

describe("contactAssigneeSave: a customer's save and its exact Undo", () => {
  it("assigns through assignContactsAction(acct, [contactId], next) and its Undo hands undoAssignContactsAction the returned array WHOLE (mutation: Undo calls assignContactsAction -> FAILS)", async () => {
    contactActions.assignContactsAction.mockResolvedValue({ ok: true, previous: PREVIOUS });
    contactActions.undoAssignContactsAction.mockResolvedValue({ ok: true });
    const r = await contactAssigneeSave(ACCT, CONTACT)(ANA.userId);
    expect(contactActions.assignContactsAction).toHaveBeenCalledWith(ACCT, [CONTACT], ANA.userId);
    if (!r.ok || !r.undo) throw new Error("expected an undo");
    expect(await r.undo()).toEqual({ ok: true });
    expect(contactActions.undoAssignContactsAction).toHaveBeenCalledWith(ACCT, PREVIOUS);
    expect(contactActions.undoAssignContactsAction.mock.calls[0]![1]).toBe(PREVIOUS);
    expect(contactActions.assignContactsAction).toHaveBeenCalledTimes(1);
  });

  it("re-picking the current holder (previous = []) is 'nothing changed': undo null, so no toast and no undo call (mutation: always offer Undo -> FAILS)", async () => {
    contactActions.assignContactsAction.mockResolvedValue({ ok: true, previous: [] });
    const r = await contactAssigneeSave(ACCT, CONTACT)(ANA.userId);
    expect(r).toEqual({ ok: true, undo: null });
    await applyAssignee(contactAssigneeSave(ACCT, CONTACT), ANA.userId, ANA.userId, (id) => assigneeName(id, OPTIONS), () => {});
    expect(toasts.success).not.toHaveBeenCalled();
    expect(contactActions.undoAssignContactsAction).not.toHaveBeenCalled();
  });

  it("an Undo that found the customer handed on since shows assign.changed's sentence and leaves the pick on screen (final re-review; mutation: show the old holder anyway -> FAILS)", async () => {
    contactActions.assignContactsAction.mockResolvedValue({ ok: true, previous: PREVIOUS });
    contactActions.undoAssignContactsAction.mockResolvedValue({ ok: false, error: "assign.changed" });
    const shown: (string | null)[] = [];
    await applyAssignee(contactAssigneeSave(ACCT, CONTACT), ANA.userId, TOM.userId, (id) => assigneeName(id, OPTIONS), (v) => shown.push(v));
    undoOf(toasts.success.mock.calls[0])();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["assign.changed"]);
    expect(shown).toEqual([ANA.userId]);
  });

  it("passes a refusal through as it came", async () => {
    contactActions.assignContactsAction.mockResolvedValue({ ok: false, error: "assign.refused" });
    expect(await contactAssigneeSave(ACCT, CONTACT)(null)).toEqual({ ok: false, error: "assign.refused" });
  });

  it("onSaved (the record page's refresh: the customer's tasks moved too) runs after a change, never after nothing changed or a refusal (mutation: call it unconditionally -> FAILS)", async () => {
    const onSaved = vi.fn();
    contactActions.assignContactsAction.mockResolvedValueOnce({ ok: true, previous: PREVIOUS });
    const r = await contactAssigneeSave(ACCT, CONTACT, onSaved)(ANA.userId);
    expect(onSaved).toHaveBeenCalledTimes(1);
    contactActions.assignContactsAction.mockResolvedValueOnce({ ok: true, previous: [] });
    await contactAssigneeSave(ACCT, CONTACT, onSaved)(ANA.userId);
    contactActions.assignContactsAction.mockResolvedValueOnce({ ok: false, error: "assign.refused" });
    await contactAssigneeSave(ACCT, CONTACT, onSaved)(ANA.userId);
    expect(onSaved).toHaveBeenCalledTimes(1);
    // …and once more after its Undo lands (the tasks moved back), not after a refused one.
    if (!r.ok || !r.undo) throw new Error("expected an undo");
    contactActions.undoAssignContactsAction.mockResolvedValueOnce({ ok: false, error: "assign.refused" });
    await r.undo();
    expect(onSaved).toHaveBeenCalledTimes(1);
    contactActions.undoAssignContactsAction.mockResolvedValueOnce({ ok: true });
    await r.undo();
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("ContactAssigneeField saves through contactAssigneeSave for ITS contact (mutation: hand it another save -> FAILS)", () => {
    expect(FIELD_SRC).toContain("save={contactAssigneeSave(accountId, contactId, onSaved)}");
    expect(FIELD_SRC).toContain("save={taskAssigneeSave(accountId, taskId)}");
  });
});

describe("taskAssigneeSave: a task's save and its Undo", () => {
  it("sets through setTaskAssigneeAction(acct, taskId, next); its Undo sets it back to r.previous, only while `next` still holds it (mutations: Undo sets null, or drops the expected holder -> FAILS)", async () => {
    taskActions.setTaskAssigneeAction.mockResolvedValue({ ok: true, previous: TOM.userId });
    const r = await taskAssigneeSave(ACCT, TASK)(ANA.userId);
    expect(taskActions.setTaskAssigneeAction).toHaveBeenCalledWith(ACCT, TASK, ANA.userId);
    if (!r.ok || !r.undo) throw new Error("expected an undo");
    taskActions.setTaskAssigneeAction.mockResolvedValue({ ok: true, previous: ANA.userId });
    expect(await r.undo()).toEqual({ ok: true });
    expect(taskActions.setTaskAssigneeAction).toHaveBeenLastCalledWith(ACCT, TASK, TOM.userId, ANA.userId);
  });

  it("an Undo after someone picked the task since comes back as assign.changed, the later pick standing (final review M7)", async () => {
    taskActions.setTaskAssigneeAction.mockResolvedValueOnce({ ok: true, previous: TOM.userId });
    const r = await taskAssigneeSave(ACCT, TASK)(null);
    if (!r.ok || !r.undo) throw new Error("expected an undo");
    taskActions.setTaskAssigneeAction.mockResolvedValueOnce({ ok: false, error: "assign.changed" });
    expect(await r.undo()).toEqual({ ok: false, error: "assign.changed" });
    expect(taskActions.setTaskAssigneeAction).toHaveBeenLastCalledWith(ACCT, TASK, TOM.userId, null);
  });

  it("the same holder again is 'nothing changed': undo null (mutation: always offer Undo -> FAILS)", async () => {
    taskActions.setTaskAssigneeAction.mockResolvedValue({ ok: true, previous: ANA.userId });
    expect(await taskAssigneeSave(ACCT, TASK)(ANA.userId)).toEqual({ ok: true, undo: null });
  });

  it("a refused Undo comes back as the refusal", async () => {
    taskActions.setTaskAssigneeAction.mockResolvedValueOnce({ ok: true, previous: null });
    const r = await taskAssigneeSave(ACCT, TASK)(ANA.userId);
    if (!r.ok || !r.undo) throw new Error("expected an undo");
    taskActions.setTaskAssigneeAction.mockResolvedValueOnce({ ok: false, error: "assign.refused" });
    expect(await r.undo()).toEqual({ ok: false, error: "assign.refused" });
    expect(taskActions.setTaskAssigneeAction).toHaveBeenLastCalledWith(ACCT, TASK, null, ANA.userId);
  });
});

describe("WhoFilter: All · Mine · Unassigned (spec §9)", () => {
  const BASE = "/dashboard/accounts/a1/contacts";
  const render = (over: Partial<Parameters<typeof WhoFilter>[0]> = {}) => renderToStaticMarkup(createElement(WhoFilter, {
    base: BASE, current: "all", showMine: true, params: { q: "ana", sort: "name", dir: "asc" }, ...over,
  }));
  const links = (html: string) => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((x) => x[0]);
  const hrefOf = (a: string) => a.match(/href="([^"]*)"/)![1]!.replace(/&amp;/g, "&");

  it("is a nav named 'Show' holding the three links in order (mutation: drop the nav's label -> FAILS)", () => {
    const html = render();
    expect(html).toMatch(new RegExp(`^<nav[^>]*aria-label="${m["assign.filter.label"]}"`));
    expect(links(html).map((a) => renderedText(a).trim())).toEqual([
      m["assign.filter.all"], m["assign.filter.mine"], m["assign.unassigned"],
    ]);
  });

  it("marks only the current one aria-current=\"page\" (mutation: mark All always -> FAILS)", () => {
    const html = render({ current: "mine" });
    const marked = links(html).filter((a) => a.includes('aria-current="page"'));
    expect(marked).toHaveLength(1);
    expect(renderedText(marked[0]!).trim()).toBe(m["assign.filter.mine"]);
  });

  it("each href keeps the search and sort, sets who, and never carries before (mutation: carry the cursor -> FAILS)", () => {
    const [all, mine, unassigned] = links(render()).map(hrefOf);
    const qs = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");
    expect(all!.split("?")[0]).toBe(BASE);
    expect(qs(all!).get("who")).toBeNull();
    expect(qs(mine!).get("who")).toBe("mine");
    expect(qs(unassigned!).get("who")).toBe("unassigned");
    for (const h of [all!, mine!, unassigned!]) {
      expect(qs(h).get("q")).toBe("ana");
      expect(qs(h).get("sort")).toBe("name");
      expect(qs(h).get("before")).toBeNull();
    }
  });

  it("All with no other params is the bare base, never a dangling '?'", () => {
    expect(hrefOf(links(render({ params: {} }))[0]!)).toBe(BASE);
  });

  it("without showMine (the agency, never a member here), there is no Mine link (mutation: always show Mine -> FAILS)", () => {
    const labels = links(render({ showMine: false })).map((a) => renderedText(a).trim());
    expect(labels).toEqual([m["assign.filter.all"], m["assign.unassigned"]]);
  });

  it("wraps rather than overflow at phone width, and each link has a visible focus ring (DoD)", () => {
    const html = render();
    expect(html).toMatch(/^<nav[^>]*class="[^"]*flex-wrap[^"]*min-w-0|^<nav[^>]*class="[^"]*min-w-0[^"]*flex-wrap/);
    for (const a of links(html)) expect(a).toContain("focus-visible:ring-2");
  });
});

describe("copy", () => {
  it("every assign.* key has its Spanish twin (usted)", () => {
    const keys = Object.keys(m).filter((k) => k.startsWith("assign.") && !k.endsWith(".es"));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const k of keys) expect((m as Record<string, string>)[`${k}.es`], k).toBeTruthy();
    expect((m as Record<string, string>)["assign.filter.mine.es"]).toBe("A mi cargo");
  });
});
