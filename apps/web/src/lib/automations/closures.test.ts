// S-47d Task 9 (spec 5.5.2, plan "The model, The hold"): the closure verdict and the per-tick loader.
// Every instant is a typed-out literal in America/Chicago (CDT, UTC-5, until 2026-11-01). Status rows are
// built with the reader's own `untilFor`, the function the switch's action stores `until` with, so a row here
// is one the writer would produce.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ loadClosureSnapshot: vi.fn(), listBusinessStatusChanges: vi.fn() }));
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
  ok: true, input: { row: null, closedDays: [], hours: H, timezone: TZ, ...over }, windows: [],
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
    const s: ClosureState = { ok: true, input: { row, closedDays: [], hours: H, timezone: TZ }, windows: [] };
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
    expect(await NO_CLOSURES("acct_any")).toEqual({ ok: true, input: { row: null, closedDays: [], hours: null, timezone: "UTC" }, windows: [] });
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
    dbMocks.listBusinessStatusChanges.mockReset().mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
  });

  it("two calls for one account read ONCE, for that account, from the UTC date 14 days back (mutation: no memo FAILS on the count)", async () => {
    const db = { tag: "tick-db" } as never;
    const load = closureLoader(db, d("2026-10-22T02:00:00.000Z"));   // Oct 21 21:00 CDT, Oct 22 UTC
    const a = await load("acct_A");
    const b = await load("acct_A");
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledTimes(1);
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledWith(db, "acct_A", { date: "2026-10-08" });
    // The change log: the same account, the same 14 days, once (memoised with the snapshot).
    expect(dbMocks.listBusinessStatusChanges.mock.calls).toEqual([[db, "acct_A", "2026-10-08T02:00:00.000Z"]]);
    expect(b).toEqual(a);
  });

  it("maps the snapshot: the row and closed days as read, the hours CHAIN, the account's zone; no Keep", async () => {
    const out = await closureLoader({} as never, NOW)("acct_A");
    // No logged change: the stored storm stands in for its own event, an open window from its set_at.
    expect(out).toEqual({
      ok: true,
      input: { row: snapshot().row, closedDays: snapshot().closedDays, hours: H, timezone: TZ },
      windows: [{ start: d(SET_AT), end: null }],
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
    expect(dbMocks.listBusinessStatusChanges.mock.calls.map((c) => c[1])).toEqual(["acct_A", "acct_B"]);
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

describe("owner rulings D13a and D13b (2026-10-24): only the follow-up skips, and the switch's change log is the closure history", () => {
  // Mon 2026-10-19 (CDT, UTC-5). The follow-up for a Monday appointment is due Tue 09:00.
  const TUE_0900 = d("2026-10-20T14:00:00.000Z");
  const MON_1000 = d("2026-10-19T15:00:00.000Z");
  const SKIPPED = { kind: "skipped", reason: "Not sent: the business was closed for this appointment" };
  const change = (at: string, from: string | null, to: string | null, until: string | null = null) => ({ at, from, to, until });
  const row = (state: StatusRowInput["state"], set_at: string, until: string | null = null) => ({
    account_id: "acct_A", state, late_minutes: state === "running_late" ? 30 : null, until, set_by: "u1", set_at,
  });
  /** Through the REAL loader: the snapshot and the change log as the database returns them. */
  async function loaded(over: { row?: unknown; closedDays?: unknown[]; changes?: unknown[] }, now: Date) {
    dbMocks.loadClosureSnapshot.mockReset().mockImplementation(async (_db: unknown, _id: string, since: { date: string }) => ({
      timezone: TZ, row: over.row ?? null,
      closedDays: ((over.closedDays ?? []) as { ends_on: string }[]).filter((r) => r.ends_on >= since.date),
      hours: { businessHours: null, calendarHours: null },
    }));
    dbMocks.listBusinessStatusChanges.mockReset().mockResolvedValue(over.changes ?? []);
    return closureLoader({} as never, now)("acct_A");
  }
  const followUp = (appointmentAt: Date, kept = false) => ({ appointmentAt, kept, skipIfWasClosed: true as const });

  // A storm set Mon 08:00, switched to Open at Mon 18:00 (each change logged a moment after its update).
  const STORM_THEN_OPEN = {
    row: row("open", "2026-10-19T23:00:00.000Z"),
    changes: [
      change("2026-10-19T13:00:00.050Z", "open", "storm"),
      change("2026-10-19T23:00:00.050Z", "storm", "open"),
    ],
  };

  it("a storm ended early by switching to Open still counts: the Tuesday follow-up for Monday 10:00 is skipped (mutation: ignore the history FAILS)", async () => {
    expect(closureVerdict(await loaded(STORM_THEN_OPEN, TUE_0900), followUp(MON_1000), TUE_0900)).toEqual(SKIPPED);
  });

  it("the same appointment, kept: the follow-up is sent", async () => {
    expect(closureVerdict(await loaded(STORM_THEN_OPEN, TUE_0900), followUp(MON_1000, true), TUE_0900)).toEqual({ kind: "send" });
  });

  it("D13a: a review request, referral ask or no-show nudge (no skip flag) for the same appointment sends (SD6)", async () => {
    expect(closureVerdict(await loaded(STORM_THEN_OPEN, TUE_0900), { appointmentAt: MON_1000, kept: false }, TUE_0900)).toEqual({ kind: "send" });
  });

  it("ended by Running late counts the same", async () => {
    const s = await loaded({
      row: row("running_late", "2026-10-19T17:00:00.000Z", "2026-10-20T05:00:00.000Z"),
      changes: [change("2026-10-19T13:00:00.050Z", "open", "storm"), change("2026-10-19T17:00:00.050Z", "storm", "running_late")],
    }, TUE_0900);
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900)).toEqual(SKIPPED);
  });

  it("Closed today switched to Open at noon: a 14:00 appointment came after the reopening and its follow-up is sent; a 10:00 one is skipped (mutation: end the window at its until only FAILS)", async () => {
    const s = await loaded({
      row: row("open", "2026-10-19T17:00:00.000Z"),
      changes: [
        change("2026-10-19T13:00:00.050Z", "open", "closed_today", "2026-10-20T05:00:00.000Z"),
        change("2026-10-19T17:00:00.050Z", "closed_today", "open"),
      ],
    }, TUE_0900);
    expect(closureVerdict(s, followUp(d("2026-10-19T19:00:00.000Z")), TUE_0900)).toEqual({ kind: "send" });
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900)).toEqual(SKIPPED);
  });

  it("a storm that expired on its own (its back-on date came) ends at its until: covered before, not after", async () => {
    const s = await loaded({
      row: row("storm", "2026-10-19T13:00:00.000Z", "2026-10-20T05:00:00.000Z"),
      changes: [change("2026-10-19T13:00:00.050Z", "open", "storm", "2026-10-20T05:00:00.000Z")],
    }, d("2026-10-21T14:00:00.000Z"));
    expect(closureVerdict(s, followUp(MON_1000), d("2026-10-21T14:00:00.000Z"))).toEqual(SKIPPED);
    expect(closureVerdict(s, followUp(d("2026-10-20T15:00:00.000Z")), d("2026-10-21T14:00:00.000Z"))).toEqual({ kind: "send" });
  });

  it("a change whose event was never written still counts through the stored row, the newest change (mutation: leave the row out FAILS)", async () => {
    const s = await loaded({ row: row("storm", "2026-10-19T13:00:00.000Z", "2026-10-20T05:00:00.000Z"), changes: [] }, TUE_0900);
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900)).toEqual(SKIPPED);
  });

  it("a storm set before the 14 days the log is read for still counts: the first change read names it in `from` (mutation: drop the from window FAILS)", async () => {
    const s = await loaded({ row: row("open", "2026-10-19T23:00:00.000Z"), changes: [change("2026-10-19T23:00:00.050Z", "storm", "open")] }, TUE_0900);
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900)).toEqual(SKIPPED);
  });

  it("an Undo leaves a short window, set to undo, that still counts: only an appointment that started inside it is skipped", async () => {
    const s = await loaded({
      row: row("open", "2026-10-19T15:00:05.000Z"),
      changes: [change("2026-10-19T15:00:00.050Z", "open", "storm"), change("2026-10-19T15:00:05.050Z", "storm", "open")],
    }, TUE_0900);
    expect(closureVerdict(s, followUp(d("2026-10-19T15:00:02.000Z")), TUE_0900)).toEqual(SKIPPED);
    expect(closureVerdict(s, followUp(d("2026-10-19T15:30:00.000Z")), TUE_0900)).toEqual({ kind: "send" });
  });

  it("fails open, as documented: with neither the event nor a closure on the stored row, nothing is known and the follow-up sends", async () => {
    expect(closureVerdict(await loaded({ row: row("open", "2026-10-19T23:00:00.000Z"), changes: [] }, TUE_0900), followUp(MON_1000), TUE_0900))
      .toEqual({ kind: "send" });
  });

  it("a storm still in force holds the follow-up exactly as before", async () => {
    const s = await loaded({ row: row("storm", "2026-10-19T13:00:00.000Z"), changes: [change("2026-10-19T13:00:00.050Z", "open", "storm")] }, TUE_0900);
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900))
      .toEqual({ kind: "held", until: d("2026-10-21T14:00:00.000Z"), reason: "Held: closed for a storm" });
  });

  it("an ENDED closed day skips the follow-up only; a closed day removed leaves no cover and it sends (mutation: drop the skip flag branch FAILS)", async () => {
    const day = { id: "cd1", account_id: "acct_A", starts_on: "2026-10-19", ends_on: "2026-10-19", reason: null, created_by: "u1", created_at: SET_AT };
    const s = await loaded({ closedDays: [day] }, TUE_0900);
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900)).toEqual(SKIPPED);
    expect(closureVerdict(s, { appointmentAt: MON_1000, kept: false }, TUE_0900)).toEqual({ kind: "send" });
    expect(closureVerdict(await loaded({ closedDays: [] }, TUE_0900), followUp(MON_1000), TUE_0900)).toEqual({ kind: "send" });
  });

  it("a follow-up released 36 hours after a closed day still sees that day: the closed-day lookback is wider than yesterday (mutation: a one-day lookback FAILS)", async () => {
    // Appointment Mon 18:00-19:00 on the closed Monday; released Wed 07:00 CDT (36 h after the end), Wed 12:00 UTC.
    const day = { id: "cd1", account_id: "acct_A", starts_on: "2026-10-19", ends_on: "2026-10-19", reason: null, created_by: "u1", created_at: SET_AT };
    const wed = d("2026-10-21T12:00:00.000Z");
    expect(closureVerdict(await loaded({ closedDays: [day] }, wed), followUp(d("2026-10-19T23:00:00.000Z")), wed)).toEqual(SKIPPED);
  });

  it("a failed change-log read is { ok: false }, the same as a failed snapshot: every booking send holds 15 minutes (mutation: read it as no changes FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
    dbMocks.loadClosureSnapshot.mockReset().mockResolvedValue({ timezone: TZ, row: null, closedDays: [], hours: { businessHours: null, calendarHours: null } });
    dbMocks.listBusinessStatusChanges.mockReset().mockRejectedValue(new Error("events down"));
    const s = await closureLoader({} as never, TUE_0900)("acct_A");
    expect(s).toEqual({ ok: false });
    expect(closureVerdict(s, followUp(MON_1000), TUE_0900))
      .toEqual({ kind: "held", until: d("2026-10-20T14:15:00.000Z"), reason: "Held: couldn't check whether the business is open" });
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("closureLoader: a mapper that throws (review M1)", () => {
  it("a snapshot the mapper cannot read is { ok: false }, never a rejected promise memoised for the tick", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
    dbMocks.loadClosureSnapshot.mockReset().mockResolvedValue({ timezone: TZ, row: null, closedDays: [] });   // no `hours`
    dbMocks.listBusinessStatusChanges.mockReset().mockResolvedValue([]);
    const load = closureLoader({} as never, NOW);
    await expect(load("acct_A")).resolves.toEqual({ ok: false });
    await expect(load("acct_A")).resolves.toEqual({ ok: false });
    expect(dbMocks.loadClosureSnapshot).toHaveBeenCalledTimes(1);
  });
});
