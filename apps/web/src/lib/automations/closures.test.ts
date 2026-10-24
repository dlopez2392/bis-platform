// S-47d Task 9 (spec 5.5.2, plan "The model, The hold"): the closure verdict and the per-tick loader.
// Every instant is a typed-out literal in America/Chicago (CDT, UTC-5, until 2026-11-01). Status rows are
// built with the reader's own `untilFor`, the function the switch's action stores `until` with, so a row here
// is one the writer would produce.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ loadClosureSnapshot: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { OpenHours } from "@/lib/booking/slots";
import { untilFor, type StatusRowInput, type ClosedDay } from "@/lib/business-status/status";
import { closureVerdict, closureLoader, NO_CLOSURES, type ClosureState } from "./closures";

const TZ = "America/Chicago";
const d = (iso: string) => new Date(iso);
// Wed 2026-10-21, 10:00 CDT.
const NOW = d("2026-10-21T15:00:00.000Z");
const SET_AT = "2026-10-21T14:00:00.000Z";           // 09:00 CDT, the switch thrown this morning
const H: OpenHours = {
  mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]],
  thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]],
};
const CAL: OpenHours = { sat: [["09:00", "13:00"]] };

const closedTodayRow = (): StatusRowInput => ({
  state: "closed_today", late_minutes: null, set_at: SET_AT,
  until: untilFor({ state: "closed_today" }, H, TZ, d(SET_AT))!.toISOString(),
});
const stormRow = (backOn: string | null): StatusRowInput => {
  const until = untilFor({ state: "storm", backOn }, H, TZ, d(SET_AT));
  return { state: "storm", late_minutes: null, set_at: SET_AT, until: until === null ? null : until.toISOString() };
};
const lateRow = (): StatusRowInput => ({
  state: "running_late", late_minutes: 30, set_at: SET_AT,
  until: untilFor({ state: "running_late", lateMinutes: 30 }, H, TZ, d(SET_AT))!.toISOString(),
});
const state = (over: { row?: StatusRowInput | null; closedDays?: ClosedDay[]; hours?: OpenHours | null } = {}): ClosureState => ({
  ok: true, input: { row: null, closedDays: [], hours: H, timezone: TZ, ...over },
});
const range = (starts_on: string, ends_on: string): ClosedDay => ({ starts_on, ends_on, reason: "vacation" });

describe("closureVerdict: held, by the kind of closure that covers the appointment", () => {
  it("Closed today: an appointment at 23:30 tonight is held until midnight at the latest, with the closed-today reason", () => {
    const at2330 = d("2026-10-22T04:30:00.000Z");
    // The row's until is tonight's midnight (D12): 2026-10-22 00:00 CDT.
    expect(closedTodayRow().until).toBe("2026-10-22T05:00:00.000Z");
    expect(closureVerdict(state({ row: closedTodayRow() }), { appointmentAt: at2330, kept: false }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-22T05:00:00.000Z"), reason: "Held: the business is closed today" });
  });

  it("Closed today with the appointment as the deadline: held until the EARLIER of midnight and the deadline (mutation: min -> max FAILS)", () => {
    const at2330 = d("2026-10-22T04:30:00.000Z");
    expect(closureVerdict(state({ row: closedTodayRow() }), { appointmentAt: at2330, kept: false, deadline: at2330 }, NOW))
      .toEqual({ kind: "held", until: at2330, reason: "Held: the business is closed today" });
  });

  it("Closed today does not cover 09:00 tomorrow (D12): it sends", () => {
    expect(closureVerdict(state({ row: closedTodayRow() }), { appointmentAt: d("2026-10-22T14:00:00.000Z"), kept: false }, NOW))
      .toEqual({ kind: "send" });
  });

  it("a dated storm: held until the window's end (back-on date, 00:00) when the deadline is later (mutation: min -> max FAILS)", () => {
    const row = stormRow("2026-10-24");                    // back on Saturday
    expect(row.until).toBe("2026-10-24T05:00:00.000Z");
    const friday = d("2026-10-23T15:00:00.000Z");
    expect(closureVerdict(state({ row }), { appointmentAt: friday, kept: false, deadline: d("2026-10-26T00:00:00.000Z") }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-24T05:00:00.000Z"), reason: "Held: closed for a storm" });
    expect(closureVerdict(state({ row }), { appointmentAt: friday, kept: false }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-24T05:00:00.000Z"), reason: "Held: closed for a storm" });
  });

  it("a storm back on Saturday, business hours Mon-Fri, the calendar open Saturday: a Saturday 09:00 appointment is not covered and sends (mutation: a reopening-based until FAILS)", () => {
    const row = stormRow("2026-10-24");
    const s: ClosureState = { ok: true, input: { row, closedDays: [], hours: H, timezone: TZ } };
    expect(closureVerdict(s, { appointmentAt: d("2026-10-24T14:00:00.000Z"), kept: false }, NOW)).toEqual({ kind: "send" });
    // The calendar's Saturday is in the loader's chain too (business hours win, D3), and still the window is the
    // stored until, not a reopening.
    expect(closureVerdict(state({ row, hours: CAL }), { appointmentAt: d("2026-10-24T14:00:00.000Z"), kept: false }, NOW))
      .toEqual({ kind: "send" });
  });

  it("an open-ended storm with no deadline: held for exactly 24 hours, a daily second look", () => {
    expect(closureVerdict(state({ row: stormRow(null) }), { appointmentAt: d("2026-10-23T15:00:00.000Z"), kept: false }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-22T15:00:00.000Z"), reason: "Held: closed for a storm" });
  });

  it("an open-ended storm with a deadline: held until the deadline", () => {
    const deadline = d("2026-10-23T15:00:00.000Z");
    expect(closureVerdict(state({ row: stormRow(null) }), { appointmentAt: deadline, kept: false, deadline }, NOW))
      .toEqual({ kind: "held", until: deadline, reason: "Held: closed for a storm" });
  });

  it("a closed day: held until the start of the day after the range, with the closed-day reason", () => {
    expect(closureVerdict(state({ closedDays: [range("2026-10-23", "2026-10-24")] }),
      { appointmentAt: d("2026-10-23T15:00:00.000Z"), kept: false }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-25T05:00:00.000Z"), reason: "Held: the business is closed that day" });
  });
});

describe("closureVerdict: send, skip, and the unreadable status", () => {
  it("a kept appointment sends, under every kind of closure", () => {
    const kept = (s: ClosureState, at: string) => closureVerdict(s, { appointmentAt: d(at), kept: true }, NOW);
    expect(kept(state({ row: closedTodayRow() }), "2026-10-22T04:30:00.000Z")).toEqual({ kind: "send" });
    expect(kept(state({ row: stormRow(null) }), "2026-10-23T15:00:00.000Z")).toEqual({ kind: "send" });
    expect(kept(state({ closedDays: [range("2026-10-23", "2026-10-23")] }), "2026-10-23T15:00:00.000Z")).toEqual({ kind: "send" });
  });

  it("SD20: kept, the appointment ENDED three days ago under a closed-day range from four days ago to tomorrow, sends; unkept, the same one is held (mutation: Keep read from a two-day loader window FAILS)", () => {
    const s = state({ closedDays: [range("2026-10-17", "2026-10-22")] });
    const threeDaysAgo = d("2026-10-18T15:00:00.000Z");     // Sun 10:00 CDT, ended 11:00
    const deadline = d("2026-10-22T04:00:00.000Z");         // the referral ask's 85 hours after the end
    expect(closureVerdict(s, { appointmentAt: threeDaysAgo, kept: true, deadline }, NOW)).toEqual({ kind: "send" });
    expect(closureVerdict(s, { appointmentAt: threeDaysAgo, kept: false, deadline }, NOW))
      .toEqual({ kind: "held", until: deadline, reason: "Held: the business is closed that day" });
  });

  it("not covered: no closure at all sends", () => {
    expect(closureVerdict(state(), { appointmentAt: d("2026-10-23T15:00:00.000Z"), kept: false }, NOW)).toEqual({ kind: "send" });
  });

  it("SD6: a cover whose window ended at or before now sends, never a hold with a past held_until (mutation: drop the ended branch FAILS)", () => {
    const s = state({ closedDays: [range("2026-10-19", "2026-10-20")] });   // window ends 2026-10-21 00:00 CDT
    const monday = d("2026-10-19T15:00:00.000Z");
    expect(closureVerdict(s, { appointmentAt: monday, kept: false }, NOW)).toEqual({ kind: "send" });
    expect(closureVerdict(s, { appointmentAt: monday, kept: false }, d("2026-10-21T05:00:00.000Z"))).toEqual({ kind: "send" });
    // One minute before the window ends it still holds, so the branch is the boundary, not a blanket send.
    expect(closureVerdict(s, { appointmentAt: monday, kept: false }, d("2026-10-21T04:59:00.000Z")))
      .toEqual({ kind: "held", until: d("2026-10-21T05:00:00.000Z"), reason: "Held: the business is closed that day" });
  });

  it("a deadline at or before now is skipped with the closed reason", () => {
    const s = state({ row: stormRow(null) });
    const at = d("2026-10-21T15:00:00.000Z");
    expect(closureVerdict(s, { appointmentAt: d("2026-10-21T16:00:00.000Z"), kept: false, deadline: at }, NOW))
      .toEqual({ kind: "skipped", reason: "Not sent: the business was closed for this appointment" });
    expect(closureVerdict(s, { appointmentAt: d("2026-10-21T16:00:00.000Z"), kept: false, deadline: d("2026-10-21T14:00:00.000Z") }, NOW))
      .toEqual({ kind: "skipped", reason: "Not sent: the business was closed for this appointment" });
  });

  it("an unreadable status holds for exactly 15 minutes with its own reason, never a send (mutation: send FAILS)", () => {
    expect(closureVerdict({ ok: false }, { appointmentAt: d("2026-10-23T15:00:00.000Z"), kept: false }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-21T15:15:00.000Z"), reason: "Held: couldn't check whether the business is open" });
  });

  it("Running late covers nothing: it sends", () => {
    expect(closureVerdict(state({ row: lateRow() }), { appointmentAt: d("2026-10-21T15:30:00.000Z"), kept: false }, NOW))
      .toEqual({ kind: "send" });
  });

  it("NO_CLOSURES reads open for any account", async () => {
    expect(await NO_CLOSURES("acct_any")).toEqual({ ok: true, input: { row: null, closedDays: [], hours: null, timezone: "UTC" } });
  });
});

describe("closureLoader: one read per account per tick", () => {
  const snapshot = (over: Record<string, unknown> = {}) => ({
    timezone: TZ,
    row: { account_id: "acct_A", state: "storm", late_minutes: null, until: null, set_by: "u1", set_at: SET_AT },
    closedDays: [{ id: "cd1", account_id: "acct_A", starts_on: "2026-10-23", ends_on: "2026-10-23", reason: null, created_by: "u1", created_at: SET_AT }],
    hours: { businessHours: H, calendarHours: CAL },
    ...over,
  });

  beforeEach(() => {
    dbMocks.loadClosureSnapshot.mockReset().mockImplementation(async () => snapshot());
    vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
  });

  it("two calls for one account read ONCE, for that account, from the UTC date 14 days back (mutation: no memo FAILS on the count)", async () => {
    const db = { tag: "tick-db" } as never;
    const load = closureLoader(db, d("2026-10-22T02:00:00.000Z"));   // Oct 21 21:00 CDT, Oct 22 UTC
    const a = await load("acct_A");
    const b = await load("acct_A");
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledTimes(1);
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledWith(db, "acct_A", { date: "2026-10-08" });
    expect(b).toEqual(a);
  });

  it("maps the snapshot: the row and closed days as read, the hours CHAIN, the account's zone; no Keep", async () => {
    const out = await closureLoader({} as never, NOW)("acct_A");
    expect(out).toEqual({
      ok: true,
      input: { row: snapshot().row, closedDays: snapshot().closedDays, hours: H, timezone: TZ },
    });
    dbMocks.loadClosureSnapshot.mockImplementation(async () => snapshot({ hours: { businessHours: null, calendarHours: CAL } }));
    expect(await closureLoader({} as never, NOW)("acct_A")).toMatchObject({ ok: true, input: { hours: CAL } });
  });

  it("a null zone reads UTC; an unresolvable one reads UTC too, so the verdict never throws on it", async () => {
    dbMocks.loadClosureSnapshot.mockImplementation(async () => snapshot({ timezone: null }));
    expect(await closureLoader({} as never, NOW)("acct_A")).toMatchObject({ ok: true, input: { timezone: "UTC" } });
    dbMocks.loadClosureSnapshot.mockImplementation(async () => snapshot({ timezone: "America/Nowhere" }));
    const s = await closureLoader({} as never, NOW)("acct_A");
    expect(s).toMatchObject({ ok: true, input: { timezone: "UTC" } });
    expect(() => closureVerdict(s, { appointmentAt: d("2026-10-23T15:00:00.000Z"), kept: false }, NOW)).not.toThrow();
  });

  it("two accounts read twice, each with its own id", async () => {
    const load = closureLoader({} as never, NOW);
    await load("acct_A");
    await load("acct_B");
    await load("acct_B");
    expect(dbMocks.loadClosureSnapshot.mock.calls.map((c) => c[1])).toEqual(["acct_A", "acct_B"]);
  });

  it("a read that throws before it returns a promise is still { ok: false }, never a throw into the send", async () => {
    dbMocks.loadClosureSnapshot.mockImplementation(() => { throw new Error("not a function"); });
    const load = closureLoader({} as never, NOW);
    await expect(load("acct_A")).resolves.toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("a failed read is { ok: false } for every call this tick, one read, one log line naming only the account", async () => {
    dbMocks.loadClosureSnapshot.mockRejectedValue(new Error("secret-ish detail from postgrest"));
    const load = closureLoader({} as never, NOW);
    expect(await load("acct_A")).toEqual({ ok: false });
    expect(await load("acct_A")).toEqual({ ok: false });
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toContain("acct_A");
    expect(line).not.toContain("postgrest");
  });
});

describe("D13 (owner, 2026-10-24): an after-appointment message for an appointment a closure covered never sends unless kept", () => {
  // A closed day on Mon 2026-10-19 only; its window ended at Tue 00:00 CDT, before NOW (Wed 10:00).
  const ENDED_DAY = state({ closedDays: [range("2026-10-19", "2026-10-19")] });
  const MONDAY = d("2026-10-19T15:00:00.000Z");
  const SKIPPED = { kind: "skipped", reason: "Not sent: the business was closed for this appointment" };

  it("an ENDED closed-day cover: an after-appointment send is skipped; a before-appointment send still sends (SD6) (mutation: drop the afterAppointment branch FAILS)", () => {
    expect(closureVerdict(ENDED_DAY, { appointmentAt: MONDAY, kept: false, afterAppointment: true }, NOW)).toEqual(SKIPPED);
    expect(closureVerdict(ENDED_DAY, { appointmentAt: MONDAY, kept: false, afterAppointment: false }, NOW)).toEqual({ kind: "send" });
    expect(closureVerdict(ENDED_DAY, { appointmentAt: MONDAY, kept: false }, NOW)).toEqual({ kind: "send" });
  });

  it("kept wins over D13: an after-appointment send for a kept appointment under an ended cover sends", () => {
    expect(closureVerdict(ENDED_DAY, { appointmentAt: MONDAY, kept: true, afterAppointment: true }, NOW)).toEqual({ kind: "send" });
  });

  it("while the closure is still in force, an after-appointment send holds exactly as before", () => {
    const s = state({ closedDays: [range("2026-10-19", "2026-10-22")] });
    expect(closureVerdict(s, { appointmentAt: MONDAY, kept: false, afterAppointment: true }, NOW))
      .toEqual({ kind: "held", until: d("2026-10-23T05:00:00.000Z"), reason: "Held: the business is closed that day" });
  });

  it("a storm that EXPIRED on its own (until passed) covered the appointment: an after-appointment send is skipped, a before one sends (mutation: no expired-window check FAILS)", () => {
    // Thrown Mon 09:00 CDT, back on Tue: the stored row stays a storm with a past until.
    const expired: StatusRowInput = { state: "storm", late_minutes: null, set_at: "2026-10-19T14:00:00.000Z", until: "2026-10-20T05:00:00.000Z" };
    const at = d("2026-10-19T20:00:00.000Z");        // Mon 15:00 CDT, inside the window
    expect(closureVerdict(state({ row: expired }), { appointmentAt: at, kept: false, afterAppointment: true }, NOW)).toEqual(SKIPPED);
    expect(closureVerdict(state({ row: expired }), { appointmentAt: at, kept: false }, NOW)).toEqual({ kind: "send" });
    // An appointment before the switch was thrown was never covered: it sends.
    expect(closureVerdict(state({ row: expired }), { appointmentAt: d("2026-10-19T13:00:00.000Z"), kept: false, afterAppointment: true }, NOW))
      .toEqual({ kind: "send" });
  });

  it("an expired Closed today covered the appointment the same way: skipped after, sent before", () => {
    const expired: StatusRowInput = { state: "closed_today", late_minutes: null, set_at: "2026-10-20T14:00:00.000Z", until: "2026-10-21T05:00:00.000Z" };
    const at = d("2026-10-20T20:00:00.000Z");
    expect(closureVerdict(state({ row: expired }), { appointmentAt: at, kept: false, afterAppointment: true }, NOW)).toEqual(SKIPPED);
    expect(closureVerdict(state({ row: expired }), { appointmentAt: at, kept: false }, NOW)).toEqual({ kind: "send" });
  });

  it("switching to Open, or removing the closed day, leaves no cover: the after-appointment send goes (the owner's release)", () => {
    const opened: StatusRowInput = { state: "open", late_minutes: null, set_at: "2026-10-20T14:00:00.000Z", until: null };
    expect(closureVerdict(state({ row: opened }), { appointmentAt: d("2026-10-19T20:00:00.000Z"), kept: false, afterAppointment: true }, NOW))
      .toEqual({ kind: "send" });
    expect(closureVerdict(state({ closedDays: [] }), { appointmentAt: MONDAY, kept: false, afterAppointment: true }, NOW)).toEqual({ kind: "send" });
  });

  it("through the REAL loader, a referral ask 4 days after a closed day still sees that day and is skipped (mutation: the old yesterday-only lookback FAILS)", async () => {
    // The mock answers as the database does: only ranges ending on or after `since.date`.
    const day: ClosedDay & { id: string; account_id: string; created_by: string; created_at: string } = {
      id: "cd1", account_id: "acct_A", starts_on: "2026-10-17", ends_on: "2026-10-17", reason: null, created_by: "u1", created_at: SET_AT,
    };
    dbMocks.loadClosureSnapshot.mockReset().mockImplementation(async (_db: unknown, _id: string, since: { date: string }) => ({
      timezone: TZ, row: null, closedDays: [day].filter((r) => r.ends_on >= since.date),
      hours: { businessHours: null, calendarHours: null },
    }));
    const s = await closureLoader({} as never, NOW)("acct_A");
    expect(closureVerdict(s, { appointmentAt: d("2026-10-17T15:00:00.000Z"), kept: false, afterAppointment: true }, NOW)).toEqual(SKIPPED);
  });
});

describe("closureLoader: a mapper that throws (review M1)", () => {
  it("a snapshot the mapper cannot read is { ok: false }, never a rejected promise memoised for the tick", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
    dbMocks.loadClosureSnapshot.mockReset().mockResolvedValue({ timezone: TZ, row: null, closedDays: [] });   // no `hours`
    const load = closureLoader({} as never, NOW);
    await expect(load("acct_A")).resolves.toEqual({ ok: false });
    await expect(load("acct_A")).resolves.toEqual({ ok: false });
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledTimes(1);
  });
});
