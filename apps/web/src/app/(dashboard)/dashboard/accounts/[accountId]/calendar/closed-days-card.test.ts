import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { UNDO_WINDOW_MS } from "./undo-window";
import {
  ClosedDaysCard, runAddClosedDay, runRemoveClosedDay, runKeepAppointment,
  type ClosedDaysRangeView,
} from "./closed-days-card";
import type { AddClosedDayResult, RemoveClosedDayResult } from "./closed-days-actions";
import type { ActionResult } from "./actions";

// S-47d Task 12 (spec 5.6.3). Render tests use `renderToStaticMarkup` + `createElement` directly — the
// house device for a "use client" component with hooks (bookings-list.test.ts, calendar-settings.test.ts):
// no .tsx test convention exists in this repo. `useRouter` needs a stub (record-card-boundary.test.ts's
// own precedent) — nothing else here reaches a Next context.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function fakeToast() {
  let undo: (() => void) | null = null;
  return {
    toast: {
      success: vi.fn((_msg: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => {
        undo = opts?.action?.onClick ?? null;
        return "toast_1";
      }),
      error: vi.fn(),
    },
    clickUndo: () => undo?.(),
  };
}

describe("runAddClosedDay — addClosedDayAction minus React", () => {
  const added = (appointments = 0): (() => Promise<AddClosedDayResult>) =>
    async () => ({ ok: true, id: "cd_1", appointments, todoFiled: appointments > 0 });

  it("toasts closedDays.added alone when nothing is affected (mutation: always append addedTodo → FAILS)", async () => {
    const { toast } = fakeToast();
    const r = await runAddClosedDay(added(0), async () => ({ ok: true, removed: { from: "a", to: "a", reason: null } }), toast, "en");
    expect(r).toEqual({ ok: true, id: "cd_1", appointments: 0, todoFiled: false });
    expect(toast.success).toHaveBeenCalledWith(
      m["closedDays.added"],
      { action: { label: m["common.undo"], onClick: expect.any(Function) }, duration: UNDO_WINDOW_MS },
    );
  });

  it("appends addedTodo with the real count when appointments are affected (mutation: drop the count → FAILS)", async () => {
    const { toast } = fakeToast();
    await runAddClosedDay(added(3), async () => ({ ok: true, removed: { from: "a", to: "a", reason: null } }), toast, "en");
    expect(toast.success.mock.calls[0]![0]).toBe(`${m["closedDays.added"]} ${m["closedDays.addedTodo"].replace("{n}", "3")}`);
  });

  it("a refusal toasts the action's own error and never calls Undo's remove (mutation: toast a generic message → FAILS)", async () => {
    const { toast } = fakeToast();
    const remove = vi.fn();
    const r = await runAddClosedDay(async () => ({ ok: false, error: "nope" }), remove, toast, "en");
    expect(r).toEqual({ ok: false, error: "nope" });
    expect(toast.error).toHaveBeenCalledWith("nope");
    expect(remove).not.toHaveBeenCalled();
  });

  it("Undo calls removeClosedDayAction with the stored id (mutation: call it with a hard-coded id → FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const remove = vi.fn(async (id: string): Promise<RemoveClosedDayResult> => ({ ok: true, removed: { from: id, to: id, reason: null } }));
    await runAddClosedDay(added(0), remove, toast, "en");
    clickUndo();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith("cd_1");
  });
});

describe("runRemoveClosedDay — removeClosedDayAction minus React", () => {
  const REMOVED: RemoveClosedDayResult = { ok: true, removed: { from: "2027-06-10", to: "2027-06-12", reason: "vacation" } };

  it("toasts closedDays.removed with an Undo action (mutation: drop the action → FAILS)", async () => {
    const { toast } = fakeToast();
    const ok = await runRemoveClosedDay(async () => REMOVED, async () => ({ ok: true, id: "x", appointments: 0, todoFiled: false }), toast, "en");
    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(
      m["closedDays.removed"],
      { action: { label: m["common.undo"], onClick: expect.any(Function) }, duration: UNDO_WINDOW_MS },
    );
  });

  it("Undo calls addClosedDayAction with the exact removed range AND restore: true (mutation: drop restore → FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const undoAdd = vi.fn(async () => ({ ok: true as const, id: "new", appointments: 0, todoFiled: false }));
    await runRemoveClosedDay(async () => REMOVED, undoAdd, toast, "en");
    clickUndo();
    await Promise.resolve();
    expect(undoAdd).toHaveBeenCalledWith({ from: "2027-06-10", to: "2027-06-12", reason: "vacation", restore: true });
  });

  it("a refusal toasts the error and answers false (mutation: answer true on refusal → FAILS)", async () => {
    const { toast } = fakeToast();
    const ok = await runRemoveClosedDay(async () => ({ ok: false, error: "nope" }), async () => ({ ok: true, id: "x", appointments: 0, todoFiled: false }), toast, "en");
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("nope");
  });
});

describe("runKeepAppointment — keepAppointmentAction minus React", () => {
  it("toasts business.card.keptToast on success, with Undo calling the SAME action with kept: false (mutation: Undo calls kept: true again → FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const setKept = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    const ok = await runKeepAppointment(setKept, toast, "en");
    expect(ok).toBe(true);
    expect(setKept).toHaveBeenCalledWith(true);
    expect(toast.success).toHaveBeenCalledWith(
      m["business.card.keptToast"],
      { action: { label: m["common.undo"], onClick: expect.any(Function) }, duration: UNDO_WINDOW_MS },
    );
    clickUndo();
    await Promise.resolve();
    expect(setKept).toHaveBeenLastCalledWith(false);
  });

  it("a refusal toasts the error and answers false", async () => {
    const { toast } = fakeToast();
    const ok = await runKeepAppointment(async () => ({ ok: false, error: m["business.refuse.role"] }), toast, "en");
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(m["business.refuse.role"]);
  });
});

// ── The card itself ──────────────────────────────────────────────────────

const RANGE_NO_APPTS: ClosedDaysRangeView = {
  id: "cd_1", startsOn: "2026-12-10", endsOn: "2026-12-14", reason: null, appointments: [],
};
const APPT = {
  id: "bk_1", contactId: "c_1", contactName: "Ana Reyes", startsAt: "2026-12-11T15:00:00.000Z", kept: false, held: 0,
};
const RANGE_WITH_APPTS: ClosedDaysRangeView = {
  id: "cd_2", startsOn: "2026-12-28", endsOn: "2027-01-01", reason: "vacation", appointments: [APPT],
};

const BASE = {
  accountId: "a1", locale: "en" as const, canManage: true, canAct: true, persona: "Sofía" as string | null,
  today: "2026-12-01", timezone: "America/Chicago",
  initialOpenClosedDay: null as string | null,
  addAction: async () => ({ ok: true as const, id: "cd_new", appointments: 0, todoFiled: false }),
  removeAction: async () => ({ ok: true as const, removed: { from: "a", to: "a", reason: null } }),
  keepAction: async () => ({ ok: true as const }),
};

function render(
  overrides: Partial<Parameters<typeof ClosedDaysCard>[0]> & { ranges: ClosedDaysRangeView[] | null },
): string {
  return renderToStaticMarkup(createElement(ClosedDaysCard, { ...BASE, ...overrides }));
}

describe("ClosedDaysCard — loaded", () => {
  it("an Owner/the agency sees the Add form and a Remove for each range (mutation: hide canManage's gate → the Staff case below would also show it)", () => {
    const html = render({ canManage: true, ranges: [RANGE_NO_APPTS] });
    expect(renderedText(html)).toContain(m["closedDays.add"]);
    expect(renderedText(html)).toContain(m["closedDays.remove"]);
  });

  it("Staff (canManage: false) sees no Add form and no Remove, but the range's appointment list still opens (mutation: gate the toggle on canManage too → FAILS)", () => {
    const html = render({ canManage: false, ranges: [RANGE_WITH_APPTS], initialOpenClosedDay: "2026-12-28" });
    const text = renderedText(html);
    expect(text).not.toContain(m["closedDays.add"]);
    expect(text).not.toContain(m["closedDays.remove"]);
    // The list still opened from `?closedDay=` and shows the appointment row with Keep.
    expect(text).toContain("Ana Reyes");
    expect(text).toContain(m["business.card.keep"]);
    expect(text).toContain(m["business.card.cancelOnCalendar"]);
  });

  it("formats a one-day range as the pinned literal, with its reason after ' · ' (English)", () => {
    const oneDay: ClosedDaysRangeView = { id: "cd_3", startsOn: "2026-12-24", endsOn: "2026-12-24", reason: "holiday", appointments: [] };
    const html = render({ ranges: [oneDay] });
    expect(renderedText(html)).toContain(`Thursday, December 24 · ${m["business.reason.holiday"]}`);
  });

  it("formats a cross-year range as the pinned literal (mutation: use the same-month template → FAILS)", () => {
    const html = render({ ranges: [RANGE_WITH_APPTS] });
    expect(renderedText(html)).toContain(`Dec 28 – Jan 1 · ${m["business.reason.vacation"]}`);
  });

  it("the no-reason form drops the ' · …' suffix entirely (mutation: always append a suffix → FAILS)", () => {
    const html = render({ ranges: [RANGE_NO_APPTS] });
    const text = renderedText(html);
    expect(text).toContain("Dec 10 – 14");
    expect(text).not.toContain("Dec 10 – 14 ·");
  });

  it("a range with no appointments shows no count toggle (mutation: always show it → FAILS)", () => {
    const html = render({ ranges: [RANGE_NO_APPTS] });
    expect(renderedText(html)).not.toMatch(/\d+ appointment/);
  });

  it("a range with appointments shows the count as a toggle, closed by default", () => {
    const html = render({ ranges: [RANGE_WITH_APPTS] });
    const text = renderedText(html);
    expect(text).toContain(m["closedDays.countOne"]);
    expect(text).not.toContain("Ana Reyes");
  });

  it("?closedDay= opens the matching range's list without a click (mutation: ignore initialOpenClosedDay → FAILS)", () => {
    const html = render({ ranges: [RANGE_NO_APPTS, RANGE_WITH_APPTS], initialOpenClosedDay: "2026-12-28" });
    expect(renderedText(html)).toContain("Ana Reyes");
  });

  it("renders in Spanish with lang set on the card's root (mutation: drop lang → FAILS)", () => {
    const html = render({ locale: "es", ranges: [RANGE_NO_APPTS] });
    expect(html).toMatch(/<div[^>]*lang="es"/);
    expect(renderedText(html)).toContain(m["closedDays.add.es"]);
  });
});

describe("ClosedDaysCard — empty", () => {
  it("shows closedDays.empty with the persona substituted, and the Add form for an Owner", () => {
    const html = render({ ranges: [], persona: "Sofía", canManage: true });
    expect(renderedText(html)).toContain(m["closedDays.empty"].replace("{persona}", "Sofía"));
    expect(renderedText(html)).toContain(m["closedDays.add"]);
  });

  it("Staff sees only the sentence, no form (mutation: show the form regardless of canManage → FAILS)", () => {
    const html = render({ ranges: [], canManage: false });
    expect(renderedText(html)).not.toContain(m["closedDays.add"]);
  });
});

describe("ClosedDaysCard — error", () => {
  it("shows closedDays.error and never the Add form, even for an Owner (mutation: fall through to the loaded branch → FAILS)", () => {
    const html = render({ ranges: null, canManage: true });
    const text = renderedText(html);
    expect(text).toContain(m["closedDays.error"]);
    expect(text).not.toContain(m["closedDays.add"]);
  });
});

// ── Fix round (S-47d final review) ───────────────────────────────────────

const flush = () => new Promise((r) => setTimeout(r, 0));
const cardSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "closed-days-card.tsx"), "utf8");
const words = (html: string) => renderedText(html).replace(/\s+/g, " ");

/** C5 (design I6 + final M-3): every Undo re-reads the page and drops the card's local overrides, or a
 *  removed-then-restored range stays hidden and an un-kept appointment keeps reading "Kept". */
describe("the Undo of every action refreshes the card (fix round C5)", () => {
  it("Undo of Remove: onUndone runs once the re-add succeeds (mutation: drop the onUndone call -> FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const onUndone = vi.fn();
    await runRemoveClosedDay(
      async () => ({ ok: true, removed: { from: "2027-06-10", to: "2027-06-12", reason: null } }),
      async () => ({ ok: true as const, id: "new", appointments: 0, todoFiled: false }),
      toast, "en", { onUndone },
    );
    expect(onUndone).not.toHaveBeenCalled();
    clickUndo();
    await flush();
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("Undo of Remove that is refused: no refresh, the error toasted", async () => {
    const { toast, clickUndo } = fakeToast();
    const onUndone = vi.fn();
    await runRemoveClosedDay(
      async () => ({ ok: true, removed: { from: "2027-06-10", to: "2027-06-12", reason: null } }),
      async () => ({ ok: false as const, error: "nope" }),
      toast, "en", { onUndone },
    );
    clickUndo();
    await flush();
    expect(onUndone).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("nope");
  });

  it("Undo of Add: onUndone runs once the remove succeeds (mutation: drop the onUndone call -> FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const onUndone = vi.fn();
    await runAddClosedDay(
      async () => ({ ok: true, id: "cd_1", appointments: 0, todoFiled: false }),
      async () => ({ ok: true, removed: { from: "a", to: "a", reason: null } }),
      toast, "en", { onUndone },
    );
    clickUndo();
    await flush();
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("Undo of Keep: onUndone runs once the un-keep succeeds (mutation: drop the onUndone call -> FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const onUndone = vi.fn();
    await runKeepAppointment(async () => ({ ok: true }), toast, "en", { onUndone });
    clickUndo();
    await flush();
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("the card wires onUndone to clear BOTH local overrides and refresh (source pin)", () => {
    expect(cardSrc).toMatch(/const onUndone = \(\) => \{\s*setHiddenIds\(\{\}\);\s*setKeptOverride\(\{\}\);\s*router\.refresh\(\);\s*\};/);
    expect(cardSrc.match(/\{ pseudo, onUndone \}/g)?.length).toBe(3);
  });
});

describe("toasts (fix round D2, D5, D6)", () => {
  it("one affected appointment reads the singular (D2; mutation: always the plural -> FAILS)", async () => {
    const { toast } = fakeToast();
    await runAddClosedDay(
      async () => ({ ok: true, id: "cd_1", appointments: 1, todoFiled: true }),
      async () => ({ ok: true, removed: { from: "a", to: "a", reason: null } }), toast, "en",
    );
    expect(toast.success.mock.calls[0]![0]).toBe(`${m["closedDays.added"]} ${m["closedDays.addedTodoOne"]}`);
  });

  it("a Keep that throws says Keep failed, never the status sentence (D5)", async () => {
    const { toast } = fakeToast();
    const ok = await runKeepAppointment(async () => { throw new Error("network"); }, toast, "es");
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(m["business.card.keepFailed.es"]);
  });

  it("the pseudo-locale wraps every toast (D6)", async () => {
    const { toast } = fakeToast();
    await runRemoveClosedDay(
      async () => ({ ok: true, removed: { from: "a", to: "a", reason: null } }),
      async () => ({ ok: true as const, id: "new", appointments: 0, todoFiled: false }), toast, "en", { pseudo: true },
    );
    const [msg, opts] = toast.success.mock.calls[0]! as unknown as [string, { action: { label: string } }];
    expect(msg).not.toBe(m["closedDays.removed"]);
    expect(msg.length).toBeGreaterThan(m["closedDays.removed"].length);
    expect(opts.action.label).not.toBe(m["common.undo"]);
  });
});

describe("ClosedDaysCard — the affected rows (fix round C4, C5, C8, D9)", () => {
  const OPEN = { initialOpenClosedDay: "2026-12-28" };

  it("rows are the shared AffectedAppointmentRow: \"when · name\", in the ACCOUNT's zone and the card's language (C4; mutation: format en-US in the runtime zone -> FAILS)", () => {
    expect(words(render({ ...OPEN, ranges: [RANGE_WITH_APPTS] }))).toContain("Dec 11, 9:00 AM · Ana Reyes");
    expect(words(render({ ...OPEN, locale: "es", ranges: [RANGE_WITH_APPTS] }))).toContain("11 de dic., 9:00 AM · Ana Reyes");
    expect(words(render({ ...OPEN, timezone: "America/Los_Angeles", ranges: [RANGE_WITH_APPTS] }))).toContain("Dec 11, 7:00 AM · Ana Reyes");
  });

  it("\"{n} messages waiting\" shows on the Calendar too (C8)", () => {
    const withHeld = { ...RANGE_WITH_APPTS, appointments: [{ ...APPT, held: 2 }] };
    expect(words(render({ ...OPEN, ranges: [withHeld] }))).toContain("2 messages waiting");
  });

  it("a kept appointment reads \"Kept\" as text, never a button (C5; mutation: render the Keep button with a Kept label -> FAILS)", () => {
    const kept = { ...RANGE_WITH_APPTS, appointments: [{ ...APPT, kept: true }] };
    const html = render({ ...OPEN, ranges: [kept] });
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${m["business.card.kept"]}</button>`));
    expect(html).toMatch(new RegExp(`<span[^>]*>${m["business.card.kept"]}</span>`));
  });

  it("a Technician (canAct false) sees the rows with neither Keep nor \"Cancel on the calendar\" (C5; mutation: ignore canAct -> FAILS)", () => {
    const text = words(render({ ...OPEN, canManage: false, canAct: false, ranges: [RANGE_WITH_APPTS] }));
    expect(text).toContain("Ana Reyes");
    expect(text).not.toContain(m["business.card.keep"]);
    expect(text).not.toContain(m["business.card.cancelOnCalendar"]);
  });

  it("the count toggle names its list: aria-expanded and aria-controls (D9; mutation: drop either -> FAILS)", () => {
    const closed = render({ ranges: [RANGE_WITH_APPTS] });
    expect(closed).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="closed-day-cd_2-appointments"/);
    const open = render({ ...OPEN, ranges: [RANGE_WITH_APPTS] });
    expect(open).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="closed-day-cd_2-appointments"/);
    expect(open).toContain('id="closed-day-cd_2-appointments"');
  });
});

describe("ClosedDaysCard — no persona to name, the pseudo-locale, and the Select's lang (fix round D3, D6, C3)", () => {
  it("no voice profile (persona null): the sentence names no one (D3, SD19; mutation: default to a typed persona -> FAILS)", () => {
    const text = words(render({ ranges: [], persona: null }));
    expect(text).toContain(m["closedDays.emptyNoPersona"]);
    expect(text).not.toMatch(/Sofía|Sofia/);
  });

  it("the pseudo-locale wraps the card's own words (D6; mutation: ignore pseudo -> FAILS)", () => {
    const text = words(render({ ranges: [RANGE_NO_APPTS], pseudo: true }));
    expect(text).not.toContain(m["closedDays.title"]);
    expect(text).not.toContain(m["closedDays.add"]);
  });

  it("the Reason Select's portaled content carries lang={locale} (C3; source pin: Radix mounts it only while open)", () => {
    expect(cardSrc).toMatch(/<SelectContent lang=\{locale\}>/);
  });
});
