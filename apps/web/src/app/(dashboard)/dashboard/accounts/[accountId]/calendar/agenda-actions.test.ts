import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-046 part 1 (spec 6.1-6.3, plan Task 10): the agenda's server actions. Every @bis/db call is a named spy that
 * records itself in `calls`, so "nothing was written" and "contact, then place, then booking" are read off the
 * order the action actually asked for things, and "on the request client" off the client each spy was handed.
 * The settle itself (job-hold.ts) is job-hold.test.ts's; here it is a spy, run by hand from the captured after().
 */
const h = vi.hoisted(() => ({
  calls: [] as string[],
  REQ: { client: "request" },
  SVC: { client: "service" },
  afters: [] as (() => unknown)[],
  accessOpts: [] as unknown[],
  access: { userId: "user_1", isAgency: true, role: null, canManage: true } as
    { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean },
}));
const rec = <A extends unknown[], R>(name: string, impl: (...a: A) => R) => (...a: A): R => { h.calls.push(name); return impl(...a); };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { h.calls.push("after"); h.afters.push(fn); } }));
vi.mock("@/lib/email/origin", () => ({ originFrom: () => "https://app.test" }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async (_accountId: string, opts?: unknown) => { h.calls.push("access"); h.accessOpts.push(opts); return h.access; },
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => { h.calls.push("dbForRequest"); return h.REQ; } }));
const visible = vi.hoisted(() => ({ callerCanSee: vi.fn() }));
vi.mock("@/lib/auth/visible", () => ({ callerCanSee: visible.callerCanSee }));
const provider = vi.hoisted(() => ({ get: vi.fn(), createMeetingRoom: vi.fn() }));
vi.mock("@/lib/meetings/provider", () => ({ getMeetingProvider: provider.get }));
const hold = vi.hoisted(() => ({ settleAfterWindow: vi.fn(), jobNoticeAvailability: vi.fn() }));
vi.mock("./job-hold", () => ({ settleAfterWindow: hold.settleAfterWindow, jobNoticeAvailability: hold.jobNoticeAvailability }));
const avail = vi.hoisted(() => ({ readSlotClosures: vi.fn() }));
vi.mock("@/lib/booking/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/booking/availability")>()), readSlotClosures: avail.readSlotClosures,
}));
const db = vi.hoisted(() => ({
  serviceDb: vi.fn(), getCalendarForAccount: vi.fn(), readAccountTimezone: vi.fn(), getContact: vi.fn(),
  listContactsOnNumber: vi.fn(), createContact: vi.fn(), readPersonId: vi.fn(), listContactPlaces: vi.fn(), addPlace: vi.fn(),
  listBookedRanges: vi.fn(), createStaffJob: vi.fn(), moveBooking: vi.fn(), setJobNotice: vi.fn(), readAgendaJob: vi.fn(),
  deleteUnsettledStaffJob: vi.fn(), undoStaffMove: vi.fn(), editJobDetails: vi.fn(), emit: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { BookingNotMovableError, type AgendaBookingRow } from "@bis/db";
import {
  addJobAction, undoAddJobAction, moveJobAction, undoMoveJobAction, undoEditJobAction, jobNoticeOptionAction,
  type JobDraft, type JobFields, type JobOpened,
} from "./agenda-actions";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";

const NOW = new Date("2026-11-02T15:00:00.000Z");      // Monday 09:00 in Chicago (CST, UTC-6)
const ACCT = "acct_1";
const C1 = "11111111-1111-4111-8111-111111111111";     // Ana García
const C2 = "22222222-2222-4222-8222-222222222222";     // a contact the quick-add makes
const P1 = "33333333-3333-4333-8333-333333333333";     // Ana's place
const P2 = "66666666-6666-4666-8666-666666666666";     // someone else's place
const J1 = "44444444-4444-4444-8444-444444444444";     // the job
const NEW = "55555555-5555-4555-8555-555555555555";    // a new or moved-to row
const O1 = "77777777-7777-4777-8777-777777777777";     // jobs it may overlap
const O2 = "88888888-8888-4888-8888-888888888888";
const O3 = "99999999-9999-4999-8999-999999999999";
const PLACE_FIELDS = { label: "Home", address: "12 Elm St", landmark: "", directions: "", city: "", region: "", postal_code: "", country: "US" };

const CALENDAR = {
  id: "cal_1", account_id: ACCT, public_id: "pub123", enabled: true, slot_duration_minutes: 60, buffer_minutes: 15,
  min_notice_hours: 2, max_advance_days: 30, notify_emails: [], meeting_type: "in_person",
  open_hours: { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]] },
  followup_enabled: false, followup_body: "", followup_body_es: null, followup_body_es_basis: null,
};
const NO_CLOSURES = { closedDayKeys: new Set<string>(), blockedBefore: null, blockAll: false, lateBefore: null };
const ANA = { id: C1, first_name: "Ana", last_name: "García", email: "ana@example.test", archived_at: null, merged_into: null, holds_shared_number: false };

/** Tue 3 Nov 2026, 10:00-11:00 Chicago = 16:00-17:00 UTC: inside hours, past the notice, nothing booked. */
const draft = (over: Partial<JobDraft> = {}): JobDraft => ({
  date: "2026-11-03", start: "10:00", minutes: 60, what: "Fix the water heater", placeId: null, meetingType: "in_person",
  notify: true, customer: { kind: "existing", id: C1 }, ...over,
});
const at = (iso: string) => new Date(iso);
const writes = () => h.calls.filter((c) => ["createContact", "addPlace", "createStaffJob", "moveBooking", "setJobNotice",
  "deleteUnsettledStaffJob", "undoStaffMove", "editJobDetails", "emit", "createMeetingRoom"].includes(c));

const job = (over: Partial<AgendaBookingRow> = {}): AgendaBookingRow => ({
  id: J1, contact_id: C1, starts_at: "2026-11-03T16:00:00.000Z", ends_at: "2026-11-03T17:00:00.000Z", status: "booked",
  note: "Fix the water heater", author_kind: "person", author_id: "user_1", meeting_type: "in_person", meeting_url: null,
  place_id: null, confirm_reply: null, hold_until: null, hold_settled_at: null, notice_wanted: null, notice_sent_at: null,
  rescheduled_from_id: null, created_at: "2026-11-01T12:00:00.000Z",
  contact: { first_name: "Ana", last_name: "García", phone: null, email: "ana@example.test" }, place: null, replaced: false, ...over,
});
const OPENED: JobOpened = {
  startsAt: "2026-11-03T16:00:00.000Z", endsAt: "2026-11-03T17:00:00.000Z", note: "Fix the water heater",
  placeId: null, meetingType: "in_person", meetingUrl: null,
};
type Opened = JobOpened & { told: boolean };
/** What Move opened with, and whether the customer had been told about the job then (T10 review I2). */
const opened = (over: Partial<Opened> = {}): Opened => ({ ...OPENED, told: true, ...over });
/** Move the job to Wed 4 Nov, 10:00-11:00 Chicago = 16:00-17:00 UTC. */
const moveDraft = (over: Partial<JobFields & { opened: Opened }> = {}): JobFields & { opened: Opened } => ({
  date: "2026-11-04", start: "10:00", minutes: 60, what: "Fix the water heater", placeId: null, meetingType: "in_person",
  notify: true, opened: opened(), ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.calls.length = 0;
  h.afters.length = 0;
  h.accessOpts.length = 0;
  h.access = { userId: "user_1", isAgency: true, role: null, canManage: true };
  vi.spyOn(console, "error").mockImplementation(() => {});
  visible.callerCanSee.mockReset().mockImplementation(rec("prove", async () => true));
  provider.createMeetingRoom.mockReset().mockImplementation(rec("createMeetingRoom", async () => ({ url: "https://rio.daily.co/room1" })));
  provider.get.mockReset().mockReturnValue(null);
  hold.settleAfterWindow.mockReset().mockResolvedValue("sent");
  hold.jobNoticeAvailability.mockReset().mockImplementation(rec("jobNoticeAvailability", async () => "available"));
  avail.readSlotClosures.mockReset().mockImplementation(rec("readSlotClosures", async () => NO_CLOSURES));
  db.serviceDb.mockReset().mockImplementation(() => h.SVC);
  db.getCalendarForAccount.mockReset().mockImplementation(rec("getCalendarForAccount", async () => CALENDAR));
  db.readAccountTimezone.mockReset().mockImplementation(rec("readAccountTimezone", async () => "America/Chicago"));
  db.getContact.mockReset().mockImplementation(rec("getContact", async (_d: unknown, _a: string, id: string) => (id === C1 ? ANA : id === C2 ? { id: C2, first_name: "Beto", email: null } : null)));
  db.listContactsOnNumber.mockReset().mockImplementation(rec("listContactsOnNumber", async () => ({ rows: [], truncated: false })));
  db.createContact.mockReset().mockImplementation(rec("createContact", async () => ({ id: C2, existing: false, flagged: false })));
  db.readPersonId.mockReset().mockImplementation(rec("readPersonId", async () => "person_1"));
  db.listContactPlaces.mockReset().mockImplementation(rec("listContactPlaces", async () => ({
    groups: [], places: [{ id: P1, archived_at: null }], placeCount: 1, equipment: [], equipmentCount: 0,
  })));
  db.addPlace.mockReset().mockImplementation(rec("addPlace", async () => ({ id: P1 })));
  db.listBookedRanges.mockReset().mockImplementation(rec("listBookedRanges", async () => []));
  db.createStaffJob.mockReset().mockImplementation(rec("createStaffJob", async () => ({ id: NEW, cancelToken: "tok" })));
  db.moveBooking.mockReset().mockImplementation(rec("moveBooking", async () => ({ id: NEW, cancelToken: "tok2", cancelledAt: "2026-11-02T15:00:00.000123Z" })));
  db.setJobNotice.mockReset().mockImplementation(rec("setJobNotice", async () => true));
  db.readAgendaJob.mockReset().mockImplementation(rec("readAgendaJob", async () => job()));
  db.deleteUnsettledStaffJob.mockReset().mockImplementation(rec("deleteUnsettledStaffJob", async () => "deleted"));
  db.undoStaffMove.mockReset().mockImplementation(rec("undoStaffMove", async () => "undone"));
  db.editJobDetails.mockReset().mockImplementation(rec("editJobDetails", async () => true));
  db.emit.mockReset().mockImplementation(rec("emit", async () => undefined));
});
afterEach(() => { vi.useRealTimers(); });

const ALL_ACTIONS: [string, () => Promise<unknown>][] = [
  ["addJobAction", () => addJobAction(ACCT, draft(), [])],
  ["undoAddJobAction", () => undoAddJobAction(ACCT, J1)],
  ["moveJobAction", () => moveJobAction(ACCT, J1, moveDraft(), [])],
  ["undoMoveJobAction", () => undoMoveJobAction(ACCT, NEW, J1, "2026-11-02T15:00:00.000123Z")],
  ["undoEditJobAction", () => undoEditJobAction(ACCT, J1, OPENED, { ...OPENED, note: "x" })],
  ["jobNoticeOptionAction", () => jobNoticeOptionAction(ACCT, C1)],
];

describe("who may: Owners, Staff and the agency; never a Technician (spec 8.1, owner decision 1)", () => {
  it.each(ALL_ACTIONS)("%s refuses a Technician BEFORE any db call (mutation: drop the role check → a recorded call FAILS)", async (_n, run) => {
    h.access = { userId: "tech_1", isAgency: false, role: "technician", canManage: false };
    const r = await run() as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(h.calls).toEqual(["access"]);
  });

  it.each(ALL_ACTIONS)("%s refuses a client whose role could not be settled (fails closed)", async (_n, run) => {
    h.access = { userId: "u", isAgency: false, role: null, canManage: false };
    expect((await run() as { ok: boolean }).ok).toBe(false);
    expect(h.calls).toEqual(["access"]);
  });

  it.each(ALL_ACTIONS)("%s admits Staff, and none asks to run while the account is paused (no duringPause)", async (_n, run) => {
    h.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    await run();
    expect(h.calls.length).toBeGreaterThan(1);
    expect(h.accessOpts.every((o) => o === undefined || (o as { duringPause?: string }).duringPause === undefined)).toBe(true);
  });
});

describe("addJobAction: validation, before anything is read or written", () => {
  const bad: [string, Partial<JobDraft> | Record<string, unknown>][] = [
    // 721 is off the five-minute step as well, so "accept 721" alone could never fail this list: 725 is on the step.
    ["725 minutes (mutation: raise the bound past 720 → FAILS)", { minutes: 725 }],
    ["721 minutes", { minutes: 721 }],
    ["0 minutes", { minutes: 0 }],
    ["minutes off the five-minute step", { minutes: 62 }],
    ["fractional minutes", { minutes: 60.5 }],
    ["minutes as text", { minutes: "60" }],
    ["a start off the five-minute step", { start: "10:03" }],
    ["a start of 24:00", { start: "24:00" }],
    ["a one-digit hour", { start: "9:00" }],
    ["a date that does not exist", { date: "2026-02-30" }],
    ["a date that is not a date key", { date: "tomorrow" }],
    ["a what of 201 characters", { what: "x".repeat(201) }],
    ["a meeting type of four", { meetingType: "zoom" }],
    ["a place id that is not a uuid", { placeId: "nope" }],
    ["notify that is not a boolean", { notify: "yes" }],
    ["no customer", { customer: undefined }],
    ["an existing customer id that is not a uuid", { customer: { kind: "existing", id: "c1" } }],
    ["a new customer with no name", { customer: { kind: "new", name: "   ", phone: "956 555 0123", addAsNew: false } }],
  ];
  it.each(bad)("%s → calendar.job.saveFailed and no write", async (_n, over) => {
    const r = await addJobAction(ACCT, { ...draft(), ...over } as JobDraft, []);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual([]);
  });

  it("the edges save: 5 and 720 minutes, a 200-character what with spaces around it (trimmed), a :55 start", async () => {
    for (const over of [{ minutes: 5 }, { minutes: 720 }, { what: `  ${"y".repeat(200)}  ` }, { start: "10:55" }]) {
      expect((await addJobAction(ACCT, draft(over), ["notice", "outside_hours"])).ok).toBe(true);
    }
    expect(db.createStaffJob.mock.calls[2]![2].note).toBe("y".repeat(200));
  });

  it("an empty what saves as no note", async () => {
    await addJobAction(ACCT, draft({ what: "   " }), []);
    expect(db.createStaffJob.mock.calls[0]![2].note).toBeNull();
  });
});

describe("addJobAction: the time", () => {
  it("a wall time in the spring-forward gap → calendar.job.noSuchTime, nothing written", async () => {
    const r = await addJobAction(ACCT, draft({ date: "2027-03-14", start: "02:30" }), []);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.noSuchTime" });
    expect(writes()).toEqual([]);
  });

  it("a start already past → calendar.job.past, never a warning to accept (mutation: drop the past refusal → FAILS)", async () => {
    const r = await addJobAction(ACCT, draft({ date: "2026-11-02", start: "08:55" }), ["outside_hours", "notice"]);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.past" });
    expect(writes()).toEqual([]);
  });

  it("a start more than 366 days out → calendar.job.saveFailed; 366 days saves", async () => {
    expect(await addJobAction(ACCT, draft({ date: "2027-11-04" }), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect((await addJobAction(ACCT, draft({ date: "2027-11-02" }), [])).ok).toBe(true);
  });

  it("the range is the account's wall time: 10:00 for 90 minutes in Chicago is 16:00-17:30 UTC", async () => {
    await addJobAction(ACCT, draft({ minutes: 90 }), []);
    expect(db.createStaffJob.mock.calls[0]![2]).toMatchObject({
      startsAt: at("2026-11-03T16:00:00.000Z"), endsAt: at("2026-11-03T17:30:00.000Z"), calendarId: "cal_1", contactId: C1,
    });
  });

  it("a calendar or a zone that cannot be read → saveFailed, nothing written", async () => {
    db.getCalendarForAccount.mockResolvedValueOnce(null);
    expect(await addJobAction(ACCT, draft(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    db.readAccountTimezone.mockResolvedValueOnce(null);
    expect(await addJobAction(ACCT, draft(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual([]);
  });
});

describe("addJobAction: an existing customer is proven on the request client", () => {
  it("reads the customer with getContact on the caller's own client", async () => {
    await addJobAction(ACCT, draft(), []);
    expect(db.getContact).toHaveBeenCalledWith(h.REQ, ACCT, C1);
  });

  it.each([
    ["missing (another account's, or one RLS hides)", null],
    ["archived (mutation: skip the archived check → FAILS)", { ...ANA, archived_at: "2026-10-01T00:00:00Z" }],
    ["merged into another record", { ...ANA, merged_into: C2 }],
    ["a shared number's holding record", { ...ANA, holds_shared_number: true }],
  ])("refused when %s, and nothing is written", async (_n, row) => {
    db.getContact.mockImplementation(rec("getContact", async () => row));
    expect(await addJobAction(ACCT, draft(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual([]);
  });
});

describe("addJobAction: a new customer (R8, carry-in 4: never silently folded into someone else)", () => {
  const quick = (over: Partial<{ name: string; phone: string; addAsNew: boolean }> = {}): JobDraft =>
    draft({ customer: { kind: "new", name: "Beto Ruiz Soto", phone: "(956) 555-0123", addAsNew: false, ...over } });

  it("a phone already on a contact answers who has it and writes NOTHING (mutation: write first → FAILS)", async () => {
    db.listContactsOnNumber.mockImplementation(rec("listContactsOnNumber", async () => ({
      rows: [{ id: C1, first_name: "Ana", last_name: "García", phone: "+19565550123", email_key: null, holds_shared_number: false }], truncated: false,
    })));
    const r = await addJobAction(ACCT, quick(), []);
    expect(r).toEqual({ ok: false, needs: { phoneOwner: { id: C1, name: "Ana García", first: "Ana" } } });
    expect(db.listContactsOnNumber).toHaveBeenCalledWith(h.REQ, ACCT, "+19565550123", { live: true });
    expect(writes()).toEqual([]);
  });

  // F-046 follow-up: "Use Ana?" offered an ARCHIVED owner, and picking her dead-ended (an existing customer who is
  // archived is refused below). The offer reads live owners only, so an archived owner's number makes a new person.
  it("the phone-owner offer asks for LIVE owners only, so an archived owner is never offered (mutation: drop { live: true } → FAILS)", async () => {
    await addJobAction(ACCT, quick(), []);
    expect(db.listContactsOnNumber).toHaveBeenCalledWith(h.REQ, ACCT, "+19565550123", { live: true });
  });

  // listContactsOnNumber reads by phone_key, a SUPERSET on purpose (phoneKeysOf: a Mexican number keys its ten
  // national digits too), so the exact number is decided here with isCallerIdNumber (spec S1). A US number with the
  // same ten digits is somebody else, never the owner of the typed +52 number.
  it("a row the phone_key superset brings back on a DIFFERENT number is nobody: no phoneOwner prompt (mutation: drop isCallerIdNumber → FAILS)", async () => {
    db.listContactsOnNumber.mockImplementation(rec("listContactsOnNumber", async () => ({
      rows: [{ id: C1, first_name: "Ana", last_name: "García", phone: "(956) 292-1696", email_key: null, holds_shared_number: false }], truncated: false,
    })));
    const r = await addJobAction(ACCT, quick({ phone: "+52 956 292 1696" }), []);
    expect(db.listContactsOnNumber).toHaveBeenCalledWith(h.REQ, ACCT, "+529562921696", { live: true });
    expect(r.ok).toBe(true);
    expect(db.createContact).toHaveBeenCalled();
  });

  it("a shared number's holding record is nobody: it is left out, and the customer is made", async () => {
    db.listContactsOnNumber.mockImplementation(rec("listContactsOnNumber", async () => ({
      rows: [{ id: C1, first_name: null, last_name: null, phone: "+19565550123", email_key: null, holds_shared_number: true }], truncated: false,
    })));
    expect((await addJobAction(ACCT, quick(), [])).ok).toBe(true);
    expect(db.createContact).toHaveBeenCalled();
  });

  it("Add as new makes a second person, email-only dedupe, with the phone AS TYPED (mutation: pass the E.164 → FAILS), the name split on its first space", async () => {
    db.listContactsOnNumber.mockImplementation(rec("listContactsOnNumber", async () => ({
      rows: [{ id: C1, first_name: "Ana", last_name: "García", phone: "+19565550123", email_key: null, holds_shared_number: false }], truncated: false,
    })));
    const r = await addJobAction(ACCT, quick({ addAsNew: true }), []);
    expect(r).toMatchObject({ ok: true, bookingId: NEW, first: "Beto" });
    expect(db.createContact).toHaveBeenCalledWith(h.REQ, ACCT, {
      firstName: "Beto", lastName: "Ruiz Soto", phone: "(956) 555-0123", matchBy: "email_only", assignedTo: "person_1",
    }, "user_1", "user");
    expect(db.createStaffJob.mock.calls[0]![2].contactId).toBe(C2);
  });

  it("a number nobody has: the customer is made the same way (email-only, so createContact's phone dedupe can never fold the job onto a match the read did not show)", async () => {
    await addJobAction(ACCT, quick({ name: "Cher" }), []);
    expect(db.createContact.mock.calls[0]![2]).toEqual({ firstName: "Cher", phone: "(956) 555-0123", matchBy: "email_only", assignedTo: "person_1" });
  });

  it("a quick-add customer with a saved place id is refused: a new customer has no places yet", async () => {
    expect(await addJobAction(ACCT, draft({ customer: { kind: "new", name: "Beto", phone: "", addAsNew: false }, placeId: P1 }), []))
      .toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual([]);
  });

  it("a contact that cannot be made → saveFailed, and no job", async () => {
    db.createContact.mockImplementation(rec("createContact", async () => { throw new Error("db down"); }));
    expect(await addJobAction(ACCT, quick(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(db.createStaffJob).not.toHaveBeenCalled();
  });
});

describe("addJobAction: the address", () => {
  it("a saved place must be one listContactPlaces returns for THIS customer, on the request client (mutation: skip → another customer's place saves, FAILS)", async () => {
    expect(await addJobAction(ACCT, draft({ placeId: P2 }), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(db.listContactPlaces).toHaveBeenCalledWith(h.REQ, ACCT, C1);
    expect(writes()).toEqual([]);
  });

  it("an archived place is refused", async () => {
    db.listContactPlaces.mockImplementation(rec("listContactPlaces", async () => ({
      groups: [], places: [{ id: P1, archived_at: "2026-10-01T00:00:00Z" }], placeCount: 1, equipment: [], equipmentCount: 0,
    })));
    expect(await addJobAction(ACCT, draft({ placeId: P1 }), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
  });

  it("an active place of the customer's (a household's included) is the job's", async () => {
    await addJobAction(ACCT, draft({ placeId: P1.toUpperCase() }), []);
    expect(db.createStaffJob.mock.calls[0]![2].placeId).toBe(P1);
  });

  it("an invalid new address is refused BEFORE any write, not even the quick-add contact", async () => {
    const r = await addJobAction(ACCT, {
      ...draft({ customer: { kind: "new", name: "Beto", phone: "956 555 0123", addAsNew: true } }),
      newPlace: { label: "Home", address: "", landmark: "", directions: "" },
    }, []);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual([]);
  });

  it("new customer + new address: the contact, then the place on it, then the job naming it (mutation: place first → FAILS)", async () => {
    const r = await addJobAction(ACCT, {
      ...draft({ customer: { kind: "new", name: "Beto", phone: "956 555 0123", addAsNew: true }, placeId: P2 }),
      newPlace: PLACE_FIELDS,
    }, []);
    expect(r.ok).toBe(true);
    expect(writes()).toEqual(["createContact", "addPlace", "createStaffJob"]);
    expect(db.addPlace).toHaveBeenCalledWith(h.REQ, ACCT, { contactId: C2, groupId: null },
      expect.objectContaining({ label: "Home", address: "12 Elm St", country: "US" }), { subjectId: C2, actorId: "user_1" });
    // placeId is ignored when a new address was typed.
    expect(db.createStaffJob.mock.calls[0]![2].placeId).toBe(P1);
  });

  it("a place write that fails keeps the quick-add contact (spec 6.1) and answers saveFailed: no job", async () => {
    db.addPlace.mockImplementation(rec("addPlace", async () => { throw new Error("rls"); }));
    const r = await addJobAction(ACCT, {
      ...draft({ customer: { kind: "new", name: "Beto", phone: "956 555 0123", addAsNew: true } }), newPlace: PLACE_FIELDS,
    }, []);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual(["createContact", "addPlace"]);
  });

  it("a new address on an existing customer is saved on that customer", async () => {
    await addJobAction(ACCT, { ...draft(), newPlace: PLACE_FIELDS }, []);
    expect(db.addPlace.mock.calls[0]![2]).toEqual({ contactId: C1, groupId: null });
  });
});

describe("addJobAction: warnings, each shown once (R1, R3)", () => {
  const overlapping = (ids: string[]) => rec("listBookedRanges", async () => ids.map((id, i) => ({
    id, starts_at: `2026-11-03T16:${String(30 + i).padStart(2, "0")}:00.000Z`, ends_at: "2026-11-03T18:00:00.000Z",
  })));

  it("an overlap not yet seen writes nothing and answers it, keyed by the ids it overlaps", async () => {
    db.listBookedRanges.mockImplementation(overlapping([O1]));
    const r = await addJobAction(ACCT, draft(), []);
    expect(r).toEqual({ ok: false, needs: { warnings: [{ key: `overlaps:${O1}`, kind: "overlaps", count: 1, at: "2026-11-03T16:30:00.000Z" }] } });
    expect(writes()).toEqual([]);
    expect(db.listBookedRanges).toHaveBeenCalledWith(h.REQ, "cal_1", "2026-11-03T16:00:00.000Z", "2026-11-03T17:00:00.000Z");
  });

  it("the second press sending exactly those keys writes", async () => {
    db.listBookedRanges.mockImplementation(overlapping([O1]));
    expect((await addJobAction(ACCT, draft(), [`overlaps:${O1}`])).ok).toBe(true);
  });

  it("a NEW overlap appearing between the presses writes nothing again (mutation: compare kinds, not keys → FAILS)", async () => {
    db.listBookedRanges.mockImplementation(overlapping([O1, O2, O3]));
    const r = await addJobAction(ACCT, draft(), [`overlaps:${O1},${O2}`]);
    expect(r).toMatchObject({ ok: false, needs: { warnings: [{ kind: "overlaps", count: 3 }] } });
    expect(writes()).toEqual([]);
  });

  it("outside hours, inside the notice and a closed day are each a warning, read off the same closures the slot engine reads", async () => {
    avail.readSlotClosures.mockImplementation(rec("readSlotClosures", async () => ({ ...NO_CLOSURES, closedDayKeys: new Set(["2026-11-02"]) })));
    db.getCalendarForAccount.mockImplementation(rec("getCalendarForAccount", async () => ({ ...CALENDAR, min_notice_hours: 12 })));
    // Mon 18:00 Chicago: after the 17:00 close, 9 hours from now (inside a 12-hour notice), on a closed day.
    const r = await addJobAction(ACCT, draft({ date: "2026-11-02", start: "18:00" }), []);
    expect(r).toEqual({ ok: false, needs: { warnings: [
      { key: "outside_hours", kind: "outside_hours" }, { key: "notice", kind: "notice" }, { key: "closed", kind: "closed" },
    ] } });
    expect(avail.readSlotClosures).toHaveBeenCalledWith(h.REQ, ACCT, "America/Chicago", NOW);
  });

  it("\"Add it anyway\" at 18:00: the second press with the outside-hours key seen saves the job and answers ok (the e2e's step 5; mutation: ignore `seen` → FAILS)", async () => {
    // Mon 18:00 Chicago is 00:00Z the next UTC day (CST, UTC-6): after the 17:00 close, nothing else broken.
    const first = await addJobAction(ACCT, draft({ date: "2026-11-02", start: "18:00" }), []);
    expect(first).toEqual({ ok: false, needs: { warnings: [{ key: "outside_hours", kind: "outside_hours" }] } });
    expect(writes()).toEqual([]);
    const r = await addJobAction(ACCT, draft({ date: "2026-11-02", start: "18:00" }), ["outside_hours"]);
    expect(r).toMatchObject({ ok: true, bookingId: NEW, startsAt: "2026-11-03T00:00:00.000Z" });
    expect(db.createStaffJob).toHaveBeenCalledTimes(1);
    expect(db.createStaffJob.mock.calls[0]![2]).toMatchObject({ startsAt: at("2026-11-03T00:00:00.000Z"), closureKept: false });
    expect(h.afters).toHaveLength(1);
  });
});

describe("addJobAction: video (R7)", () => {
  it("no provider: a no_video warning, and once seen the job saves with no link", async () => {
    expect(await addJobAction(ACCT, draft({ meetingType: "video" }), [])).toEqual({ ok: false, needs: { warnings: [{ key: "no_video", kind: "no_video" }] } });
    expect((await addJobAction(ACCT, draft({ meetingType: "video" }), ["no_video"])).ok).toBe(true);
    expect(db.createStaffJob.mock.calls[0]![2]).toMatchObject({ meetingType: "video", meetingUrl: null });
  });

  it("a provider mints a room for the calendar's public id and the job's end, BEFORE the write", async () => {
    provider.get.mockReturnValue({ createMeetingRoom: provider.createMeetingRoom });
    await addJobAction(ACCT, draft({ meetingType: "video" }), []);
    expect(provider.createMeetingRoom).toHaveBeenCalledWith({ bookingId: "pub123", endsAt: at("2026-11-03T17:00:00.000Z") });
    expect(writes()).toEqual(["createMeetingRoom", "createStaffJob"]);
    expect(db.createStaffJob.mock.calls[0]![2].meetingUrl).toBe("https://rio.daily.co/room1");
  });

  it("a provider that throws costs no job", async () => {
    provider.get.mockReturnValue({ createMeetingRoom: provider.createMeetingRoom });
    provider.createMeetingRoom.mockImplementation(rec("createMeetingRoom", async () => { throw new Error("daily down"); }));
    expect((await addJobAction(ACCT, draft({ meetingType: "video" }), [])).ok).toBe(true);
    expect(db.createStaffJob.mock.calls[0]![2].meetingUrl).toBeNull();
  });

  it("no room for in person or phone", async () => {
    provider.get.mockReturnValue({ createMeetingRoom: provider.createMeetingRoom });
    await addJobAction(ACCT, draft({ meetingType: "phone" }), []);
    expect(provider.createMeetingRoom).not.toHaveBeenCalled();
  });
});

describe("addJobAction: the write, the hold and the settle (R9, D8)", () => {
  it("writes on the service client, held for the Undo window and its grace, a confirmation wanted when ticked and available", async () => {
    const r = await addJobAction(ACCT, draft(), []);
    expect(db.createStaffJob).toHaveBeenCalledWith(h.SVC, ACCT, {
      calendarId: "cal_1", contactId: C1, startsAt: at("2026-11-03T16:00:00.000Z"), endsAt: at("2026-11-03T17:00:00.000Z"),
      note: "Fix the water heater", placeId: null, meetingType: "in_person", meetingUrl: null,
      holdUntil: new Date(NOW.getTime() + UNDO_WINDOW_MS + NOTICE_GRACE_MS), noticeWanted: "confirmation", closureKept: false,
    }, "user_1");
    expect(UNDO_WINDOW_MS + NOTICE_GRACE_MS).toBe(15_000);
    expect(hold.jobNoticeAvailability).toHaveBeenCalledWith(h.REQ, h.SVC, ACCT, C1);
    expect(r).toEqual({ ok: true, bookingId: NEW, startsAt: "2026-11-03T16:00:00.000Z", first: "Ana", notice: "scheduled" });
  });

  it.each([
    ["unticked", false, "available", null, "none"],
    ["no email on file", true, "no_email", null, "no_email"],
    ["an address that bounced", true, "address_blocked", null, "address_blocked"],
    ["an account that does not send", true, "suppressed_account", null, "none"],
  ] as const)("%s: no confirmation wanted, and the answer says why", async (_n, notify, availability, wanted, notice) => {
    hold.jobNoticeAvailability.mockResolvedValue(availability);
    const r = await addJobAction(ACCT, draft({ notify }), []);
    expect(db.createStaffJob.mock.calls[0]![2].noticeWanted).toBe(wanted);
    expect(r).toMatchObject({ ok: true, notice });
  });

  it("an availability read that fails promises nothing: no confirmation wanted, notice none, the job still saves", async () => {
    hold.jobNoticeAvailability.mockRejectedValue(new Error("db down"));
    const r = await addJobAction(ACCT, draft(), []);
    expect(db.createStaffJob.mock.calls[0]![2].noticeWanted).toBeNull();
    expect(r).toMatchObject({ ok: true, notice: "none" });
  });

  it("closureKept only when \"You're closed that day\" was among the accepted warnings (mutation: always true → FAILS)", async () => {
    await addJobAction(ACCT, draft(), []);
    expect(db.createStaffJob.mock.calls[0]![2].closureKept).toBe(false);
    avail.readSlotClosures.mockImplementation(rec("readSlotClosures", async () => ({ ...NO_CLOSURES, closedDayKeys: new Set(["2026-11-03"]) })));
    expect((await addJobAction(ACCT, draft(), ["closed"])).ok).toBe(true);
    expect(db.createStaffJob.mock.calls[1]![2].closureKept).toBe(true);
  });

  it("schedules the settle with after(), for this booking and this request's origin (mutation: no after() → FAILS)", async () => {
    await addJobAction(ACCT, draft(), []);
    expect(h.afters).toHaveLength(1);
    await h.afters[0]!();
    expect(hold.settleAfterWindow).toHaveBeenCalledWith(ACCT, NEW, "https://app.test");
  });

  it("a write that fails answers saveFailed and schedules nothing", async () => {
    db.createStaffJob.mockImplementation(rec("createStaffJob", async () => { throw new Error("db down"); }));
    expect(await addJobAction(ACCT, draft(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(h.afters).toHaveLength(0);
  });
});

describe("undoAddJobAction (D5, plan review item 3)", () => {
  it("proves the booking first: refused, nothing is deleted (mutation: skip proveBooking → FAILS)", async () => {
    visible.callerCanSee.mockResolvedValue(false);
    expect(await undoAddJobAction(ACCT, J1)).toEqual({ ok: false, errorKey: "calendar.bookings.statusUpdateFailed" });
    expect(db.deleteUnsettledStaffJob).not.toHaveBeenCalled();
    expect(visible.callerCanSee).toHaveBeenCalledWith("bookings", ACCT, J1);
  });

  it("deleted → ok, deleted as the caller on the service client, and booking.add_undone is recorded", async () => {
    expect(await undoAddJobAction(ACCT, J1)).toEqual({ ok: true });
    expect(db.deleteUnsettledStaffJob).toHaveBeenCalledWith(h.SVC, ACCT, J1, "user_1");
    expect(db.emit).toHaveBeenCalledWith(expect.anything(), ACCT, "booking.add_undone", "user_1", { bookingId: J1 }, "user");
  });

  it.each([
    ["settled", { ok: false, errorKey: "calendar.job.undoTooLate", fallback: true }],
    ["is_move (mutation: map it to ok → FAILS)", { ok: false, errorKey: "calendar.bookings.statusUpdateFailed", fallback: true }],
    ["moved", { ok: false, errorKey: "calendar.job.undoMovedSince" }],
    // T10 review minor: a colleague's held add cannot be deleted by this person, but the drawer's ordinary Cancel can
    // still take it off the agenda (mutation: drop its fallback → FAILS).
    ["not_yours", { ok: false, errorKey: "calendar.bookings.statusUpdateFailed", fallback: true }],
    ["gone", { ok: false, errorKey: "calendar.bookings.statusUpdateFailed" }],
  ])("%s", async (outcome, expected) => {
    db.deleteUnsettledStaffJob.mockImplementation(rec("deleteUnsettledStaffJob", async () => outcome.split(" ")[0]));
    expect(await undoAddJobAction(ACCT, J1)).toEqual(expected);
    expect(db.emit).not.toHaveBeenCalled();
  });

  it("a delete that throws → statusUpdateFailed", async () => {
    db.deleteUnsettledStaffJob.mockImplementation(rec("deleteUnsettledStaffJob", async () => { throw new Error("db"); }));
    expect(await undoAddJobAction(ACCT, J1)).toEqual({ ok: false, errorKey: "calendar.bookings.statusUpdateFailed" });
  });

  it("an id that is not a uuid is refused before anything", async () => {
    expect(await undoAddJobAction(ACCT, "bk_1")).toEqual({ ok: false, errorKey: "calendar.bookings.statusUpdateFailed" });
    expect(h.calls).toEqual(["access"]);
  });
});

describe("moveJobAction: same time and length is an in-place edit (D6)", () => {
  it("proves the booking first (mutation: skip proveBooking → FAILS)", async () => {
    visible.callerCanSee.mockResolvedValue(false);
    expect(await moveJobAction(ACCT, J1, moveDraft(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(writes()).toEqual([]);
  });

  it("writes editJobDetails(from = opened, to = the draft), no new row, no email, no after()", async () => {
    const r = await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", what: "Fix it and the sink", placeId: P1 }), []);
    expect(db.editJobDetails).toHaveBeenCalledWith(h.SVC, ACCT, J1,
      { note: "Fix the water heater", placeId: null, meetingType: "in_person", meetingUrl: null },
      { note: "Fix it and the sink", placeId: P1, meetingType: "in_person", meetingUrl: null });
    expect(db.moveBooking).not.toHaveBeenCalled();
    expect(h.afters).toEqual([]);
    expect(r).toEqual({ ok: true, mode: "edited", from: OPENED,
      to: { ...OPENED, note: "Fix it and the sink", placeId: P1, meetingType: "in_person", meetingUrl: null } });
  });

  it("an edit that lost its compare-and-set → calendar.job.changed", async () => {
    db.editJobDetails.mockImplementation(rec("editJobDetails", async () => false));
    expect(await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", what: "x" }), [])).toEqual({ ok: false, errorKey: "calendar.job.changed" });
  });

  it("becoming video mints a room for the job's own end; leaving video drops the link", async () => {
    provider.get.mockReturnValue({ createMeetingRoom: provider.createMeetingRoom });
    await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", meetingType: "video" }), []);
    expect(provider.createMeetingRoom).toHaveBeenCalledWith({ bookingId: "pub123", endsAt: at("2026-11-03T17:00:00.000Z") });
    expect(db.editJobDetails.mock.calls[0]![4]).toMatchObject({ meetingType: "video", meetingUrl: "https://rio.daily.co/room1" });
    const wasVideo = opened({ meetingType: "video", meetingUrl: "https://rio.daily.co/old" });
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ meeting_type: "video", meeting_url: "https://rio.daily.co/old" })));
    await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", meetingType: "phone", opened: wasVideo }), []);
    expect(db.editJobDetails.mock.calls[1]![4]).toMatchObject({ meetingType: "phone", meetingUrl: null });
  });

  it("an address the job already names is kept even once archived; a different one must be the customer's and active", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ place_id: P2 })));
    const kept = opened({ placeId: P2 });
    expect((await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", placeId: P2, what: "y", opened: kept }), [])).ok).toBe(true);
    expect(db.listContactPlaces).not.toHaveBeenCalled();
    expect(await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", placeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", opened: kept }), []))
      .toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
  });

  it("the fall-back night: a note edit on the SECOND 01:30 (07:30Z, Chicago) stays an in-place edit, never a move an hour earlier (T11/T12 review; mutation: plain wallToInstant -> FAILS)", async () => {
    vi.setSystemTime(new Date("2026-10-30T15:00:00.000Z"));
    const night = { startsAt: "2026-11-01T07:30:00.000Z", endsAt: "2026-11-01T08:30:00.000Z" };
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ starts_at: night.startsAt, ends_at: night.endsAt })));
    const r = await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-01", start: "01:30", minutes: 60, what: "Bring the ladder", opened: opened(night) }), []);
    expect(r).toMatchObject({ ok: true, mode: "edited", to: { startsAt: night.startsAt, endsAt: night.endsAt, note: "Bring the ladder" } });
    expect(db.moveBooking).not.toHaveBeenCalled();
    expect(db.editJobDetails).toHaveBeenCalledTimes(1);
  });

  it("a job that is no longer booked → calendar.job.changed, nothing written", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ status: "cancelled" })));
    expect(await moveJobAction(ACCT, J1, moveDraft(), [])).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(writes()).toEqual([]);
  });
});

describe("moveJobAction: a new time (D6, plan review item 2, carry-in 1)", () => {
  it("validates as the add does (mutation: raise the bound past 720 → FAILS)", async () => {
    expect(await moveJobAction(ACCT, J1, moveDraft({ minutes: 725 }), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-02", start: "08:00" }), [])).toEqual({ ok: false, errorKey: "calendar.job.past" });
    expect(await moveJobAction(ACCT, J1, moveDraft({ date: "2027-03-14", start: "02:00" }), [])).toEqual({ ok: false, errorKey: "calendar.job.noSuchTime" });
    expect(writes()).toEqual([]);
  });

  it("the job's own range is never an overlap (excludeId), another job's is", async () => {
    db.listBookedRanges.mockImplementation(rec("listBookedRanges", async () => [
      { id: J1, starts_at: "2026-11-03T16:00:00.000Z", ends_at: "2026-11-03T17:00:00.000Z" },
    ]));
    expect((await moveJobAction(ACCT, J1, moveDraft({ date: "2026-11-03", start: "10:30" }), [])).ok).toBe(true);
    db.listBookedRanges.mockImplementation(rec("listBookedRanges", async () => [
      { id: O1, starts_at: "2026-11-04T16:30:00.000Z", ends_at: "2026-11-04T17:30:00.000Z" },
    ]));
    expect(await moveJobAction(ACCT, J1, moveDraft(), [])).toMatchObject({ ok: false, needs: { warnings: [{ key: `overlaps:${O1}` }] } });
  });

  it("moves on the service client with the job's details, held, then re-reads the OLD row, then decides the email", async () => {
    const r = await moveJobAction(ACCT, J1, moveDraft({ placeId: P1 }), []);
    expect(db.moveBooking).toHaveBeenCalledWith(h.SVC, ACCT, J1, {
      startsAt: at("2026-11-04T16:00:00.000Z"), endsAt: at("2026-11-04T17:00:00.000Z"), meetingUrl: undefined,
      job: { note: "Fix the water heater", placeId: P1, meetingType: "in_person",
        holdUntil: new Date(NOW.getTime() + UNDO_WINDOW_MS + NOTICE_GRACE_MS), closureKept: false },
    }, "user_1", "user");
    const order = h.calls.filter((c) => ["moveBooking", "readAgendaJob", "setJobNotice"].includes(c));
    expect(order).toEqual(["readAgendaJob", "moveBooking", "readAgendaJob", "setJobNotice"]);
    expect(db.readAgendaJob.mock.calls[1]).toEqual([h.SVC, ACCT, J1]);
    expect(db.setJobNotice).toHaveBeenCalledWith(h.SVC, ACCT, NEW, "moved");
    expect(r).toEqual({ ok: true, mode: "moved", newId: NEW, oldId: J1, cancelledAt: "2026-11-02T15:00:00.000123Z",
      startsAt: "2026-11-04T16:00:00.000Z", first: "Ana", notice: "scheduled" });
  });

  it("carry-in 1: a video job's new row gets a NEW room for its new end, passed as the move's meetingUrl (mutation: drop it → FAILS)", async () => {
    provider.get.mockReturnValue({ createMeetingRoom: provider.createMeetingRoom });
    await moveJobAction(ACCT, J1, moveDraft({ meetingType: "video" }), []);
    expect(provider.createMeetingRoom).toHaveBeenCalledWith({ bookingId: "pub123", endsAt: at("2026-11-04T17:00:00.000Z") });
    expect(db.moveBooking.mock.calls[0]![3].meetingUrl).toBe("https://rio.daily.co/room1");
  });

  it("a video move with no provider is the no_video warning; accepted, it moves with no link", async () => {
    expect(await moveJobAction(ACCT, J1, moveDraft({ meetingType: "video" }), [])).toEqual({ ok: false, needs: { warnings: [{ key: "no_video", kind: "no_video" }] } });
    expect((await moveJobAction(ACCT, J1, moveDraft({ meetingType: "video" }), ["no_video"])).ok).toBe(true);
    expect(db.moveBooking.mock.calls[0]![3].meetingUrl).toBeUndefined();
  });

  it("race 1: the old row's confirmation was wanted and still unclaimed at the re-read → \"confirmation\", whatever the tick says (the customer never heard of the old time)", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation" })));
    await moveJobAction(ACCT, J1, moveDraft({ notify: false }), []);
    expect(db.setJobNotice).toHaveBeenCalledWith(h.SVC, ACCT, NEW, "confirmation");
  });

  it("race 2: claimed between the drawer and the move's cancel → \"moved\" (mutation: decide before the move from the drawer's data, or always \"confirmation\" while the old row wanted one → FAILS: two confirmations)", async () => {
    let n = 0;
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => (n++ === 0
      ? job({ hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation" })
      : job({ status: "cancelled", hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation", hold_settled_at: "2026-11-02T15:00:10Z" }))));
    await moveJobAction(ACCT, J1, moveDraft({ notify: true }), []);
    expect(db.setJobNotice).toHaveBeenCalledWith(h.SVC, ACCT, NEW, "moved");
  });

  /**
   * T10 review I2: staff add at 0s; open the drawer at 5s, where the tick is off because nothing has been sent yet
   * (told: false); the hold settles at 15s and the confirmation goes; staff save a new time at 20s with the tick still
   * off. The customer was told the OLD time after the form opened, so they are told the new one: an unticked box
   * under told=false was "nobody to tell yet", never a choice to stay silent.
   */
  it("I2: told about the OLD time after the form opened (told=false then, the confirmation claimed since) → \"moved\", tick or no tick (mutation: trust the stale tick → FAILS: the customer keeps the old time)", async () => {
    let n = 0;
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => (n++ === 0
      ? job({ hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation", hold_settled_at: "2026-11-02T15:00:10Z", notice_sent_at: "2026-11-02T15:00:11Z" })
      : job({ status: "cancelled", hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation", hold_settled_at: "2026-11-02T15:00:10Z", notice_sent_at: "2026-11-02T15:00:11Z" }))));
    const r = await moveJobAction(ACCT, J1, moveDraft({ notify: false, opened: opened({ told: false }) }), []);
    expect(db.setJobNotice).toHaveBeenCalledWith(h.SVC, ACCT, NEW, "moved");
    expect(r).toMatchObject({ ok: true, mode: "moved", notice: "scheduled" });
  });

  it("I2: a claim that settled but whose send did not stamp still counts as told (the confirmation may have gone)", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () =>
      job({ hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation", hold_settled_at: "2026-11-02T15:00:10Z" })));
    await moveJobAction(ACCT, J1, moveDraft({ notify: false, opened: opened({ told: false }) }), []);
    expect(db.setJobNotice).toHaveBeenCalledWith(h.SVC, ACCT, NEW, "moved");
  });

  it("I2 controls: told=true at open and unticked is a choice, respected; told=false and a hold that settled with no email owed tells nobody", async () => {
    const settled = job({ hold_until: "2026-11-02T15:00:10Z", notice_wanted: "confirmation", hold_settled_at: "2026-11-02T15:00:10Z", notice_sent_at: "2026-11-02T15:00:11Z" });
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => settled));
    await moveJobAction(ACCT, J1, moveDraft({ notify: false, opened: opened({ told: true }) }), []);
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () =>
      job({ hold_until: "2026-11-02T15:00:10Z", notice_wanted: null, hold_settled_at: "2026-11-02T15:00:10Z" })));
    await moveJobAction(ACCT, J1, moveDraft({ notify: false, opened: opened({ told: false }) }), []);
    expect(db.setJobNotice).not.toHaveBeenCalled();
  });

  it("I2: an opened snapshot without a boolean told is refused before anything is written", async () => {
    const noTold: Partial<Opened> = opened();
    delete noTold.told;
    for (const o of [noTold, { ...noTold, told: "no" }]) {
      expect(await moveJobAction(ACCT, J1, moveDraft({ opened: o as Opened }), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    }
    expect(writes()).toEqual([]);
  });

  it("unticked and nothing owed: no email asked for, notice none", async () => {
    const r = await moveJobAction(ACCT, J1, moveDraft({ notify: false }), []);
    expect(db.setJobNotice).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, notice: "none" });
  });

  it("a customer who cannot be emailed: no email asked for, notice none", async () => {
    hold.jobNoticeAvailability.mockResolvedValue("no_email");
    const r = await moveJobAction(ACCT, J1, moveDraft(), []);
    expect(db.setJobNotice).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, notice: "none" });
  });

  it.each([
    ["answers false", async () => false],
    ["throws", async () => { throw new Error("db"); }],
  ])("a setJobNotice that %s is logged and the notice is none; the move stands", async (_n, impl) => {
    db.setJobNotice.mockImplementation(rec("setJobNotice", impl));
    const r = await moveJobAction(ACCT, J1, moveDraft(), []);
    expect(r).toMatchObject({ ok: true, mode: "moved", notice: "none" });
    expect(console.error).toHaveBeenCalled();
  });

  it("a re-read of the old row that fails asks for no email (nobody can say what the customer was told)", async () => {
    let n = 0;
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => { if (n++ === 0) return job(); throw new Error("db"); }));
    const r = await moveJobAction(ACCT, J1, moveDraft(), []);
    expect(db.setJobNotice).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, notice: "none" });
  });

  it("schedules the settle of the NEW row (mutation: settle the old id → FAILS)", async () => {
    await moveJobAction(ACCT, J1, moveDraft(), []);
    expect(h.afters).toHaveLength(1);
    await h.afters[0]!();
    expect(hold.settleAfterWindow).toHaveBeenCalledWith(ACCT, NEW, "https://app.test");
  });

  it("BookingNotMovableError → calendar.job.changed, nothing scheduled", async () => {
    db.moveBooking.mockImplementation(rec("moveBooking", async () => { throw new BookingNotMovableError(); }));
    expect(await moveJobAction(ACCT, J1, moveDraft(), [])).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(h.afters).toEqual([]);
  });

  it("any other move failure (a deadlock with an Undo included: moveBooking takes its row back) → saveFailed, nothing scheduled", async () => {
    db.moveBooking.mockImplementation(rec("moveBooking", async () => { throw new Error("moveBooking: cannot tell (deadlock detected)"); }));
    expect(await moveJobAction(ACCT, J1, moveDraft(), [])).toEqual({ ok: false, errorKey: "calendar.job.saveFailed" });
    expect(h.afters).toEqual([]);
  });

  it("closureKept only when the closed warning was accepted", async () => {
    avail.readSlotClosures.mockImplementation(rec("readSlotClosures", async () => ({ ...NO_CLOSURES, closedDayKeys: new Set(["2026-11-04"]) })));
    expect(await moveJobAction(ACCT, J1, moveDraft(), [])).toMatchObject({ ok: false, needs: { warnings: [{ key: "closed" }] } });
    await moveJobAction(ACCT, J1, moveDraft(), ["closed"]);
    expect(db.moveBooking.mock.calls[0]![3].job.closureKept).toBe(true);
  });
});

describe("undoMoveJobAction (D6, plan review item 2)", () => {
  const CANCELLED_AT = "2026-11-02T15:00:00.000123Z";

  it("proves BOTH rows (mutation: prove only the new → FAILS)", async () => {
    visible.callerCanSee.mockImplementation(async (_t: string, _a: string, id: string) => id !== J1);
    expect(await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT)).toEqual({ ok: false, errorKey: "calendar.bookings.statusUpdateFailed" });
    expect(db.undoStaffMove).not.toHaveBeenCalled();
  });

  it("undone: calls undo_staff_move with the move's own cancel stamp and now, writes no event, answers the old start", async () => {
    const r = await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT);
    expect(db.undoStaffMove).toHaveBeenCalledWith(h.SVC, ACCT, NEW, J1, CANCELLED_AT, NOW);
    expect(db.emit).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, startsAt: "2026-11-03T16:00:00.000Z" });
  });

  it("RE-ARMS the restored row's own unsettled hold, waiting out what is left of it plus the grace (mutation: no re-arm → FAILS)", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ status: "cancelled", hold_until: "2026-11-02T15:00:03.000Z" })));
    await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT);
    expect(h.afters).toHaveLength(1);
    await h.afters[0]!();
    expect(hold.settleAfterWindow).toHaveBeenCalledWith(ACCT, J1, "https://app.test", { waitMs: 3_000 + NOTICE_GRACE_MS });
  });

  it("a hold already due waits only the grace", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ status: "cancelled", hold_until: "2026-11-02T14:59:00.000Z" })));
    await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT);
    await h.afters[0]!();
    expect(hold.settleAfterWindow).toHaveBeenCalledWith(ACCT, J1, "https://app.test", { waitMs: NOTICE_GRACE_MS });
  });

  it("a restored row with no hold, or one that settled before the move, is never re-armed", async () => {
    await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT);
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => job({ hold_until: "2026-11-01T00:00:00Z", hold_settled_at: "2026-11-01T00:00:01Z" })));
    await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT);
    expect(h.afters).toEqual([]);
  });

  it.each([
    ["time_taken", "calendar.job.moveUndoTaken"],
    ["too_late", "calendar.job.undoTooLate"],
    ["gone", "calendar.job.changed"],
    ["changed", "calendar.job.changed"],
  ])("%s → %s, nothing re-armed", async (outcome, errorKey) => {
    db.undoStaffMove.mockImplementation(rec("undoStaffMove", async () => outcome));
    expect(await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT)).toEqual({ ok: false, errorKey });
    expect(h.afters).toEqual([]);
  });

  it("an undo that throws (a second deadlock included) → statusUpdateFailed", async () => {
    db.undoStaffMove.mockImplementation(rec("undoStaffMove", async () => { throw new Error("undoStaffMove failed: deadlock detected"); }));
    expect(await undoMoveJobAction(ACCT, NEW, J1, CANCELLED_AT)).toEqual({ ok: false, errorKey: "calendar.bookings.statusUpdateFailed" });
  });

  it("a cancel stamp that is not a time, or an id that is not a uuid, is refused before anything", async () => {
    expect((await undoMoveJobAction(ACCT, NEW, J1, "later")).ok).toBe(false);
    expect((await undoMoveJobAction(ACCT, "x", J1, CANCELLED_AT)).ok).toBe(false);
    expect(h.calls.filter((c) => c !== "access")).toEqual([]);
  });
});

describe("undoEditJobAction", () => {
  it("writes the opened values back, compare-and-set on what the edit wrote", async () => {
    const to = { ...OPENED, note: "Fix it and the sink" };
    expect(await undoEditJobAction(ACCT, J1, OPENED, to)).toEqual({ ok: true });
    expect(db.editJobDetails).toHaveBeenCalledWith(h.SVC, ACCT, J1,
      { note: "Fix it and the sink", placeId: null, meetingType: "in_person", meetingUrl: null },
      { note: "Fix the water heater", placeId: null, meetingType: "in_person", meetingUrl: null });
  });

  it("proves the booking first, and a lost compare-and-set is calendar.job.changed", async () => {
    visible.callerCanSee.mockResolvedValue(false);
    expect(await undoEditJobAction(ACCT, J1, OPENED, OPENED)).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(db.editJobDetails).not.toHaveBeenCalled();
    visible.callerCanSee.mockResolvedValue(true);
    db.editJobDetails.mockImplementation(rec("editJobDetails", async () => false));
    expect(await undoEditJobAction(ACCT, J1, OPENED, OPENED)).toEqual({ ok: false, errorKey: "calendar.job.changed" });
  });

  it("a malformed snapshot is refused before any write", async () => {
    expect(await undoEditJobAction(ACCT, J1, { ...OPENED, placeId: "x" }, OPENED)).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(writes()).toEqual([]);
  });

  /**
   * T10 review I1 (security): `from` is the browser's word and is WRITTEN; only `to` is compared. A scratch call
   * wrote another customer's place and `meetingUrl: "https://evil.example/join"`, which the confirmation and the
   * reminder render as the branded Join button. `from` is now held to what the server can prove.
   */
  it("I1: a place that is not this customer's (nor their household's) is refused, read on the request client, and nothing is written (mutation: drop the place check → FAILS)", async () => {
    const r = await undoEditJobAction(ACCT, J1, { ...OPENED, placeId: P2 }, OPENED);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(db.readAgendaJob).toHaveBeenCalledWith(h.REQ, ACCT, J1);
    expect(db.listContactPlaces).toHaveBeenCalledWith(h.REQ, ACCT, C1);
    expect(writes()).toEqual([]);
  });

  it("I1: a link the job does not hold now is refused: an arbitrary URL is never written (mutation: drop the link check → FAILS)", async () => {
    const r = await undoEditJobAction(ACCT, J1, { ...OPENED, meetingType: "video", meetingUrl: "https://evil.example/join" }, OPENED);
    expect(r).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(writes()).toEqual([]);
  });

  it("I1: the Undo of a place change writes back a place of the customer's, archived since included (the job named it)", async () => {
    db.listContactPlaces.mockImplementation(rec("listContactPlaces", async () => ({
      groups: [], places: [{ id: P1, archived_at: "2026-11-02T14:00:00Z" }], placeCount: 1, equipment: [], equipmentCount: 0,
    })));
    expect(await undoEditJobAction(ACCT, J1, { ...OPENED, placeId: P1 }, { ...OPENED, placeId: null })).toEqual({ ok: true });
    expect(db.editJobDetails.mock.calls[0]![4]).toMatchObject({ placeId: P1 });
  });

  it("I1: an unchanged place or link needs no proof beyond the compare-and-set, which pins it to the row (a note edit on a video job)", async () => {
    const vid = { ...OPENED, meetingType: "video" as const, meetingUrl: "https://rio.daily.co/room1", placeId: P2 };
    expect(await undoEditJobAction(ACCT, J1, vid, { ...vid, note: "x" })).toEqual({ ok: true });
    expect(db.listContactPlaces).not.toHaveBeenCalled();
    expect(db.editJobDetails.mock.calls[0]![3]).toMatchObject({ meetingUrl: "https://rio.daily.co/room1", placeId: P2 });
  });

  it("I1: a job that cannot be read (another account's, or gone) → changed, nothing written", async () => {
    db.readAgendaJob.mockImplementation(rec("readAgendaJob", async () => null));
    expect(await undoEditJobAction(ACCT, J1, { ...OPENED, placeId: P1 }, OPENED)).toEqual({ ok: false, errorKey: "calendar.job.changed" });
    expect(writes()).toEqual([]);
  });
});

describe("jobNoticeOptionAction (spec 5.4's tick)", () => {
  it("answers the availability, the contact read as the caller, the suppressions on the service client", async () => {
    hold.jobNoticeAvailability.mockResolvedValue("address_blocked");
    expect(await jobNoticeOptionAction(ACCT, C1)).toEqual({ ok: true, notice: "address_blocked" });
    expect(hold.jobNoticeAvailability).toHaveBeenCalledWith(h.REQ, h.SVC, ACCT, C1);
  });

  it("a read that fails, or an id that is not a uuid, is { ok: false }", async () => {
    hold.jobNoticeAvailability.mockRejectedValue(new Error("db"));
    expect(await jobNoticeOptionAction(ACCT, C1)).toEqual({ ok: false });
    expect(await jobNoticeOptionAction(ACCT, "c1")).toEqual({ ok: false });
  });
});
