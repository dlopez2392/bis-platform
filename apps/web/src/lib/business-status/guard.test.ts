// S-47d Task 8: the guard's full spec §7 table, 5 roles × 7 effective states × 5 changes = 175 cells for
// `mayChangeStatus`, plus the 5 × 7 = 35 cells for `canChangeFor`. Every expected result below is typed out
// by hand from the spec text (plan "The guard"), never computed by calling the guard itself.
import { describe, expect, it } from "vitest";
import { canChangeFor, mayChangeStatus, type Actor, type CanChange } from "./guard";
import { effectiveStatus, type EffectiveStatus, type StatusChange, type StatusInput, type StatusRowInput } from "./status";

type RoleKey = "agency" | "owner" | "staff" | "technician" | "none";
type EffKey = "open" | "running_late" | "closed_today" | "storm_dated" | "storm_open" | "closed_day" | "expired_closed_today";
type ChangeKey = "open" | "closed_today" | "running_late_30" | "storm_dated" | "storm_open";
type Verdict = { ok: true } | { ok: false; reason: "close_or_reopen" | "role" };

const ROLE_KEYS: readonly RoleKey[] = ["agency", "owner", "staff", "technician", "none"];
const EFF_KEYS: readonly EffKey[] = [
  "open", "running_late", "closed_today", "storm_dated", "storm_open", "closed_day", "expired_closed_today",
];
const CHANGE_KEYS: readonly ChangeKey[] = ["open", "closed_today", "running_late_30", "storm_dated", "storm_open"];

const ACTORS: Record<RoleKey, Actor> = {
  agency: { isAgency: true, role: null },
  owner: { isAgency: false, role: "owner" },
  staff: { isAgency: false, role: "staff" },
  technician: { isAgency: false, role: "technician" },
  none: { isAgency: false, role: null },
};

// The TZ is irrelevant to the guard (it only reads `.state`); fixed instants keep every case typed-out.
const TZ = "America/Chicago";
const NOW = new Date("2027-06-07T15:00:00.000Z"); // 10:00 CDT, Monday

/** A `closed_today` row stamped yesterday whose `until` has already passed `NOW`: effectiveStatus reads it
 *  as open (D3, expiry on read) — the "expired closed_today (reads open)" row of the spec's table. */
const EXPIRED_ROW: StatusRowInput = {
  state: "closed_today", late_minutes: null, until: "2027-06-06T05:00:00.000Z", set_at: "2027-06-05T20:00:00.000Z",
};
const expiredInput: StatusInput = { row: EXPIRED_ROW, closedDays: [], hours: null, timezone: TZ, now: NOW };

const EFFECTIVES: Record<EffKey, EffectiveStatus> = {
  open: { state: "open", nextClosedDay: null },
  running_late: { state: "running_late", lateMinutes: 30, endsAt: new Date("2027-06-07T20:00:00.000Z") },
  closed_today: { state: "closed_today", reopensAt: new Date("2027-06-08T13:00:00.000Z"), reopensTimeKnown: true },
  storm_dated: { state: "storm", reopensAt: new Date("2027-06-10T13:00:00.000Z"), reopensTimeKnown: true },
  storm_open: { state: "storm", reopensAt: null, reopensTimeKnown: false },
  closed_day: {
    state: "closed_day", reason: "holiday", startsOn: "2027-06-07", endsOn: "2027-06-07",
    reopensAt: new Date("2027-06-08T13:00:00.000Z"), reopensTimeKnown: true,
  },
  expired_closed_today: effectiveStatus(expiredInput),
};

const CHANGES: Record<ChangeKey, StatusChange> = {
  open: { state: "open" },
  closed_today: { state: "closed_today" },
  running_late_30: { state: "running_late", lateMinutes: 30 },
  storm_dated: { state: "storm", backOn: "2027-06-10" },
  storm_open: { state: "storm", backOn: null },
};

describe("the expired row really reads open (so the 'expired_closed_today' row is a distinct real case, not a copy of 'open')", () => {
  it("effectiveStatus(expiredInput).state is open", () => {
    expect(EFFECTIVES.expired_closed_today.state).toBe("open");
  });
});

const OK: Verdict = { ok: true };
const CLOSE: Verdict = { ok: false, reason: "close_or_reopen" };
const ROLE: Verdict = { ok: false, reason: "role" };

/** The 5×7 = 35-cell table for `canChangeFor` (spec §7, plan "The guard"), written out by hand. */
const CAN_CHANGE: Record<RoleKey, Record<EffKey, CanChange>> = {
  agency: {
    open: "all", running_late: "all", closed_today: "all", storm_dated: "all", storm_open: "all",
    closed_day: "all", expired_closed_today: "all",
  },
  owner: {
    open: "all", running_late: "all", closed_today: "all", storm_dated: "all", storm_open: "all",
    closed_day: "all", expired_closed_today: "all",
  },
  staff: {
    open: "late_only", running_late: "late_only", closed_today: null, storm_dated: null, storm_open: null,
    closed_day: null, expired_closed_today: "late_only",
  },
  technician: {
    open: null, running_late: null, closed_today: null, storm_dated: null, storm_open: null,
    closed_day: null, expired_closed_today: null,
  },
  none: {
    open: null, running_late: null, closed_today: null, storm_dated: null, storm_open: null,
    closed_day: null, expired_closed_today: null,
  },
};

// Every change is ok once `canChangeFor` says "all" (the agency or an Owner).
const ALL_OK: Record<ChangeKey, Verdict> = { open: OK, closed_today: OK, running_late_30: OK, storm_dated: OK, storm_open: OK };
// Staff, mid-closure: `canChangeFor` says null, but Staff is still staff — refused close_or_reopen, never role.
const ALL_CLOSE: Record<ChangeKey, Verdict> = { open: CLOSE, closed_today: CLOSE, running_late_30: CLOSE, storm_dated: CLOSE, storm_open: CLOSE };
// A Technician, or an unsettled role: refused role, whatever the change.
const ALL_ROLE: Record<ChangeKey, Verdict> = { open: ROLE, closed_today: ROLE, running_late_30: ROLE, storm_dated: ROLE, storm_open: ROLE };
// Staff while open or running late: may run late or reopen, refused close_or_reopen for closing or a storm.
const LATE_ONLY: Record<ChangeKey, Verdict> = { open: OK, closed_today: CLOSE, running_late_30: OK, storm_dated: CLOSE, storm_open: CLOSE };

/** The 5×7×5 = 175-cell table for `mayChangeStatus` (spec §7, plan "The guard"), written out by hand —
 *  each ROW below (one per role × effective) is one of the four hand-written verdict rows above. */
const MAY_CHANGE: Record<RoleKey, Record<EffKey, Record<ChangeKey, Verdict>>> = {
  agency: {
    open: ALL_OK, running_late: ALL_OK, closed_today: ALL_OK, storm_dated: ALL_OK, storm_open: ALL_OK,
    closed_day: ALL_OK, expired_closed_today: ALL_OK,
  },
  owner: {
    open: ALL_OK, running_late: ALL_OK, closed_today: ALL_OK, storm_dated: ALL_OK, storm_open: ALL_OK,
    closed_day: ALL_OK, expired_closed_today: ALL_OK,
  },
  staff: {
    open: LATE_ONLY, running_late: LATE_ONLY, closed_today: ALL_CLOSE, storm_dated: ALL_CLOSE,
    storm_open: ALL_CLOSE, closed_day: ALL_CLOSE, expired_closed_today: LATE_ONLY,
  },
  technician: {
    open: ALL_ROLE, running_late: ALL_ROLE, closed_today: ALL_ROLE, storm_dated: ALL_ROLE, storm_open: ALL_ROLE,
    closed_day: ALL_ROLE, expired_closed_today: ALL_ROLE,
  },
  none: {
    open: ALL_ROLE, running_late: ALL_ROLE, closed_today: ALL_ROLE, storm_dated: ALL_ROLE, storm_open: ALL_ROLE,
    closed_day: ALL_ROLE, expired_closed_today: ALL_ROLE,
  },
};

type CanChangeCell = { role: RoleKey; eff: EffKey; expected: CanChange };
const CAN_CHANGE_CELLS: CanChangeCell[] = ROLE_KEYS.flatMap(
  (role) => EFF_KEYS.map((eff) => ({ role, eff, expected: CAN_CHANGE[role][eff] })),
);

type MayChangeCell = { role: RoleKey; eff: EffKey; change: ChangeKey; expected: Verdict };
const MAY_CHANGE_CELLS: MayChangeCell[] = ROLE_KEYS.flatMap(
  (role) => EFF_KEYS.flatMap((eff) => CHANGE_KEYS.map((change) => ({ role, eff, change, expected: MAY_CHANGE[role][eff][change] }))),
);

describe("canChangeFor — the 5 × 7 = 35-cell table (spec §7)", () => {
  it("has exactly 35 cells", () => {
    expect(CAN_CHANGE_CELLS.length).toBe(35);
  });

  it.each(CAN_CHANGE_CELLS)("$role × $eff → $expected", ({ role, eff, expected }) => {
    expect(canChangeFor(ACTORS[role], EFFECTIVES[eff])).toBe(expected);
  });
});

describe("mayChangeStatus — the 5 × 7 × 5 = 175-cell table (spec §7)", () => {
  it("has exactly 175 cells", () => {
    expect(MAY_CHANGE_CELLS.length).toBe(175);
  });

  it.each(MAY_CHANGE_CELLS)("$role × $eff × $change → $expected", ({ role, eff, change, expected }) => {
    expect(mayChangeStatus(ACTORS[role], EFFECTIVES[eff], CHANGES[change])).toEqual(expected);
  });
});

describe("the two sentences the guard's reason maps to (spec §5.2, §6, exact)", () => {
  it("close_or_reopen", () => {
    expect(mayChangeStatus(ACTORS.staff, EFFECTIVES.closed_today, CHANGES.open))
      .toEqual({ ok: false, reason: "close_or_reopen" });
  });
  it("role", () => {
    expect(mayChangeStatus(ACTORS.technician, EFFECTIVES.open, CHANGES.closed_today))
      .toEqual({ ok: false, reason: "role" });
  });
});
