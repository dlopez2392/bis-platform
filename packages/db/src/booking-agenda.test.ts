import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createStaffJob, createBooking, moveBooking, listBookedRanges, listDueReminders, getDueReminderById,
  listAgendaBookings, readAgendaJob, jobWasTold, countAwaitingOutcomeBefore, claimJobHold, stampJobNoticeSent,
  setJobNotice, listDueJobHolds, deleteUnsettledStaffJob, undoStaffMove, editJobDetails, listFeedBookings,
  SlotTakenError, AGENDA_ROW_CAP, type StaffJobInput,
} from "./booking";

/**
 * F-046 part 1 (plan Task 4): the query layer's calls, without a database. A SCRIPTED fake: every
 * `from()` and `rpc()` takes the next answer off a queue (in call order) and records each builder call,
 * so a missing filter, a wrong comparison or an extra write shows up as the call it is. The live round
 * trips (the trigger's 23P01 through PostgREST, the place embed, the hold against reminders) are
 * ./test/booking.test.ts's "F-046 part 1" describe, proven on CI only.
 */
type Call = [string, ...unknown[]];
type Answer = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };
type Entry = { kind: "from" | "rpc"; name: string; calls: Call[] };

const OPS = ["select", "insert", "upsert", "update", "delete", "eq", "neq", "gt", "gte", "lt", "lte", "in", "is",
  "not", "or", "order", "limit", "single", "maybeSingle"];

function scripted(answers: Answer[]) {
  const queue = [...answers];
  const log: Entry[] = [];
  const take = () => {
    const a = queue.shift();
    if (!a) throw new Error(`fake: no answer left for call ${log.length}`);
    return { data: a.data ?? null, error: a.error ?? null, count: a.count === undefined ? null : a.count };
  };
  const db = {
    from(table: string) {
      const entry: Entry = { kind: "from", name: table, calls: [] };
      log.push(entry);
      const result = take();
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      for (const op of OPS) chain[op] = (...args: unknown[]) => { entry.calls.push([op, ...args]); return chain; };
      return chain;
    },
    rpc(fn: string, args: unknown) {
      log.push({ kind: "rpc", name: fn, calls: [["args", args]] });
      return Promise.resolve(take());
    },
  };
  return { db: db as unknown as SupabaseClient, log, left: () => queue.length };
}

const ACCT = "acct_1";
const NOW = "2027-03-01T12:00:00.000Z";
const HOLD_FILTER = "hold_until.is.null,hold_settled_at.not.is.null";

afterEach(() => { vi.useRealTimers(); });

const STAFF: StaffJobInput = {
  calendarId: "cal_1", contactId: "ct_1",
  startsAt: new Date("2027-04-01T15:00:00Z"), endsAt: new Date("2027-04-01T16:00:00Z"),
  note: "Fix the gate", placeId: "pl_1", meetingType: "in_person", meetingUrl: null,
  holdUntil: new Date("2027-03-01T12:00:15Z"), noticeWanted: "confirmation", closureKept: false,
};

/** The insert createBooking writes TODAY, key for key (0073's author columns included). */
const TODAY_INSERT = {
  account_id: ACCT, calendar_id: "cal_1", contact_id: "ct_1",
  starts_at: "2027-04-01T15:00:00.000Z", ends_at: "2027-04-01T16:00:00.000Z",
  note: null, cancel_token: expect.any(String), booker_timezone: null, ip_hash: null, meeting_url: null,
  rescheduled_from_id: null, author_kind: "customer", author_id: null,
};

describe("createStaffJob — a job a person books on the dashboard", () => {
  it("inserts the person-made row with the place, meeting type, hold and notice, no booker zone, and closure_kept_at NULL when the closed warning was not accepted; writes NO event (mutation: always stamp closure_kept_at → FAILS; mutation: emit booking.created → a second query, on events, FAILS)", async () => {
    const { db, log } = scripted([{ data: { id: "bk_new" } }]);
    const out = await createStaffJob(db, ACCT, STAFF, "user_1");
    expect(log).toHaveLength(1);
    expect(log[0]!.name).toBe("bookings");
    expect(log[0]!.calls).toStrictEqual([
      ["insert", {
        account_id: ACCT, calendar_id: "cal_1", contact_id: "ct_1",
        starts_at: "2027-04-01T15:00:00.000Z", ends_at: "2027-04-01T16:00:00.000Z",
        note: "Fix the gate", cancel_token: expect.any(String), booker_timezone: null, ip_hash: null, meeting_url: null,
        rescheduled_from_id: null, author_kind: "person", author_id: "user_1",
        place_id: "pl_1", meeting_type: "in_person", hold_until: "2027-03-01T12:00:15.000Z",
        notice_wanted: "confirmation", closure_kept_at: null,
      }],
      ["select", "id"], ["single"],
    ]);
    const inserted = log[0]!.calls[0]![1] as { cancel_token: string };
    expect(out).toEqual({ id: "bk_new", cancelToken: inserted.cancel_token });
  });

  it("stamps closure_kept_at with now when the closed warning was accepted, and carries a video room and no notice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const { db, log } = scripted([{ data: { id: "bk_new" } }]);
    await createStaffJob(db, ACCT, { ...STAFF, closureKept: true, meetingType: "video", meetingUrl: "https://room", noticeWanted: null, note: null, placeId: null }, "user_1");
    const insert = log[0]!.calls[0]![1] as Record<string, unknown>;
    expect([insert.closure_kept_at, insert.meeting_type, insert.meeting_url, insert.notice_wanted, insert.note, insert.place_id])
      .toEqual([NOW, "video", "https://room", null, null, null]);
  });

  it("a 23P01 answer (the trigger's refusal or the constraint's) throws SlotTakenError; any other error names the function", async () => {
    const overlap = scripted([{ error: { code: "23P01", message: "bookings_no_overlap: overlaps a job staff booked" } }]);
    await expect(createStaffJob(overlap.db, ACCT, STAFF, "user_1")).rejects.toBeInstanceOf(SlotTakenError);
    const boom = scripted([{ error: { code: "23514", message: "boom" } }]);
    await expect(createStaffJob(boom.db, ACCT, STAFF, "user_1")).rejects.toThrow("createStaffJob failed: boom");
  });
});

describe("createBooking — unchanged by F-046", () => {
  it("inserts exactly the object it wrote before 0107, no new key (mutation: give insertBookingRow's `extra` a default of { place_id: null } → FAILS)", async () => {
    const { db, log } = scripted([{ data: { id: "bk_1" } }, {}]);
    await createBooking(db, ACCT, { calendarId: "cal_1", contactId: "ct_1",
      startsAt: new Date("2027-04-01T15:00:00Z"), endsAt: new Date("2027-04-01T16:00:00Z") }, "public", "system");
    expect(log[0]!.calls[0]).toStrictEqual(["insert", TODAY_INSERT]);
    expect(log.map((e) => e.name)).toEqual(["bookings", "events"]);
  });
});

describe("moveBooking — what the new row carries", () => {
  const OLD = { id: "old", calendar_id: "cal_1", contact_id: "ct_1", note: "Old note", booker_timezone: "America/Chicago",
    status: "booked", place_id: "pl_1", meeting_type: "phone" };
  const to = { startsAt: new Date("2027-04-02T15:00:00Z"), endsAt: new Date("2027-04-02T16:00:00Z") };
  const newRowBase = {
    account_id: ACCT, calendar_id: "cal_1", contact_id: "ct_1",
    starts_at: "2027-04-02T15:00:00.000Z", ends_at: "2027-04-02T16:00:00.000Z",
    cancel_token: expect.any(String), booker_timezone: "America/Chicago", ip_hash: null, meeting_url: null,
    rescheduled_from_id: "old",
  };

  it("without `job`: reads the old row's place and meeting type and copies both into the new row, and writes its two events as today (mutation: omit them from the insert → FAILS)", async () => {
    const { db, log } = scripted([{ data: OLD }, { data: { id: "new" } }, { data: [{ id: "old" }] }, {}, {}]);
    const out = await moveBooking(db, ACCT, "old", to, "public", "system");
    expect(log[0]!.calls[0]).toEqual(["select", "id, calendar_id, contact_id, note, booker_timezone, status, place_id, meeting_type"]);
    expect(log[1]!.calls[0]).toStrictEqual(["insert", {
      ...newRowBase, note: "Old note", author_kind: "customer", author_id: null, place_id: "pl_1", meeting_type: "phone",
    }]);
    expect(log.map((e) => e.name)).toEqual(["bookings", "bookings", "bookings", "events", "events"]);
    expect(log[3]!.calls[0]![1]).toMatchObject({ type: "booking.created", payload: { bookingId: "new" } });
    expect(log[4]!.calls[0]![1]).toMatchObject({ type: "booking.status_changed", payload: { bookingId: "old", status: "cancelled" } });
    expect(out.id).toBe("new");
  });

  it("without `job`, an old row with neither carries NULLs, never undefined keys", async () => {
    const { db, log } = scripted([{ data: { ...OLD, place_id: null, meeting_type: null } }, { data: { id: "new" } }, { data: [{ id: "old" }] }, {}, {}]);
    await moveBooking(db, ACCT, "old", to, "public", "system");
    const insert = log[1]!.calls[0]![1] as Record<string, unknown>;
    expect([insert.place_id, insert.meeting_type]).toStrictEqual([null, null]);
  });

  it("with `job` (a staff move): note, place, meeting type, hold and closure keep come from the job, notice_wanted is NULL, and NO event is written (mutation: ignore job.note → FAILS; mutation: emit as today → two events queries, FAILS)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const { db, log, left } = scripted([{ data: OLD }, { data: { id: "new" } }, { data: [{ id: "old" }] }]);
    const out = await moveBooking(db, ACCT, "old", { ...to, meetingUrl: "https://room", job: {
      note: "New note", placeId: "pl_2", meetingType: "video", holdUntil: new Date("2027-03-01T12:00:15Z"), closureKept: true,
    } }, "user_1");
    expect(log[1]!.calls[0]).toStrictEqual(["insert", {
      ...newRowBase, meeting_url: "https://room", note: "New note", author_kind: "person", author_id: "user_1",
      place_id: "pl_2", meeting_type: "video", hold_until: "2027-03-01T12:00:15.000Z", notice_wanted: null,
      closure_kept_at: NOW,
    }]);
    expect(log.map((e) => e.name)).toEqual(["bookings", "bookings", "bookings"]);
    expect(left()).toBe(0);
    expect(out.id).toBe("new");
  });

  it("with `job`, a null note and no closure keep write NULLs (the job's own values, not the old row's)", async () => {
    const { db, log } = scripted([{ data: OLD }, { data: { id: "new" } }, { data: [{ id: "old" }] }]);
    await moveBooking(db, ACCT, "old", { ...to, job: {
      note: null, placeId: null, meetingType: "in_person", holdUntil: new Date("2027-03-01T12:00:15Z"), closureKept: false,
    } }, "user_1");
    const insert = log[1]!.calls[0]![1] as Record<string, unknown>;
    expect([insert.note, insert.place_id, insert.meeting_type, insert.closure_kept_at]).toStrictEqual([null, null, "in_person", null]);
  });
});

describe("listBookedRanges — names each range", () => {
  it("selects id with the range, so a warning can name the jobs it overlaps (plan correction 10)", async () => {
    const row = { id: "b1", starts_at: "2027-04-01T15:00:00+00:00", ends_at: "2027-04-01T16:00:00+00:00" };
    const { db, log } = scripted([{ data: [row] }]);
    expect(await listBookedRanges(db, "cal_1", "2027-04-01T00:00:00Z", "2027-04-02T00:00:00Z")).toEqual([row]);
    expect(log[0]!.calls[0]).toEqual(["select", "id, starts_at, ends_at"]);
  });
});

describe("listDueReminders — a staff job waits for its hold to SETTLE (plan review item 4)", () => {
  it("both reads carry the claim filter, never a clock one (mutation: `hold_until.lte.<now>` → FAILS; mutation: only the day-before read filters → the late read's pin FAILS)", async () => {
    const { db, log } = scripted([{ data: [] }, { data: [] }]);
    expect(await listDueReminders(db, NOW)).toEqual([]);
    expect(log.map((e) => e.name)).toEqual(["bookings", "bookings"]);
    expect(log[0]!.calls).toEqual([
      ["select", expect.any(String)], ["eq", "status", "booked"], ["is", "reminder_sent_at", null], ["or", HOLD_FILTER],
      ["gte", "starts_at", "2027-03-02T11:00:00.000Z"], ["lte", "starts_at", "2027-03-02T12:15:00.000Z"],
      ["order", "starts_at", { ascending: true }],
    ]);
    expect(log[1]!.calls).toEqual([
      ["select", expect.any(String)], ["eq", "status", "booked"], ["is", "reminder_sent_at", null], ["or", HOLD_FILTER],
      ["gte", "starts_at", "2027-03-01T15:00:00.000Z"], ["lte", "starts_at", "2027-03-01T16:15:00.000Z"],
      ["lte", "created_at", "2027-03-01T11:00:00.000Z"], ["order", "starts_at", { ascending: true }],
    ]);
  });

  it("getDueReminderById adds NO hold filter: a by-id read only ever meets a row a due-list already let through (plan correction 3)", async () => {
    const { db, log } = scripted([{ data: null }]);
    expect(await getDueReminderById(db, "bk_1")).toEqual({ due: null, why: "gone" });
    expect(log[0]!.calls).toEqual([
      ["select", expect.any(String)], ["eq", "id", "bk_1"], ["eq", "status", "booked"], ["is", "reminder_sent_at", null], ["maybeSingle"],
    ]);
  });
});

describe("listAgendaBookings — every booking overlapping the window", () => {
  const FROM = "2027-04-01T05:00:00.000Z";
  const TO = "2027-04-02T05:00:00.000Z";
  const row = (id: string, status: string) => ({ id, status, starts_at: "s", ends_at: "e", contact: null, place: null });
  const AGENDA_SELECT = "id, contact_id, starts_at, ends_at, status, note, author_kind, author_id, meeting_type, meeting_url, place_id, "
    + "confirm_reply, hold_until, hold_settled_at, notice_wanted, notice_sent_at, rescheduled_from_id, created_at, "
    + "contact:contacts!bookings_contact_id_fkey(first_name, last_name, phone, email), place:places!bookings_place_fkey(label, address)";

  it("filters on overlap (starts before the end AND ends after the start: a 23:00-01:00 job is on both days), soonest first then by id, at most the cap plus one (mutation: filter on starts_at only → FAILS)", async () => {
    const { db, log } = scripted([{ data: [row("b1", "booked")] }]);
    const out = await listAgendaBookings(db, ACCT, FROM, TO);
    expect(log[0]!.calls).toEqual([
      ["select", AGENDA_SELECT], ["eq", "account_id", ACCT], ["lt", "starts_at", TO], ["gt", "ends_at", FROM],
      ["order", "starts_at", { ascending: true }], ["order", "id", { ascending: true }], ["limit", AGENDA_ROW_CAP + 1],
    ]);
    expect(out).toEqual({ rows: [{ ...row("b1", "booked"), replaced: false }], truncated: false });
    expect(log).toHaveLength(1);   // no cancelled row → no second read
  });

  it("marks `replaced` only on a cancelled row another row names, in ONE extra read (mutation: mark every cancelled row → c2 reads replaced, FAILS)", async () => {
    const { db, log } = scripted([
      { data: [row("b1", "booked"), row("c1", "cancelled"), row("c2", "cancelled")] },
      { data: [{ rescheduled_from_id: "c1" }] },
    ]);
    const out = await listAgendaBookings(db, ACCT, FROM, TO);
    expect(log[1]!.calls).toEqual([
      ["select", "rescheduled_from_id"], ["eq", "account_id", ACCT], ["in", "rescheduled_from_id", ["c1", "c2"]],
    ]);
    expect(out.rows.map((r) => [r.id, r.replaced])).toEqual([["b1", false], ["c1", true], ["c2", false]]);
  });

  it("asks about at most 200 ids per read (rescheduleRoots' URL bound), so a window full of cancels still reads", async () => {
    const many = Array.from({ length: 250 }, (_, i) => row(`c${i}`, "cancelled"));
    const { db, log } = scripted([{ data: many }, { data: [{ rescheduled_from_id: "c0" }] }, { data: [{ rescheduled_from_id: "c249" }] }]);
    const out = await listAgendaBookings(db, ACCT, FROM, TO);
    expect(log.slice(1).map((e) => (e.calls[2]![2] as string[]).length)).toEqual([200, 50]);
    expect(out.rows.filter((r) => r.replaced).map((r) => r.id)).toEqual(["c0", "c249"]);
  });

  it("answers `truncated` with exactly the cap when the read returned the cap plus one", async () => {
    const full = Array.from({ length: AGENDA_ROW_CAP + 1 }, (_, i) => row(`b${i}`, "booked"));
    const { db } = scripted([{ data: full }]);
    const out = await listAgendaBookings(db, ACCT, FROM, TO);
    expect([out.rows.length, out.truncated, AGENDA_ROW_CAP]).toEqual([400, true, 400]);
    const exact = scripted([{ data: full.slice(0, AGENDA_ROW_CAP) }]);
    expect((await listAgendaBookings(exact.db, ACCT, FROM, TO)).truncated).toBe(false);
  });

  it("THROWS on either read's error", async () => {
    await expect(listAgendaBookings(scripted([{ error: { message: "boom" } }]).db, ACCT, FROM, TO))
      .rejects.toThrow("listAgendaBookings failed: boom");
    await expect(listAgendaBookings(scripted([{ data: [row("c1", "cancelled")] }, { error: { message: "bang" } }]).db, ACCT, FROM, TO))
      .rejects.toThrow("listAgendaBookings (replaced) failed: bang");
  });

  it("readAgendaJob reads one row the same way, and tells a replaced cancelled row from a plain cancel (mutation: answer replaced:false always → FAILS)", async () => {
    const { db, log } = scripted([{ data: row("c1", "cancelled") }, { data: [{ id: "n1" }] }]);
    expect(await readAgendaJob(db, ACCT, "c1")).toEqual({ ...row("c1", "cancelled"), replaced: true });
    expect(log[0]!.calls).toEqual([["select", AGENDA_SELECT], ["eq", "account_id", ACCT], ["eq", "id", "c1"], ["maybeSingle"]]);
    const live = scripted([{ data: row("b1", "booked") }]);
    expect(await readAgendaJob(live.db, ACCT, "b1")).toEqual({ ...row("b1", "booked"), replaced: false });
    expect(live.log).toHaveLength(1);
    expect(await readAgendaJob(scripted([{ data: null }]).db, ACCT, "x")).toBeNull();
  });
});

describe("jobWasTold — does the customer already know this appointment", () => {
  const hop = (author_kind: string, notice_sent_at: string | null, rescheduled_from_id: string | null) =>
    ({ data: { author_kind, notice_sent_at, rescheduled_from_id } });

  it("a chain whose first row the customer made → true, reading each hop account-scoped", async () => {
    const { db, log } = scripted([hop("person", null, "r"), hop("customer", null, null)]);
    expect(await jobWasTold(db, ACCT, "n")).toBe(true);
    expect(log.map((e) => e.calls)).toEqual([
      [["select", "author_kind, notice_sent_at, rescheduled_from_id"], ["eq", "account_id", ACCT], ["eq", "id", "n"], ["maybeSingle"]],
      [["select", "author_kind, notice_sent_at, rescheduled_from_id"], ["eq", "account_id", ACCT], ["eq", "id", "r"], ["maybeSingle"]],
    ]);
  });

  it("Sofía's first row → true", async () => {
    expect(await jobWasTold(scripted([hop("ai", null, null)]).db, ACCT, "n")).toBe(true);
  });

  it("a person chain whose middle row had its email sent → true, without reading further", async () => {
    const s = scripted([hop("person", null, "m"), hop("person", "2027-03-01T12:00:20Z", "r")]);
    expect(await jobWasTold(s.db, ACCT, "n")).toBe(true);
    expect(s.left()).toBe(0);
  });

  it("a person chain with no email anywhere → false; an unreadable row → false; a read error THROWS", async () => {
    expect(await jobWasTold(scripted([hop("person", null, "r"), hop("person", null, null)]).db, ACCT, "n")).toBe(false);
    expect(await jobWasTold(scripted([{ data: null }]).db, ACCT, "n")).toBe(false);
    await expect(jobWasTold(scripted([{ error: { message: "boom" } }]).db, ACCT, "n")).rejects.toThrow("jobWasTold failed: boom");
  });
});

describe("countAwaitingOutcomeBefore — the 'earlier days' count", () => {
  it("counts booked rows that ended before the instant, exactly, head only", async () => {
    const { db, log } = scripted([{ count: 3 }]);
    expect(await countAwaitingOutcomeBefore(db, ACCT, NOW)).toBe(3);
    expect(log[0]!.calls).toEqual([
      ["select", "id", { count: "exact", head: true }], ["eq", "account_id", ACCT], ["eq", "status", "booked"], ["lt", "ends_at", NOW],
    ]);
  });

  it("THROWS on a count-less answer, never 'nothing waiting' (head-count-null; mutation: `count ?? 0` → FAILS)", async () => {
    await expect(countAwaitingOutcomeBefore(scripted([{ count: null }]).db, ACCT, NOW))
      .rejects.toThrow("countAwaitingOutcomeBefore failed: no count returned");
    await expect(countAwaitingOutcomeBefore(scripted([{ error: { message: "boom" } }]).db, ACCT, NOW))
      .rejects.toThrow("countAwaitingOutcomeBefore failed: boom");
  });
});

describe("the hold: claim, stamp, notice, due list", () => {
  const CLAIM_SELECT = "id, status, notice_wanted, starts_at, ends_at, contact_id, calendar_id, place_id, meeting_url, "
    + "cancel_token, rescheduled_from_id, author_id, hold_until, created_at";

  it("claimJobHold writes ONLY hold_settled_at, on a booked row whose hold is due and unclaimed (mutation: drop the `is` → FAILS; mutation: drop the status term → FAILS; never updated_at, plan correction 13)", async () => {
    const claimed = { id: "bk_1", status: "booked", notice_wanted: "confirmation" };
    const { db, log } = scripted([{ data: [claimed] }]);
    expect(await claimJobHold(db, ACCT, "bk_1", NOW)).toEqual(claimed);
    expect(log[0]!.calls).toStrictEqual([
      ["update", { hold_settled_at: NOW }], ["eq", "account_id", ACCT], ["eq", "id", "bk_1"], ["eq", "status", "booked"],
      ["lte", "hold_until", NOW], ["is", "hold_settled_at", null], ["select", CLAIM_SELECT],
    ]);
  });

  it("claimJobHold answers null when nothing was claimed, and THROWS on a write error", async () => {
    expect(await claimJobHold(scripted([{ data: [] }]).db, ACCT, "bk_1", NOW)).toBeNull();
    await expect(claimJobHold(scripted([{ error: { message: "boom" } }]).db, ACCT, "bk_1", NOW)).rejects.toThrow("claimJobHold failed: boom");
  });

  it("stampJobNoticeSent stamps notice_sent_at on this account's row only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const { db, log } = scripted([{}]);
    await stampJobNoticeSent(db, ACCT, "bk_1");
    expect(log[0]!.calls).toStrictEqual([["update", { notice_sent_at: NOW }], ["eq", "account_id", ACCT], ["eq", "id", "bk_1"]]);
    await expect(stampJobNoticeSent(scripted([{ error: { message: "boom" } }]).db, ACCT, "bk_1")).rejects.toThrow("stampJobNoticeSent failed: boom");
  });

  it("setJobNotice writes ONLY notice_wanted, and only while the row is held and unsettled; true = written", async () => {
    const { db, log } = scripted([{ data: [{ id: "bk_1" }] }]);
    expect(await setJobNotice(db, ACCT, "bk_1", "moved")).toBe(true);
    expect(log[0]!.calls).toStrictEqual([
      ["update", { notice_wanted: "moved" }], ["eq", "account_id", ACCT], ["eq", "id", "bk_1"],
      ["not", "hold_until", "is", null], ["is", "hold_settled_at", null], ["select", "id"],
    ]);
    expect(await setJobNotice(scripted([{ data: [] }]).db, ACCT, "bk_1", null)).toBe(false);
    await expect(setJobNotice(scripted([{ error: { message: "boom" } }]).db, ACCT, "bk_1", null)).rejects.toThrow("setJobNotice failed: boom");
  });

  it("listDueJobHolds reads booked rows only, due and unclaimed, oldest first, bounded, every account (mutation: drop the status term → FAILS)", async () => {
    const { db, log } = scripted([{ data: [{ id: "bk_1", account_id: "a1", hold_until: "h1" }] }]);
    expect(await listDueJobHolds(db, NOW, 25)).toEqual([{ accountId: "a1", bookingId: "bk_1", holdUntil: "h1" }]);
    expect(log[0]!.calls).toEqual([
      ["select", "id, account_id, hold_until"], ["eq", "status", "booked"], ["lte", "hold_until", NOW],
      ["is", "hold_settled_at", null], ["order", "hold_until", { ascending: true }], ["limit", 25],
    ]);
    await expect(listDueJobHolds(scripted([{ error: { message: "boom" } }]).db, NOW, 25)).rejects.toThrow("listDueJobHolds failed: boom");
  });
});

describe("deleteUnsettledStaffJob — the Undo of an add", () => {
  it("deletes only this person's own unsettled ADD (never a move's row) → 'deleted' (mutation: drop `is(hold_settled_at)` → FAILS; mutation: drop the rescheduled_from_id term → FAILS)", async () => {
    const { db, log } = scripted([{ data: [{ id: "bk_1" }] }]);
    expect(await deleteUnsettledStaffJob(db, ACCT, "bk_1", "user_1")).toBe("deleted");
    expect(log[0]!.calls).toEqual([
      ["delete"], ["eq", "account_id", ACCT], ["eq", "id", "bk_1"], ["eq", "author_kind", "person"], ["eq", "author_id", "user_1"],
      ["eq", "status", "booked"], ["is", "rescheduled_from_id", null], ["is", "hold_settled_at", null], ["not", "hold_until", "is", null],
      ["select", "id"],
    ]);
    expect(log).toHaveLength(1);
  });

  const zeroThen = (row: unknown, ...more: Answer[]) => scripted([{ data: [] }, { data: row }, ...more]);
  const base = { status: "booked", author_id: "user_1", hold_settled_at: null, rescheduled_from_id: null };

  it.each([
    ["is_move", { ...base, rescheduled_from_id: "old" }],
    ["settled", { ...base, hold_settled_at: "2027-03-01T12:00:16Z" }],
    ["not_yours", { ...base, author_id: "user_2" }],
    ["gone", null],
  ])("zero rows, then one re-read → '%s'", async (want, row) => {
    const { db, log } = zeroThen(row);
    expect(await deleteUnsettledStaffJob(db, ACCT, "bk_1", "user_1")).toBe(want);
    expect(log[1]!.calls).toEqual([
      ["select", "status, author_id, hold_settled_at, rescheduled_from_id"], ["eq", "account_id", ACCT], ["eq", "id", "bk_1"], ["maybeSingle"],
    ]);
  });

  it("zero rows, the row cancelled AND a move replaced it → 'moved'", async () => {
    const { db, log } = zeroThen({ ...base, status: "cancelled" }, { data: [{ id: "next" }] });
    expect(await deleteUnsettledStaffJob(db, ACCT, "bk_1", "user_1")).toBe("moved");
    expect(log[2]!.calls).toEqual([["select", "id"], ["eq", "account_id", ACCT], ["eq", "rescheduled_from_id", "bk_1"], ["limit", 1]]);
  });

  it("THROWS on the delete's or the re-read's error", async () => {
    await expect(deleteUnsettledStaffJob(scripted([{ error: { message: "boom" } }]).db, ACCT, "bk_1", "user_1"))
      .rejects.toThrow("deleteUnsettledStaffJob failed: boom");
    await expect(deleteUnsettledStaffJob(scripted([{ data: [] }, { error: { message: "bang" } }]).db, ACCT, "bk_1", "user_1"))
      .rejects.toThrow("deleteUnsettledStaffJob re-read failed: bang");
  });
});

describe("undoStaffMove — the Undo of a staff move, one RPC", () => {
  const ARGS = { p_account_id: ACCT, p_new_id: "new", p_old_id: "old", p_cancelled_at: "2027-03-01T12:00:00.123456Z", p_now: NOW };
  const call = (db: SupabaseClient) => undoStaffMove(db, ACCT, "new", "old", "2027-03-01T12:00:00.123456Z", new Date(NOW));

  it.each(["undone", "gone", "too_late", "time_taken", "changed"])("passes '%s' through, naming every argument", async (answer) => {
    const { db, log } = scripted([{ data: answer }]);
    expect(await call(db)).toBe(answer);
    expect(log).toEqual([{ kind: "rpc", name: "undo_staff_move", calls: [["args", ARGS]] }]);
  });

  it("THROWS on an answer it does not know, and on an error", async () => {
    await expect(call(scripted([{ data: "rebooked" }]).db)).rejects.toThrow("undoStaffMove: unexpected answer rebooked");
    await expect(call(scripted([{ error: { code: "42501", message: "denied" } }]).db)).rejects.toThrow("undoStaffMove failed: denied");
  });

  it("a deadlock (40P01) is run again ONCE: the RPC is one transaction, so a deadlock wrote nothing (T1 carry-in; mutation: drop the retry → FAILS)", async () => {
    const dead = { error: { code: "40P01", message: "deadlock detected" } };
    const once = scripted([dead, { data: "undone" }]);
    expect(await call(once.db)).toBe("undone");
    expect(once.log.map((e) => e.name)).toEqual(["undo_staff_move", "undo_staff_move"]);
    const twice = scripted([dead, dead, { data: "undone" }]);
    await expect(call(twice.db)).rejects.toThrow("undoStaffMove failed: deadlock detected");
    expect(twice.left()).toBe(1);
  });
});

describe("editJobDetails — a Move that keeps the time is a compare-and-set", () => {
  it("writes the four details and nothing else, on a booked row still carrying what the form opened with: `is` for a NULL, `eq` otherwise (mutation: `.eq(col, null)` → FAILS; never updated_at)", async () => {
    const { db, log } = scripted([{ data: [{ id: "bk_1" }] }]);
    const ok = await editJobDetails(db, ACCT, "bk_1",
      { note: "old", placeId: null, meetingType: "phone", meetingUrl: null },
      { note: "new", placeId: "pl_1", meetingType: "video", meetingUrl: "https://room" });
    expect(ok).toBe(true);
    expect(log[0]!.calls).toStrictEqual([
      ["update", { note: "new", place_id: "pl_1", meeting_type: "video", meeting_url: "https://room" }],
      ["eq", "account_id", ACCT], ["eq", "id", "bk_1"], ["eq", "status", "booked"],
      ["eq", "note", "old"], ["is", "place_id", null], ["eq", "meeting_type", "phone"], ["is", "meeting_url", null],
      ["select", "id"],
    ]);
  });

  it("answers false when the row moved on, and THROWS on a write error", async () => {
    const d = { note: null, placeId: null, meetingType: null, meetingUrl: null };
    expect(await editJobDetails(scripted([{ data: [] }]).db, ACCT, "bk_1", d, d)).toBe(false);
    await expect(editJobDetails(scripted([{ error: { message: "boom" } }]).db, ACCT, "bk_1", d, d)).rejects.toThrow("editJobDetails failed: boom");
  });
});

describe("listFeedBookings — each row's own meeting type", () => {
  it("selects meeting_type and carries it per row, NULL meaning the calendar's (mutation: drop it from the select → FAILS)", async () => {
    const r = (id: string, meeting_type: string | null) => ({ id, status: "booked", starts_at: "s", ends_at: "e", updated_at: "u",
      created_at: "c", rescheduled_from_id: null, meeting_type, contacts: { first_name: "Ana", assigned_to: null } });
    const { db, log } = scripted([{ data: { id: "cal_1", meeting_type: "video" } }, { data: [r("u1", "phone")] }, { data: [r("p1", null)] }]);
    const out = await listFeedBookings(db, ACCT, { now: new Date(NOW), technicianUserId: null });
    expect(log[1]!.calls[0]).toEqual(["select",
      "id, status, starts_at, ends_at, updated_at, created_at, rescheduled_from_id, meeting_type, contacts!inner(first_name, assigned_to)"]);
    expect(out.meetingType).toBe("video");
    expect(out.rows.map((x) => [x.id, x.meeting_type])).toEqual([["p1", null], ["u1", "phone"]]);
  });
});
