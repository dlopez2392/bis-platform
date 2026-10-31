import { describe, expect, it, vi } from "vitest";
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import { formatWhen } from "@/lib/booking/time";
import { agendaTime } from "@/lib/booking/agenda-window";
import { UNDO_WINDOW_MS } from "./undo-window";
import {
  submitJob, warningLines, withExistingCustomer, noticeReason, LENGTH_OPTIONS,
  sheetDraft, addingAsNew, typedCustomer, phoneOwnerWords,
  type AddRun, type MoveRun, type JobToast, type OpenedSnapshot, type SheetCustomer,
} from "./job-sheet-handlers";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { JobDraft, JobFields, JobOpened, JobWarningView } from "./agenda-actions";

/**
 * F-046 part 1 (plan Task 11): what the Add job sheet (and Move, the same form) DOES, as plain async functions
 * (feed-card-handlers.ts's and cancel-booking.ts's shape), so the confirm-in-place warnings, the phone owner's
 * offer, the toast's words, its Undo and the Undo's own window are reached without React.
 */

const ACCOUNT = "acct_1";
const TZ = "America/Chicago";
const STARTS = "2026-11-03T16:00:00.000Z"; // Tue 10:00 AM CST
const OPENED: JobOpened = { startsAt: STARTS, endsAt: "2026-11-03T17:00:00.000Z", note: "Fix a leak", placeId: null, meetingType: null, meetingUrl: null };
/** What the form opened with, plus whether the customer had been told then (T10 review I2: the move decides
 *  the "moved" email against what the person SAW). */
const SNAPSHOT: OpenedSnapshot = { ...OPENED, told: true };
const FIELDS: JobFields = { date: "2026-11-03", start: "10:00", minutes: 60, what: "Fix a leak", placeId: null, meetingType: "in_person", notify: true };
const DRAFT: JobDraft = { ...FIELDS, customer: { kind: "existing", id: "11111111-1111-4111-8111-111111111111" } };
const W_HOURS: JobWarningView = { key: "outside_hours", kind: "outside_hours" };
const W_OVER: JobWarningView = { key: "overlaps:a,b", kind: "overlaps", count: 2, at: "2026-11-03T15:30:00.000Z" };

type SuccessOpts = { action: { label: string; onClick: () => void }; duration: number };
function fakeToast() {
  return {
    success: vi.fn<(message: string, opts?: SuccessOpts) => string>(() => "toast_1"),
    error: vi.fn<(message: string) => unknown>(),
    dismiss: vi.fn<(id?: string | number) => unknown>(),
  } satisfies JobToast;
}
function fakeSchedule() {
  const jobs: { fn: () => void; ms: number }[] = [];
  return { schedule: (fn: () => void, ms: number) => { jobs.push({ fn, ms }); }, jobs };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function addRun(over: Partial<AddRun> = {}): AddRun {
  return {
    mode: "add", accountId: ACCOUNT, timezone: TZ, locale: "en", draft: DRAFT, seen: [],
    toast: fakeToast(), schedule: fakeSchedule().schedule,
    add: vi.fn(async () => ({ ok: true as const, bookingId: "b_new", startsAt: STARTS, first: "Ana", notice: "scheduled" as const })),
    undoAdd: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}
function moveRun(over: Partial<MoveRun> = {}): MoveRun {
  return {
    mode: "move", accountId: ACCOUNT, timezone: TZ, locale: "en", bookingId: "b_old", draft: { ...FIELDS, opened: SNAPSHOT }, seen: [],
    toast: fakeToast(), schedule: fakeSchedule().schedule,
    move: vi.fn(async () => ({ ok: true as const, mode: "moved" as const, newId: "b_new", oldId: "b_old", cancelledAt: "2026-11-01T12:00:00.123456+00:00", startsAt: STARTS, first: "Ana", notice: "scheduled" as const })),
    undoEdit: vi.fn(async () => ({ ok: true as const })),
    undoMove: vi.fn(async () => ({ ok: true as const, startsAt: OPENED.startsAt })),
    ...over,
  };
}

describe("submitJob: confirm in place (spec 5.4, R3)", () => {
  it("needs.warnings answers the lines to show, the 'anyway' button and the keys it showed; the next press sends exactly those keys (mutation: send no seen -> FAILS)", async () => {
    const add = vi.fn()
      .mockResolvedValueOnce({ ok: false, needs: { warnings: [W_HOURS, W_OVER] } })
      .mockResolvedValueOnce({ ok: true, bookingId: "b_new", startsAt: STARTS, first: "Ana", notice: "none" });
    const first = await submitJob(addRun({ add }));
    expect(first).toEqual({
      kind: "warnings", warnings: [W_HOURS, W_OVER], seen: ["outside_hours", "overlaps:a,b"], button: "calendar.job.saveAnyway",
      lines: [m["calendar.job.warn.outsideHours"], m["calendar.job.warn.overlaps"].replace("{count}", "2")],
    });
    expect(add.mock.calls[0]![2]).toEqual([]);
    if (first.kind !== "warnings") throw new Error("unreachable");
    const second = await submitJob(addRun({ add, seen: first.seen }));
    expect(add.mock.calls[1]![2]).toEqual(["outside_hours", "overlaps:a,b"]);
    expect(second).toEqual({ kind: "saved" });
  });

  it("a move's warnings make the button 'Move it anyway' (mutation: always saveAnyway -> FAILS)", async () => {
    const move = vi.fn<MoveRun["move"]>(async () => ({ ok: false as const, needs: { warnings: [W_HOURS] } }));
    const r = await submitJob(moveRun({ move }));
    expect(r).toMatchObject({ kind: "warnings", button: "calendar.job.moveAnyway", seen: ["outside_hours"] });
    expect(move).toHaveBeenCalledWith(ACCOUNT, "b_old", { ...FIELDS, opened: SNAPSHOT }, []);
    expect(move.mock.calls[0]![2].opened.told).toBe(true);
  });

  it("a move answered calendar.job.changed (the customer's told state moved under the form) is flagged so the form re-reads the job and redraws the tick, never saved silently (T10 review I2; mutation: drop the flag -> FAILS)", async () => {
    const toast = fakeToast();
    const r = await submitJob(moveRun({ toast, move: vi.fn(async () => ({ ok: false as const, errorKey: "calendar.job.changed" as const })) }));
    expect(r).toEqual({ kind: "error", message: m["calendar.job.changed"], changed: true });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("needs.phoneOwner answers the two-button offer and toasts nothing (R8)", async () => {
    const toast = fakeToast();
    const owner = { id: "22222222-2222-4222-8222-222222222222", name: "Ana García", first: "Ana" };
    const r = await submitJob(addRun({ toast, add: vi.fn(async () => ({ ok: false as const, needs: { phoneOwner: owner } })) }));
    expect(r).toEqual({ kind: "phoneOwner", owner });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("an errorKey answers its sentence in the sheet's language, and a throw the crashed sentence", async () => {
    const past = await submitJob(addRun({ locale: "es", add: vi.fn(async () => ({ ok: false as const, errorKey: "calendar.job.past" as const })) }));
    expect(past).toEqual({ kind: "error", message: m["calendar.job.past.es"] });
    const crashed = await submitJob(addRun({ add: vi.fn(async () => { throw new Error("stale"); }) }));
    expect(crashed).toEqual({ kind: "error", message: m["common.actionCrashed"] });
  });
});

describe("submitJob: the add's toast and its Undo (R9, rule 6)", () => {
  it("a scheduled notice says the confirmation goes when the toast closes, with the time in the account's zone, and carries Undo for EXACTLY the Undo window (mutation: duration 4000 -> FAILS)", async () => {
    const toast = fakeToast();
    await submitJob(addRun({ toast }));
    const when = formatWhen(new Date(STARTS), TZ, "en");
    expect(toast.success).toHaveBeenCalledWith(
      t(m, "calendar.job.added", "en", { first: "Ana", when }),
      { action: { label: m["calendar.job.undo"], onClick: expect.any(Function) }, duration: UNDO_WINDOW_MS },
    );
  });

  it("the toast is dismissed when the window ends, even if hovered (cancel-booking.ts's rule; mutation: drop the dismiss -> FAILS)", async () => {
    const toast = fakeToast();
    const { schedule, jobs } = fakeSchedule();
    await submitJob(addRun({ toast, schedule }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.ms).toBe(UNDO_WINDOW_MS);
    jobs[0]!.fn();
    expect(toast.dismiss).toHaveBeenCalledWith("toast_1");
  });

  it("no notice: the quiet sentence; no email on file and a blocked address each add their own line (mutation: 'added' for every notice -> FAILS)", async () => {
    const when = formatWhen(new Date(STARTS), TZ, "es");
    const quiet = t(m, "calendar.job.addedQuiet", "es", { first: "Ana", when });
    for (const [notice, extra] of [
      ["none", null], ["no_email", t(m, "calendar.job.noEmail", "es", { first: "Ana" })], ["address_blocked", t(m, "calendar.job.emailBlocked", "es", { first: "Ana" })],
    ] as const) {
      const toast = fakeToast();
      await submitJob(addRun({ toast, locale: "es", add: vi.fn(async () => ({ ok: true as const, bookingId: "b", startsAt: STARTS, first: "Ana", notice })) }));
      expect(toast.success.mock.calls[0]![0]).toBe(extra ? `${quiet} ${extra}` : quiet);
    }
  });

  it("a customer with no first name reads as 'the customer', never an empty gap", async () => {
    const toast = fakeToast();
    await submitJob(addRun({ toast, add: vi.fn(async () => ({ ok: true as const, bookingId: "b", startsAt: STARTS, first: "", notice: "none" as const })) }));
    expect(toast.success.mock.calls[0]![0]).toContain(`for ${m["calendar.job.customerFallback"]},`);
  });

  it("Undo calls undoAddJobAction(accountId, bookingId) and says the job was removed; a refusal says its own sentence with the first name", async () => {
    const toast = fakeToast();
    const undoAdd = vi.fn(async () => ({ ok: true as const }));
    await submitJob(addRun({ toast, undoAdd }));
    (toast.success.mock.calls[0]![1] as SuccessOpts).action.onClick();
    await flush();
    expect(undoAdd).toHaveBeenCalledWith(ACCOUNT, "b_new");
    expect(toast.success.mock.calls[1]![0]).toBe(t(m, "calendar.job.undone", "en", { first: "Ana" }));

    const toast2 = fakeToast();
    await submitJob(addRun({ toast: toast2, undoAdd: vi.fn(async () => ({ ok: false as const, errorKey: "calendar.job.undoTooLate" as const, fallback: true as const })) }));
    (toast2.success.mock.calls[0]![1] as SuccessOpts).action.onClick();
    await flush();
    expect(toast2.error).toHaveBeenCalledWith(t(m, "calendar.job.undoTooLate", "en", { first: "Ana" }));
  });
});

describe("submitJob: Move's two results (D6)", () => {
  it("edited: 'Job updated.' with an Undo that calls undoEditJobAction(accountId, id, from, to)", async () => {
    const toast = fakeToast();
    const to: JobOpened = { ...OPENED, note: "Fix two leaks" };
    const undoEdit = vi.fn(async () => ({ ok: true as const }));
    const r = await submitJob(moveRun({ toast, undoEdit, move: vi.fn(async () => ({ ok: true as const, mode: "edited" as const, from: OPENED, to })) }));
    expect(r).toEqual({ kind: "saved" });
    const [msg, opts] = toast.success.mock.calls[0]! as [string, SuccessOpts];
    expect(msg).toBe(m["calendar.job.edited"]);
    expect(opts.duration).toBe(UNDO_WINDOW_MS);
    opts.action.onClick();
    await flush();
    expect(undoEdit).toHaveBeenCalledWith(ACCOUNT, "b_old", OPENED, to);
    // The Undo's own sentence says the changes were undone (mutation: reuse statusUpdated -> FAILS).
    expect(toast.success.mock.calls[1]![0]).toBe(m["calendar.job.editUndone"]);
  });

  it("moved: the new time's sentence, and Undo calls undoMoveJobAction(accountId, newId, oldId, cancelledAt) in that order (mutation: old id first -> FAILS)", async () => {
    const toast = fakeToast();
    const undoMove = vi.fn(async () => ({ ok: true as const, startsAt: OPENED.startsAt }));
    // `moved`: the drawer closes, because the job it shows is now the replaced row (mutation: plain saved -> FAILS).
    expect(await submitJob(moveRun({ toast, undoMove }))).toEqual({ kind: "saved", moved: true });
    const when = formatWhen(new Date(STARTS), TZ, "en");
    const [msg, opts] = toast.success.mock.calls[0]! as [string, SuccessOpts];
    expect(msg).toBe(t(m, "calendar.job.moved", "en", { when, first: "Ana" }));
    expect(opts.duration).toBe(UNDO_WINDOW_MS);
    opts.action.onClick();
    await flush();
    expect(undoMove).toHaveBeenCalledWith(ACCOUNT, "b_new", "b_old", "2026-11-01T12:00:00.123456+00:00");
    expect(toast.success.mock.calls[1]![0]).toBe(t(m, "calendar.job.moveUndone", "en", { when: formatWhen(new Date(OPENED.startsAt), TZ, "en") }));
  });

  it("moved with no notice reads the quiet sentence; a refused Undo toasts its own sentence", async () => {
    const toast = fakeToast();
    await submitJob(moveRun({
      toast, undoMove: vi.fn(async () => ({ ok: false as const, errorKey: "calendar.job.moveUndoTaken" as const })),
      move: vi.fn(async () => ({ ok: true as const, mode: "moved" as const, newId: "n", oldId: "b_old", cancelledAt: "c", startsAt: STARTS, first: "Ana", notice: "none" as const })),
    }));
    const [msg, opts] = toast.success.mock.calls[0]! as [string, SuccessOpts];
    expect(msg).toBe(t(m, "calendar.job.movedQuiet", "en", { when: formatWhen(new Date(STARTS), TZ, "en") }));
    opts.action.onClick();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["calendar.job.moveUndoTaken"]);
  });
});

describe("the sheet's pure helpers", () => {
  it("warningLines: one line per warning, the overlap through plural() with the earliest start in the account's zone (mutation: browser zone -> FAILS)", () => {
    const one: JobWarningView = { key: "overlaps:a", kind: "overlaps", count: 1, at: "2026-11-03T15:30:00.000Z" };
    expect(warningLines([one, { key: "notice", kind: "notice" }, { key: "closed", kind: "closed" }, { key: "no_video", kind: "no_video" }], TZ, "es")).toEqual([
      plural(m, "calendar.job.warn.overlaps", 1, "es", { count: 1, time: agendaTime(new Date(one.at!), TZ, "es", false) }),
      m["calendar.job.warn.notice.es"], m["calendar.job.warn.closed.es"], m["calendar.job.warn.noVideo.es"],
    ]);
    expect(warningLines([one], TZ, "en")[0]).toBe("Overlaps a job at 9:30 AM");
  });

  it("'Use Ana' swaps the typed customer for Ana's id; 'Add as new' keeps the typed one and says so (R8)", () => {
    const typed: JobDraft = { ...DRAFT, customer: { kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: false } };
    expect(withExistingCustomer(typed, { id: "id_ana" }, true).customer).toEqual({ kind: "existing", id: "id_ana" });
    expect(addingAsNew({ kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: false }))
      .toEqual({ kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: true });
    const ana: SheetCustomer = { kind: "existing", id: "c1", name: "Ana GarcÃ­a", first: "Ana" };
    expect(addingAsNew(ana)).toBe(ana);
  });

  it("noticeReason: the tick's reason when no confirmation can go, none when one can", () => {
    expect(noticeReason("available", "Ana", "en")).toBeNull();
    expect(noticeReason(null, "Ana", "en")).toBeNull();
    expect(noticeReason("no_email", "Ana", "en")).toBe(t(m, "calendar.job.noEmail", "en", { first: "Ana" }));
    expect(noticeReason("address_blocked", "Ana", "es")).toBe(t(m, "calendar.job.emailBlocked", "es", { first: "Ana" }));
    // An account that sends no email says so, never a silent disabled tick (mutation: no reason -> FAILS).
    expect(noticeReason("suppressed_account", "Ana", "en")).toBe(m["calendar.job.accountNoEmail"]);
    expect(noticeReason("suppressed_account", "Ana", "es")).toBe(m["calendar.job.accountNoEmail.es"]);
  });

  it("the length choices run 5 to 720 in five-minute steps", () => {
    expect(LENGTH_OPTIONS[0]).toBe(5);
    expect(LENGTH_OPTIONS.at(-1)).toBe(720);
    expect(LENGTH_OPTIONS).toHaveLength(144);
    expect(LENGTH_OPTIONS.every((n) => n % 5 === 0)).toBe(true);
  });
});

describe("T11/T12 review: the sheet's draft is built from the customer it holds", () => {
  const owner = { id: "22222222-2222-4222-8222-222222222222", name: "Ana García", first: "Ana" };
  /** The server's rules for a typed customer on Ana's number at 7 PM (outside hours): the phone's owner is
   *  offered until the draft says Add as new, then the warning, then the save. */
  const server = () => vi.fn(async (_a: string, d: JobDraft, seen: string[]) => {
    if (d.customer.kind === "new" && !d.customer.addAsNew) return { ok: false as const, needs: { phoneOwner: owner } };
    if (!seen.includes("outside_hours")) return { ok: false as const, needs: { warnings: [W_HOURS] } };
    return { ok: true as const, bookingId: "b_new", startsAt: STARTS, first: "Ana", notice: "none" as const };
  });
  const SEVEN_PM: JobFields = { ...FIELDS, start: "19:00", notify: false };

  it("Add as new, then the warnings, then 'Add it anyway' SAVES: the press is kept in the customer, never the phone offer again (mutation: addAsNew: false in the draft -> FAILS)", async () => {
    const add = server();
    let c: SheetCustomer = { kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: false };
    expect(await submitJob(addRun({ add, draft: sheetDraft(c, SEVEN_PM)! }))).toEqual({ kind: "phoneOwner", owner });
    c = addingAsNew(c);
    const second = await submitJob(addRun({ add, draft: sheetDraft(c, SEVEN_PM)! }));
    if (second.kind !== "warnings") throw new Error(`expected the warnings, got ${second.kind}`);
    const third = await submitJob(addRun({ add, draft: sheetDraft(c, SEVEN_PM)!, seen: second.seen }));
    expect(third).toEqual({ kind: "saved" });
    expect(add.mock.calls[2]![1].customer).toEqual({ kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: true });
  });

  it("typing a different name or number after Add as new asks again (the press was about that number)", () => {
    const c = addingAsNew({ kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: false });
    expect(typedCustomer(c, { phone: "956 555 0199" })).toEqual({ kind: "new", name: "Ana Reyes", phone: "956 555 0199", addAsNew: false });
    expect(typedCustomer(c, { name: "Ana R." })).toMatchObject({ addAsNew: false });
  });

  it("an existing customer's draft names their id; no customer, no draft; a new address rides along", () => {
    expect(sheetDraft({ kind: "existing", id: "c1", name: "Ana García", first: "Ana" }, FIELDS)).toEqual({ ...FIELDS, customer: { kind: "existing", id: "c1" } });
    expect(sheetDraft(null, FIELDS)).toBeNull();
    const place = { label: "Home", address: "1 Elm", city: "", landmark: "" };
    expect(sheetDraft({ kind: "existing", id: "c1", name: "A", first: "A" }, FIELDS, place)).toMatchObject({ newPlace: place });
  });

  it("Use Ana: the job goes to Ana WANTING the confirmation (owner ruling R4), though the typed person's tick was off for want of an email; the server's check decides (mutation: keep the typed draft's notify -> FAILS)", async () => {
    const typed = sheetDraft({ kind: "new", name: "Ana Reyes", phone: "956 555 0100", addAsNew: false }, { ...FIELDS, notify: false })!;
    const add = vi.fn<AddRun["add"]>(async () => ({ ok: true as const, bookingId: "b_new", startsAt: STARTS, first: "Ana", notice: "scheduled" as const }));
    await submitJob(addRun({ add, draft: withExistingCustomer(typed, owner, true) }));
    expect(add.mock.calls[0]![1]).toMatchObject({ customer: { kind: "existing", id: owner.id }, notify: true });
    // Whoever unticked it on purpose keeps it off.
    expect(withExistingCustomer(typed, owner, false).notify).toBe(false);
  });

  it("the phone offer names a nameless owner with a plain word, never an empty gap (mutation: the raw name -> FAILS)", () => {
    const en = phoneOwnerWords({ id: "x", name: " ", first: "" }, "en");
    expect(en.question).toBe(t(m, "calendar.job.phoneOwner", "en", { name: m["places.thisCustomer"], first: "this customer" }));
    expect(en.button).toBe(t(m, "calendar.job.useExisting", "en", { first: "this customer" }));
    expect(phoneOwnerWords({ id: "x", name: "", first: "" }, "es").button).toBe(t(m, "calendar.job.useExisting", "es", { first: "este cliente" }));
    expect(phoneOwnerWords({ id: "x", name: "Ana García", first: "Ana" }, "en").question).toBe(t(m, "calendar.job.phoneOwner", "en", { name: "Ana García", first: "Ana" }));
  });
});

describe("the pseudo-locale reaches the sheet's own lines (design review C1)", () => {
  it("warningLines and noticeReason wrap their words (mutation: ignore pseudo -> FAILS)", () => {
    expect(warningLines([W_HOURS], TZ, "en", true)).toEqual([pseudoLocale(m["calendar.job.warn.outsideHours"])]);
    expect(noticeReason("suppressed_account", "Ana", "en", true)).toBe(pseudoLocale(m["calendar.job.accountNoEmail"]));
    expect(phoneOwnerWords({ id: "x", name: "Ana García", first: "Ana" }, "en", true).button).toBe(pseudoLocale(t(m, "calendar.job.useExisting", "en", { first: "Ana" })));
  });
});
