import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAct } from "@bis/db/ai-act-rules";

/**
 * The undo actions' control flow (item 8c, plan Task 5 item 4), every collaborator mocked: who is asked
 * first, which client each read and write goes to, that a booking undo always goes through 0091's function,
 * that a redirect is never swallowed, and that an unticked notice sends nothing. The writes themselves are
 * proven live, on the replica, in actions.live.test.ts.
 */

const order = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  act: null as unknown,
  access: { userId: "user_me", isAgency: false, role: "owner", canManage: true } as Record<string, unknown>,
  canSee: true, outcome: "undone" as string, restore: "restored" as string,
  contact: { id: "c1", first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", language: "es" } as Record<string, unknown> | null,
  /** 0106 (F-006, Task 6): followMerge's default is identity (no merge in play); cases override it. */
  followTo: undefined as string | undefined,
}));
const REQUEST = vi.hoisted(() => ({ tag: "request" }));
const SERVICE = vi.hoisted(() => ({ tag: "service" }));
const step = vi.hoisted(() => (name: string, value?: unknown) => vi.fn(async (...args: unknown[]) => {
  const client = args[0] && typeof args[0] === "object" && "tag" in (args[0] as object) ? `(${(args[0] as { tag: string }).tag})` : "";
  order.push(`${name}${client}`);
  return typeof value === "function" ? (value as () => unknown)() : value;
}));

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: vi.fn(async () => { order.push("requireAccountAccess"); return state.access; }),
  requireAccountOwner: vi.fn(async () => {
    order.push("requireAccountOwner");
    if (!state.access.canManage) throw new Error("NEXT_REDIRECT");
    return state.access;
  }),
}));
vi.mock("@/lib/auth/visible", () => ({ callerCanSee: vi.fn(async (_t: string, _a: string, id: string) => { order.push(`callerCanSee:${id}`); return state.canSee; }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => REQUEST) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "app.example", "x-forwarded-proto": "https" })) }));
vi.mock("./notify", () => ({ sendBookingUndoNotice: vi.fn(async () => { order.push("sendBookingUndoNotice"); }) }));
vi.mock("@bis/db", () => ({
  serviceDb: () => SERVICE,
  getAiAct: step("getAiAct", () => state.act),
  getContact: step("getContact", () => state.contact),
  undoAiBookingAct: step("undoAiBookingAct", () => state.outcome),
  undoAiContactCreated: step("undoAiContactCreated", () => state.outcome),
  restoreContactFieldIf: step("restoreContactFieldIf", () => state.restore),
  stampAiActUndone: step("stampAiActUndone", true),
  clearAiActUndone: step("clearAiActUndone", true),
  markAiActNotified: step("markAiActNotified"),
  // 0106 (F-006, Task 6): identity by default (state.followTo unset); a case names a merge target.
  followMerge: vi.fn(async (db: unknown, _accountId: string, contactId: string) => {
    const client = db && typeof db === "object" && "tag" in (db as object) ? `(${(db as { tag: string }).tag})` : "";
    order.push(`followMerge${client}`);
    return state.followTo ?? contactId;
  }),
}));

import { revalidatePath } from "next/cache";
import * as bis from "@bis/db";
import { sendBookingUndoNotice } from "./notify";
import { redoAiFieldFillAction, undoAiActAction } from "./actions";

const base = { id: "act1", accountId: "A", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  createdAt: "2026-10-19T08:00:00.000Z", undoneAt: null, undoneBy: null, undoNotified: false };
const booked: AiAct = { ...base, kind: "booking_created", target: { bookingId: "b1" }, before: null, after: { startsAt: "2026-10-22T15:00:00.000Z", endsAt: "2026-10-22T16:00:00.000Z" } };
const moved: AiAct = { ...base, kind: "booking_rescheduled", target: { bookingId: "bNew", fromBookingId: "bOld" },
  before: { startsAt: "2026-10-23T15:00:00.000Z", endsAt: "2026-10-23T16:00:00.000Z", version: "v" }, after: { startsAt: "2026-10-22T15:00:00.000Z", endsAt: "2026-10-22T16:00:00.000Z" } };
const filled: AiAct = { ...base, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "ana@example.com" } };
const made: AiAct = { ...base, kind: "contact_created", target: {}, before: null, after: null };

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  state.act = booked;
  state.access = { userId: "user_me", isAgency: false, role: "owner", canManage: true };
  state.canSee = true;
  state.outcome = "undone";
  state.restore = "restored";
  state.contact = { id: "c1", first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", language: "es" };
  state.followTo = undefined;
});

describe("undoAiActAction: what is proven before anything is written", () => {
  it("an act the reader's own client cannot read (another account's, or a Technician's unassigned customer) answers notAvailable and writes nothing", async () => {
    state.act = null;
    expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: false, reason: "notAvailable" });
    expect(order).toEqual(["requireAccountAccess", "getAiAct(request)"]);
  });
  it("an act already undone answers notAvailable and writes nothing (an Undo never runs twice)", async () => {
    state.act = { ...booked, undoneAt: "2026-10-20T00:00:00.000Z", undoneBy: "user_x" };
    expect(await undoAiActAction("A", "act1", {})).toEqual({ ok: false, reason: "notAvailable" });
    expect(order).toEqual(["requireAccountAccess", "getAiAct(request)"]);
  });
});

describe("undoAiActAction: bookings", () => {
  it("proves every booking on the request client, then undoes through 0091's function on the service client (mutation: skip the proof -> FAILS)", async () => {
    state.act = moved;
    expect(await undoAiActAction("A", "act1", { notify: false })).toEqual({ ok: true, control: "booking", told: "notAsked" });
    expect(order).toEqual(["requireAccountAccess", "getAiAct(request)", "callerCanSee:bNew", "callerCanSee:bOld", "undoAiBookingAct(service)"]);
    expect(bis.undoAiBookingAct).toHaveBeenCalledWith(SERVICE, "A", "act1", "user_me", expect.any(Date));
  });
  it("a booking the reader cannot see answers notAvailable and never reaches the function", async () => {
    state.canSee = false;
    expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: false, reason: "notAvailable" });
    expect(bis.undoAiBookingAct).not.toHaveBeenCalled();
  });
  it("unticked: nothing is sent and the act is not marked notified (mutation: ignore notify -> FAILS)", async () => {
    await undoAiActAction("A", "act1", { notify: false });
    expect(sendBookingUndoNotice).not.toHaveBeenCalled();
    expect(bis.markAiActNotified).not.toHaveBeenCalled();
  });
  it("ticked: the notice goes on the service client with the record's email and language, then the act is marked", async () => {
    expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: true, control: "booking", told: "yes" });
    expect(sendBookingUndoNotice).toHaveBeenCalledWith({ db: SERVICE, accountId: "A", act: booked, contact: { email: "ana@example.com", language: "es" }, origin: "https://app.example" });
    expect(order.slice(-3)).toEqual(["getContact(request)", "sendBookingUndoNotice", "markAiActNotified(service)"]);
  });
  it("a notice that did not go answers 'no', the booking undo stands, and the act is not marked", async () => {
    vi.mocked(sendBookingUndoNotice).mockRejectedValueOnce(new Error("email not sent: suppressed"));
    expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: true, control: "booking", told: "no" });
    expect(bis.markAiActNotified).not.toHaveBeenCalled();
  });
  it("review M-2: the contact read for the notice throwing AFTER the undo answers undone, not told, never notAvailable (mutation: let it throw -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(bis.getContact).mockRejectedValueOnce(new Error("contacts down for ana@example.com"));
      expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: true, control: "booking", told: "no" });
      expect(sendBookingUndoNotice).not.toHaveBeenCalled();
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain("act1");
      expect(logged).not.toContain("ana@example.com");
    } finally { errors.mockRestore(); }
  });
  it("ticked with no email on file: not asked, nothing sent", async () => {
    state.contact = { id: "c1", email: null };
    expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: true, control: "booking", told: "notAsked" });
    expect(sendBookingUndoNotice).not.toHaveBeenCalled();
  });
  it.each([
    ["already_cancelled", "alreadyCancelled"], ["already_happened", "alreadyHappened"], ["rebooked", "rebooked"],
    ["time_passed", "timePassed"], ["time_taken", "timeTaken"], ["old_time_taken", "oldTimeTaken"], ["changed", "changed"],
    ["already_undone", "notAvailable"], ["gone", "notAvailable"],
  ])("the function's %s answers %s, and nothing is sent", async (outcome, reason) => {
    state.outcome = outcome;
    expect(await undoAiActAction("A", "act1", { notify: true })).toEqual({ ok: false, reason });
    expect(sendBookingUndoNotice).not.toHaveBeenCalled();
  });
  it("revalidates the record page", async () => {
    await undoAiActAction("A", "act1", {});
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/A/contacts/c1");
  });
});

describe("undoAiActAction: a field", () => {
  it("restores on the request client's compare-and-swap, then stamps on the service client", async () => {
    state.act = filled;
    expect(await undoAiActAction("A", "act1", {})).toEqual({ ok: true, control: "field" });
    expect(bis.restoreContactFieldIf).toHaveBeenCalledWith(REQUEST, "A", "c1", "email", "ana@example.com", null, "user_me");
    expect(order).toEqual(["requireAccountAccess", "getAiAct(request)", "followMerge(request)", "restoreContactFieldIf(request)", "stampAiActUndone(service)"]);
  });
  it("0106 (owner ruling D8): an act on a now-merged-away record restores and revalidates the KEPT record, not the tombstone (mutation: pass act.contactId straight through -> FAILS)", async () => {
    state.act = filled;
    state.followTo = "K";
    expect(await undoAiActAction("A", "act1", {})).toEqual({ ok: true, control: "field" });
    expect(bis.followMerge).toHaveBeenCalledWith(REQUEST, "A", "c1");
    expect(bis.restoreContactFieldIf).toHaveBeenCalledWith(REQUEST, "A", "K", "email", "ana@example.com", null, "user_me");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/A/contacts/K");
  });
  it("a booking undo never calls followMerge (mutation: resolve unconditionally -> FAILS)", async () => {
    state.act = booked;
    await undoAiActAction("A", "act1", { notify: false });
    expect(bis.followMerge).not.toHaveBeenCalled();
  });
  it("review M-2: the stamp throwing AFTER the restore answers ok (the value is back) and logs the act id (mutation: let it throw -> FAILS)", async () => {
    state.act = filled;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(bis.stampAiActUndone).mockRejectedValueOnce(new Error("ai_acts down"));
      expect(await undoAiActAction("A", "act1", {})).toEqual({ ok: true, control: "field" });
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("act1");
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/A/contacts/c1");
    } finally { errors.mockRestore(); }
  });
  it("a value changed since answers changed and stamps nothing", async () => {
    state.act = filled;
    state.restore = "changed";
    expect(await undoAiActAction("A", "act1", {})).toEqual({ ok: false, reason: "changed" });
    expect(bis.stampAiActUndone).not.toHaveBeenCalled();
  });
});

describe("undoAiActAction: a customer", () => {
  beforeEach(() => { state.act = made; state.outcome = "deleted"; });
  it("asks for an Owner OUTSIDE any catch, so a Staff member's redirect reaches Next (mutation: call it inside the try -> FAILS)", async () => {
    state.access = { userId: "user_staff", isAgency: false, role: "staff", canManage: false };
    await expect(undoAiActAction("A", "act1", { typedName: "Ana Ruiz" })).rejects.toThrow("NEXT_REDIRECT");
    expect(bis.undoAiContactCreated).not.toHaveBeenCalled();
  });
  it("the wrong typed name writes nothing", async () => {
    expect(await undoAiActAction("A", "act1", { typedName: "Ana" })).toEqual({ ok: false, reason: "typedName" });
    expect(bis.undoAiContactCreated).not.toHaveBeenCalled();
  });
  it("the right name: the contact read on the request client, then the delete on the service client, then the list revalidated", async () => {
    expect(await undoAiActAction("A", "act1", { typedName: "Ana  Ruiz" })).toEqual({ ok: true, control: "contact", removed: true });
    expect(order).toEqual(["requireAccountAccess", "getAiAct(request)", "requireAccountOwner", "getContact(request)", "undoAiContactCreated(service)"]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/A/contacts");
  });
  it.each([["has_activity", "hasActivity"], ["has_booking", "hasBooking"], ["gone", "notAvailable"]])("%s answers %s", async (outcome, reason) => {
    state.outcome = outcome;
    expect(await undoAiActAction("A", "act1", { typedName: "Ana Ruiz" })).toEqual({ ok: false, reason });
  });
});

describe("redoAiFieldFillAction", () => {
  const undone: AiAct = { ...filled, undoneAt: "2026-10-20T08:00:00.123+00:00", undoneBy: "user_me" };
  it("puts Sofía's value back over the old one, then clears this undoer's own stamp at its exact instant", async () => {
    state.act = undone;
    expect(await redoAiFieldFillAction("A", "act1")).toEqual({ ok: true });
    expect(bis.restoreContactFieldIf).toHaveBeenCalledWith(REQUEST, "A", "c1", "email", null, "ana@example.com", "user_me");
    expect(bis.clearAiActUndone).toHaveBeenCalledWith(SERVICE, "A", "act1", "user_me", new Date("2026-10-20T08:00:00.123Z"));
  });
  it("the stamp clear throwing AFTER the redo's restore answers ok: Sofía's value is back (review M-2's twin)", async () => {
    state.act = undone;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(bis.clearAiActUndone).mockRejectedValueOnce(new Error("ai_acts down"));
      expect(await redoAiFieldFillAction("A", "act1")).toEqual({ ok: true });
    } finally { errors.mockRestore(); }
  });
  it("0106 (owner ruling D8): the redo puts Sofía's value back on the KEPT record when the act named a now-merged-away one (mutation: pass act.contactId straight through -> FAILS)", async () => {
    state.act = undone;
    state.followTo = "K";
    expect(await redoAiFieldFillAction("A", "act1")).toEqual({ ok: true });
    expect(bis.followMerge).toHaveBeenCalledWith(REQUEST, "A", "c1");
    expect(bis.restoreContactFieldIf).toHaveBeenCalledWith(REQUEST, "A", "K", "email", null, "ana@example.com", "user_me");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/A/contacts/K");
  });
  it("an act not undone answers changed; one undone by someone else answers notAvailable; neither writes", async () => {
    state.act = filled;
    expect(await redoAiFieldFillAction("A", "act1")).toEqual({ ok: false, reason: "changed" });
    state.act = { ...undone, undoneBy: "user_other" };
    expect(await redoAiFieldFillAction("A", "act1")).toEqual({ ok: false, reason: "notAvailable" });
    expect(bis.restoreContactFieldIf).not.toHaveBeenCalled();
  });
  it("a booking act is never redone", async () => {
    state.act = { ...booked, undoneAt: "2026-10-20T08:00:00.000Z", undoneBy: "user_me" };
    expect(await redoAiFieldFillAction("A", "act1")).toEqual({ ok: false, reason: "notAvailable" });
  });
});
