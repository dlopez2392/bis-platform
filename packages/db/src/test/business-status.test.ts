import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { serviceDb } from "../service";
import { userDb } from "../user-client";
import { createContact } from "../contacts";
import {
  getOrCreateCalendar, createBooking, setBookingStatus, getDueReminderById, getDueFollowupById,
} from "../booking";
import {
  upsertAutomation, getDueSmsReminderById, getDueAppointmentConfirmById, getDueReviewRequestById,
  getDueNoShowNudgeById, getDueReferralAskById, listDueReviewRequests, listDueNoShowNudges, listDueReferralAsks,
} from "../automations";
import { recordAutomationLog } from "../automation-log";
import { assignPhoneNumber, startCallRow, getCall } from "../voice";
import { listAccountWork } from "../work-queue";
import { addTask } from "../activities";
import {
  getBusinessStatusRow, ensureBusinessStatusRow, updateBusinessStatus, listClosedDaysFrom, insertClosedDay,
  deleteClosedDay, listClosureAppointments, countHeldByBooking, setBookingClosureKept, ensureClosureTask,
  deleteOpenClosureTask, loadClosureSnapshot, readHoursChain,
} from "../business-status";

/**
 * S-47d Task 3: the `@bis/db` readers and writers of the one switch (0097). Live, through PostgREST: the
 * predicates are PostgREST filters, and a mocked client cannot tell `.eq("account_id", a)` from nothing.
 * Every account-scoped read has a second-account case; every write is re-read from the table.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A UTC date `n` days from today. closed_days_stamp refuses a start before current_date - 2 (UTC). */
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

async function twoAccounts(fn: (db: SupabaseClient, a: string, b: string) => Promise<void>) {
  await withTestAccount(async (db, a) => {
    await withTestAccount(async (_db, b) => {
      await fn(db, a, b);
    });
  });
}

async function readStatus(db: SupabaseClient, accountId: string) {
  const { data, error } = await db.from("business_status").select("*").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

async function seedBooking(db: SupabaseClient, accountId: string, startsAt: Date, firstName = "Kept") {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(db, accountId,
    { firstName, lastName: "Customer", email: `${firstName.toLowerCase()}@example.com`, phone: "(956) 555-0144" }, "user_test");
  const { id } = await createBooking(db, accountId,
    { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + HOUR) }, "user_test");
  return { id, contactId, cal };
}

describe("ensureBusinessStatusRow / getBusinessStatusRow", () => {
  it("twice makes one row, open and set by system (A6); a second account reads null for its own id (mutation: drop .eq(account_id) in getBusinessStatusRow -> FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      await ensureBusinessStatusRow(db, a);
      await ensureBusinessStatusRow(db, a);
      const { data, error } = await db.from("business_status").select("account_id").eq("account_id", a);
      if (error) throw new Error(error.message);
      expect(data).toHaveLength(1);
      const row = await getBusinessStatusRow(db, a);
      expect(row).toMatchObject({ account_id: a, state: "open", late_minutes: null, until: null, set_by: "system" });
      expect(typeof row!.set_at).toBe("string");
      expect(await getBusinessStatusRow(db, b)).toBeNull();
    });
  });
});

describe("updateBusinessStatus", () => {
  it("a service client holds no UPDATE on business_status: the 42501 answers null (SD1's mapping), and the stored row is unchanged", async () => {
    await withTestAccount(async (db, a) => {
      await ensureBusinessStatusRow(db, a);
      const before = await readStatus(db, a);
      const got = await updateBusinessStatus(db, a,
        { state: "running_late", late_minutes: 30, until: new Date(Date.now() + 3 * HOUR).toISOString() });
      expect(got).toBeNull();
      expect(await readStatus(db, a)).toEqual(before);
    });
  });

  // The switch is UPDATEd only by a signed-in client (0097 grants UPDATE to authenticated alone), so these cases
  // need a signed token, which needs the replica's JWT secret: only a local run has it (CI's stack never exposes
  // its own). Without it they are SKIPPED, and a skip is not a pass; ai-acts-schema.test.ts:802-805 is the precedent.
  const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
  it.skipIf(!SECRET)("an Owner's signed client: case 1 writes, case 2 matches set_at VERBATIM (SD14), case 3 a stale set_at gets null and changes nothing, case 4 a set_at rounded through Date never matches, and another account's id gets null (mutation: ignore expectedSetAt -> case 3 FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      await ensureBusinessStatusRow(db, a);
      await ensureBusinessStatusRow(db, b);
      await asOwner(db, a, async (user, sub) => {
        // Case 1.
        const until1 = new Date(Date.now() + 3 * HOUR).toISOString();
        const one = await updateBusinessStatus(user, a, { state: "running_late", late_minutes: 30, until: until1 });
        expect(one).toMatchObject({ account_id: a, state: "running_late", late_minutes: 30, set_by: sub });
        expect(Date.parse(one!.until!)).toBe(Date.parse(until1));
        expect(typeof one!.set_at).toBe("string");
        expect(Number.isNaN(Date.parse(one!.set_at))).toBe(false);
        const stored1 = await readStatus(db, a);
        expect(stored1).toMatchObject({ state: "running_late", late_minutes: 30, set_by: sub });
        expect(stored1!.set_at).toBe(one!.set_at);

        // Case 2: case 1's set_at, exactly as PostgREST returned it.
        const two = await updateBusinessStatus(user, a, { state: "running_late", late_minutes: 60, until: until1 },
          { expectedSetAt: one!.set_at });
        expect(two).toMatchObject({ state: "running_late", late_minutes: 60 });
        expect((await readStatus(db, a))!.late_minutes).toBe(60);

        // Case 3: case 1's set_at is stale now (case 2 moved it).
        const before3 = await readStatus(db, a);
        const three = await updateBusinessStatus(user, a, { state: "open", late_minutes: null, until: null },
          { expectedSetAt: one!.set_at });
        expect(three).toBeNull();
        expect(await readStatus(db, a)).toEqual(before3);

        // Case 4: WHY the string is kept verbatim. PostgREST returns microseconds; a Date keeps milliseconds, so a
        // set_at rounded through `new Date(...).toISOString()` names an instant that was never stored, and an Undo
        // carrying it would always answer "Someone changed this since". PostgREST trims trailing zeros
        // ("…21.05263+00:00"), and a set_at with three fractional digits or fewer would survive the round trip, so
        // the case first moves set_at until it carries more than three.
        const fraction = (s: string) => /\.(\d+)/.exec(s)?.[1] ?? "";
        let current = two!;
        for (let i = 0; i < 5 && fraction(current.set_at).length <= 3; i++) {
          current = (await updateBusinessStatus(user, a, { state: "running_late", late_minutes: 60, until: until1 }))!;
        }
        expect(fraction(current.set_at).length).toBeGreaterThan(3);
        const rounded = new Date(current.set_at).toISOString();
        expect(await updateBusinessStatus(user, a, { state: "open", late_minutes: null, until: null },
          { expectedSetAt: rounded })).toBeNull();
        expect(await updateBusinessStatus(user, a, { state: "open", late_minutes: null, until: null },
          { expectedSetAt: current.set_at })).toMatchObject({ state: "open", late_minutes: null, until: null });

        // Another account's row: RLS USING matches nothing for A's Owner.
        const beforeB = await readStatus(db, b);
        expect(await updateBusinessStatus(user, b, { state: "running_late", late_minutes: 15, until: until1 })).toBeNull();
        expect(await readStatus(db, b)).toEqual(beforeB);
      });
    });
  });
});

describe("closed days", () => {
  it("listClosedDaysFrom orders by starts_on then id, filters on ends_on, honours limit, and never shows a second account's rows (mutation: drop .eq(account_id) -> FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      const late = await insertClosedDay(db, a, { starts_on: day(10), ends_on: day(12), reason: "vacation" });
      const ended = await insertClosedDay(db, a, { starts_on: day(3), ends_on: day(3), reason: "holiday" });
      const tieX = await insertClosedDay(db, a, { starts_on: day(5), ends_on: day(8), reason: null });
      const tieY = await insertClosedDay(db, a, { starts_on: day(5), ends_on: day(6), reason: "other" });
      const other = await insertClosedDay(db, b, { starts_on: day(3), ends_on: day(4), reason: null });

      const ties = [tieX.id, tieY.id].sort();
      const all = await listClosedDaysFrom(db, a, day(0));
      expect(all.map((r) => r.id)).toEqual([ended.id, ...ties, late.id]);
      expect(all.map((r) => r.id)).not.toContain(other.id);

      // ends_on, not starts_on: both ties START before day(6) and still come back; `ended` ends before it.
      const from6 = await listClosedDaysFrom(db, a, day(6));
      expect(from6.map((r) => r.id)).toEqual([...ties, late.id]);

      expect((await listClosedDaysFrom(db, a, day(0), 2)).map((r) => r.id)).toEqual([ended.id, ties[0]]);
      expect((await listClosedDaysFrom(db, b, day(0))).map((r) => r.id)).toEqual([other.id]);
    });
  });

  it("insertClosedDay returns the stored row stamped created_by system; deleteClosedDay returns the row, and another account's id with this account's id answers null and deletes nothing (mutation: drop .eq(account_id) in deleteClosedDay -> FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      const mine = await insertClosedDay(db, a, { starts_on: day(2), ends_on: day(4), reason: "holiday" });
      expect(mine).toMatchObject({ account_id: a, starts_on: day(2), ends_on: day(4), reason: "holiday", created_by: "system" });
      const theirs = await insertClosedDay(db, b, { starts_on: day(2), ends_on: day(2), reason: null });

      expect(await deleteClosedDay(db, a, theirs.id)).toBeNull();
      const { data: still } = await db.from("closed_days").select("id").eq("id", theirs.id);
      expect(still).toHaveLength(1);

      expect(await deleteClosedDay(db, a, mine.id)).toMatchObject({ id: mine.id, account_id: a });
      const { data: gone } = await db.from("closed_days").select("id").eq("id", mine.id);
      expect(gone).toHaveLength(0);
    });
  });

  it("insertClosedDay throws an Error carrying PostgREST's code (23514 for a start in the past)", async () => {
    await withTestAccount(async (db, a) => {
      const err = await insertClosedDay(db, a, { starts_on: day(-10), ends_on: day(-9), reason: null })
        .then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: string }).code).toBe("23514");
    });
  });
});

describe("listClosureAppointments", () => {
  it("booked appointments starting in [from, to), names through the embed, no cancelled one, never a second account's", async () => {
    await twoAccounts(async (db, a, b) => {
      const t0 = new Date("2027-04-10T15:00:00.000Z");
      const first = await seedBooking(db, a, t0, "Ana");
      const second = await seedBooking(db, a, new Date(t0.getTime() + 2 * HOUR), "Beto");
      const atTo = await seedBooking(db, a, new Date(t0.getTime() + 4 * HOUR), "Cruz");
      const cancelled = await seedBooking(db, a, new Date(t0.getTime() + 3 * HOUR), "Dora");
      await setBookingStatus(db, a, cancelled.id, "cancelled", "user_test");
      const theirs = await seedBooking(db, b, new Date(t0.getTime() + HOUR), "Eva");

      const from = t0.toISOString();
      const to = new Date(t0.getTime() + 4 * HOUR).toISOString();
      const got = await listClosureAppointments(db, a, from, to);
      expect(got.map((r) => r.id)).toEqual([first.id, second.id]);
      expect(got.map((r) => r.id)).not.toContain(atTo.id);
      expect(got.map((r) => r.id)).not.toContain(theirs.id);
      expect(got[0]).toMatchObject({ contact_id: first.contactId, first_name: "Ana", last_name: "Customer", closure_kept_at: null });
      expect(Date.parse(got[0]!.starts_at)).toBe(t0.getTime());
      expect(Date.parse(got[0]!.ends_at)).toBe(t0.getTime() + HOUR);
      expect((await listClosureAppointments(db, b, from, to)).map((r) => r.id)).toEqual([theirs.id]);
    });
  });
});

describe("setBookingClosureKept", () => {
  it("true stamps it, false clears it, a cancelled booking and another account's booking answer false and stay unchanged (mutation: drop .eq(account_id) -> FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      const kept = await seedBooking(db, a, new Date("2027-04-11T15:00:00.000Z"));
      const keptAt = async (id: string) => {
        const { data, error } = await db.from("bookings").select("closure_kept_at").eq("id", id).single();
        if (error) throw new Error(error.message);
        return (data as { closure_kept_at: string | null }).closure_kept_at;
      };
      expect(await setBookingClosureKept(db, a, kept.id, true)).toBe(true);
      expect(await keptAt(kept.id)).not.toBeNull();
      expect(await setBookingClosureKept(db, a, kept.id, false)).toBe(true);
      expect(await keptAt(kept.id)).toBeNull();

      const cancelled = await seedBooking(db, a, new Date("2027-04-11T18:00:00.000Z"), "Gone");
      await setBookingStatus(db, a, cancelled.id, "cancelled", "user_test");
      expect(await setBookingClosureKept(db, a, cancelled.id, true)).toBe(false);
      expect(await keptAt(cancelled.id)).toBeNull();

      const theirs = await seedBooking(db, b, new Date("2027-04-11T15:00:00.000Z"), "Theirs");
      expect(await setBookingClosureKept(db, a, theirs.id, true)).toBe(false);
      expect(await keptAt(theirs.id)).toBeNull();
    });
  });
});

describe("closure To-dos", () => {
  it("ensureClosureTask: created once per kind and date, the same id the second time, a new id for another date, the link re-read, one task.created event", async () => {
    await withTestAccount(async (db, a) => {
      const input = { kind: "status" as const, on: day(1), title: "Contact customers affected by the closure", createdBy: "user_test" };
      const first = await ensureClosureTask(db, a, input);
      expect(first.created).toBe(true);
      const again = await ensureClosureTask(db, a, input);
      expect(again).toEqual({ id: first.id, created: false });
      const other = await ensureClosureTask(db, a, { ...input, on: day(2) });
      expect(other.created).toBe(true);
      expect(other.id).not.toBe(first.id);

      const { data: row, error } = await db.from("tasks")
        .select("account_id, title, closure_kind, closure_on, completed_at, contact_id, assigned_to").eq("id", first.id).single();
      if (error) throw new Error(error.message);
      expect(row).toEqual({ account_id: a, title: input.title, closure_kind: "status", closure_on: day(1),
        completed_at: null, contact_id: null, assigned_to: null });

      const { data: events, error: evErr } = await db.from("events").select("payload")
        .eq("account_id", a).eq("type", "task.created");
      if (evErr) throw new Error(evErr.message);
      const forFirst = (events ?? []).filter((e) => (e as { payload: { taskId?: string } }).payload.taskId === first.id);
      expect(forFirst).toHaveLength(1);
    });
  });

  it("deleteOpenClosureTask: an open one goes; a completed one, a plain To-do and another account's answer false and stay (mutation: drop .eq(account_id) -> FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      const exists = async (id: string) => {
        const { data } = await db.from("tasks").select("id").eq("id", id);
        return (data ?? []).length === 1;
      };
      const open = await ensureClosureTask(db, a, { kind: "closed_day", on: day(3), title: "Open", createdBy: "user_test" });
      const done = await ensureClosureTask(db, a, { kind: "closed_day", on: day(4), title: "Done", createdBy: "user_test" });
      {
        const { error } = await db.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", done.id);
        if (error) throw new Error(error.message);
      }
      const plain = await addTask(db, a, { title: "Call the supplier" }, "user_test");
      const theirs = await ensureClosureTask(db, b, { kind: "closed_day", on: day(3), title: "Theirs", createdBy: "user_test" });

      expect(await deleteOpenClosureTask(db, a, done.id)).toBe(false);
      expect(await exists(done.id)).toBe(true);
      expect(await deleteOpenClosureTask(db, a, plain.id)).toBe(false);
      expect(await exists(plain.id)).toBe(true);
      expect(await deleteOpenClosureTask(db, a, theirs.id)).toBe(false);
      expect(await exists(theirs.id)).toBe(true);
      expect(await deleteOpenClosureTask(db, a, open.id)).toBe(true);
      expect(await exists(open.id)).toBe(false);
    });
  });

  it("listAccountWork: a closure To-do carries closureFocus { kind, on }, a plain task none (mutation: openTasks without the two columns -> FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      const closure = await ensureClosureTask(db, a, { kind: "status", on: day(1), title: "Closure", createdBy: "user_test" });
      const plain = await addTask(db, a, { title: "Plain" }, "user_test");
      const rows = await listAccountWork(db, a);
      expect(rows.find((r) => r.id === `task:${closure.id}`)?.closureFocus).toEqual({ kind: "status", on: day(1) });
      const plainRow = rows.find((r) => r.id === `task:${plain.id}`);
      expect(plainRow).toBeDefined();
      expect(plainRow).not.toHaveProperty("closureFocus");
    });
  });
});

describe("countHeldByBooking", () => {
  it("counts only this account's held rows per booking; [] answers an empty Map", async () => {
    await twoAccounts(async (db, a, b) => {
      const one = await seedBooking(db, a, new Date("2027-04-12T15:00:00.000Z"), "One");
      const two = await seedBooking(db, a, new Date("2027-04-12T17:00:00.000Z"), "Two");
      const later = new Date(Date.now() + HOUR).toISOString();
      const log = (accountId: string, source: "sms_reminder" | "appointment_confirm" | "referral_ask", bookingId: string, held: boolean) =>
        recordAutomationLog(db, { accountId, source, channel: "sms", contactId: null, subjectKey: `booking:${bookingId}`,
          status: held ? "held" : "sent", ...(held ? { heldUntil: later, reason: "held" } : {}) });
      await log(a, "sms_reminder", one.id, true);
      await log(a, "appointment_confirm", one.id, true);
      await log(a, "sms_reminder", two.id, false);
      await log(b, "sms_reminder", one.id, true);

      expect(await countHeldByBooking(db, a, [one.id, two.id])).toEqual(new Map([[one.id, 2]]));
      expect(await countHeldByBooking(db, b, [one.id, two.id])).toEqual(new Map([[one.id, 1]]));
      expect(await countHeldByBooking(db, a, [])).toEqual(new Map());
    });
  });
});

describe("loadClosureSnapshot / readHoursChain", () => {
  it("returns this account's parts only: a storm and a closed day on B are absent when A is loaded", async () => {
    await twoAccounts(async (db, a, b) => {
      await ensureBusinessStatusRow(db, b);
      // B's storm through the table owner's path the app cannot take: service_role holds no UPDATE, so the row is
      // seeded as ensureBusinessStatusRow's insert would make it, then moved by the signed-in writer when a secret
      // exists. Without one, B's open row is enough to tell A's null from B's row.
      if (SECRET_FOR_SNAPSHOT) {
        await asOwner(db, b, async (user) => {
          const r = await updateBusinessStatus(user, b, { state: "storm", late_minutes: null, until: null });
          expect(r?.state).toBe("storm");
        });
      }
      const theirDay = await insertClosedDay(db, b, { starts_on: day(1), ends_on: day(2), reason: "holiday" });
      const mine = await insertClosedDay(db, a, { starts_on: day(3), ends_on: day(3), reason: null });

      const snapA = await loadClosureSnapshot(db, a, { date: day(0) });
      expect(snapA.row).toBeNull();
      expect(snapA.closedDays.map((d) => d.id)).toEqual([mine.id]);
      expect(snapA.timezone).toBe((await db.from("accounts").select("timezone").eq("id", a).single()).data!.timezone);
      expect(snapA.hours).toEqual(await readHoursChain(db, a));
      expect(snapA).not.toHaveProperty("keptBookingIds");

      const snapB = await loadClosureSnapshot(db, b, { date: day(0) });
      expect(snapB.row?.account_id).toBe(b);
      if (SECRET_FOR_SNAPSHOT) expect(snapB.row?.state).toBe("storm");
      expect(snapB.closedDays.map((d) => d.id)).toEqual([theirDay.id]);
    });
  });

  it("readHoursChain reads voice_profiles.business_hours and calendars.open_hours for this account, null where there is no row", async () => {
    await twoAccounts(async (db, a, b) => {
      const hours = { mon: [["09:00", "17:00"]] };
      {
        const { error } = await db.from("voice_profiles").insert({ account_id: a, business_hours: hours });
        if (error) throw new Error(error.message);
      }
      await getOrCreateCalendar(db, a, "user_test");
      const chain = await readHoursChain(db, a);
      expect(chain.businessHours).toEqual(hours);
      expect(chain.calendarHours).not.toBeNull();
      expect(await readHoursChain(db, b)).toEqual({ businessHours: null, calendarHours: null });
    });
  });
});

describe("the call stamp", () => {
  it("startCallRow with businessStatus storm -> getCall reads business_status storm; without it -> null (mutation: CALL_DETAIL_COLS without business_status -> FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      const num = await assignPhoneNumber(db, a, { e164: testPhoneNumber() }, "user_test");
      const stamped = await startCallRow(db, a, { phoneNumberId: num.id, callerE164: "+19562921696", businessStatus: "storm" });
      const plain = await startCallRow(db, a, { phoneNumberId: num.id, callerE164: "+19562921696" });
      expect((await getCall(db, a, stamped.id))?.business_status).toBe("storm");
      const plainRow = await getCall(db, a, plain.id);
      expect(plainRow).not.toBeNull();
      expect(plainRow!.business_status).toBeNull();
    });
  });
});

describe("the seven booking-subject due rows carry closureKeptAt (SD20); three recipes carry startsAt (SD5)", () => {
  it("null before Keep, the stored stamp after it, through every by-id reader; the referral-ask LIST reads it for an appointment that ended three days ago", async () => {
    await withTestAccount(async (db, a) => {
      const reviewUrl = "https://g.page/r/x/review";
      await upsertAutomation(db, a, "sms_reminder", { enabled: true, body: "", config: {} }, "user_test");
      await upsertAutomation(db, a, "appointment_confirm", { enabled: true, body: "", config: {} }, "user_test");
      await upsertAutomation(db, a, "review_request", { enabled: true, body: "", config: { channel: "email", reviewUrl } }, "user_test");
      await upsertAutomation(db, a, "no_show_nudge", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      await upsertAutomation(db, a, "referral_ask", { enabled: true, body: "", config: { channel: "email" } }, "user_test");

      const t = (iso: string) => new Date(iso);
      const keptDone = await seedBooking(db, a, t("2027-05-03T15:00:00.000Z"), "Kd");
      const keptMiss = await seedBooking(db, a, t("2027-05-03T17:00:00.000Z"), "Km");
      const plainDone = await seedBooking(db, a, t("2027-05-03T19:00:00.000Z"), "Pd");
      const plainMiss = await seedBooking(db, a, t("2027-05-03T21:00:00.000Z"), "Pm");
      {
        const { error } = await db.from("calendars").update({ followup_enabled: true }).eq("id", keptDone.cal.id);
        if (error) throw new Error(error.message);
      }
      const keptAt = async (id: string) =>
        ((await db.from("bookings").select("closure_kept_at").eq("id", id).single()).data as { closure_kept_at: string | null }).closure_kept_at;

      // The four booked-subject readers, before Keep.
      expect((await getDueReminderById(db, keptDone.id)).due?.closureKeptAt).toBeNull();
      expect((await getDueFollowupById(db, keptDone.id)).due?.closureKeptAt).toBeNull();
      expect((await getDueSmsReminderById(db, keptDone.id)).due?.closureKeptAt).toBeNull();
      expect((await getDueAppointmentConfirmById(db, keptDone.id)).due?.closureKeptAt).toBeNull();

      expect(await setBookingClosureKept(db, a, keptDone.id, true)).toBe(true);
      expect(await setBookingClosureKept(db, a, keptMiss.id, true)).toBe(true);
      const stampDone = await keptAt(keptDone.id);
      const stampMiss = await keptAt(keptMiss.id);
      expect(stampDone).not.toBeNull();
      expect(stampMiss).not.toBeNull();

      expect((await getDueReminderById(db, keptDone.id)).due?.closureKeptAt).toBe(stampDone);
      expect((await getDueFollowupById(db, keptDone.id)).due?.closureKeptAt).toBe(stampDone);
      expect((await getDueSmsReminderById(db, keptDone.id)).due?.closureKeptAt).toBe(stampDone);
      expect((await getDueAppointmentConfirmById(db, keptDone.id)).due?.closureKeptAt).toBe(stampDone);

      // The three after-the-appointment recipes: Keep is set while booked, then the status moves.
      for (const b of [keptDone, plainDone]) await setBookingStatus(db, a, b.id, "completed", "user_test");
      for (const b of [keptMiss, plainMiss]) await setBookingStatus(db, a, b.id, "no_show", "user_test");
      expect((await getDueReviewRequestById(db, plainDone.id)).due?.closureKeptAt).toBeNull();
      expect((await getDueReferralAskById(db, plainDone.id)).due?.closureKeptAt).toBeNull();
      expect((await getDueNoShowNudgeById(db, plainMiss.id)).due?.closureKeptAt).toBeNull();
      expect((await getDueReviewRequestById(db, keptDone.id)).due?.closureKeptAt).toBe(stampDone);
      expect((await getDueReferralAskById(db, keptDone.id)).due?.closureKeptAt).toBe(stampDone);
      expect((await getDueNoShowNudgeById(db, keptMiss.id)).due?.closureKeptAt).toBe(stampMiss);

      // Outside any two-day window: the referral-ask list, read three days (72 h) after keptDone ENDED.
      const endedDone = t("2027-05-03T16:00:00.000Z").getTime();
      const asks = await listDueReferralAsks(db, new Date(endedDone + 72 * HOUR).toISOString());
      const ask = asks.find((r) => r.bookingId === keptDone.id);
      expect(ask?.closureKeptAt).toBe(stampDone);
      expect(Date.parse(ask!.startsAt)).toBe(t("2027-05-03T15:00:00.000Z").getTime());
    });
  });

  it("listDueReviewRequests, listDueNoShowNudges and listDueReferralAsks carry startsAt equal to the booking's starts_at", async () => {
    await withTestAccount(async (db, a) => {
      await upsertAutomation(db, a, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      await upsertAutomation(db, a, "no_show_nudge", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      await upsertAutomation(db, a, "referral_ask", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      const start = new Date("2027-06-07T15:00:00.000Z");
      const done = await seedBooking(db, a, start, "Done");
      const miss = await seedBooking(db, a, new Date(start.getTime() + 2 * HOUR), "Miss");
      await setBookingStatus(db, a, done.id, "completed", "user_test");
      await setBookingStatus(db, a, miss.id, "no_show", "user_test");
      const startOf = async (id: string) =>
        ((await db.from("bookings").select("starts_at").eq("id", id).single()).data as { starts_at: string }).starts_at;

      const nowIso = new Date(start.getTime() + 4 * HOUR).toISOString();
      const review = (await listDueReviewRequests(db, nowIso)).find((r) => r.bookingId === done.id);
      expect(review?.startsAt).toBe(await startOf(done.id));
      const nudge = (await listDueNoShowNudges(db, nowIso)).find((r) => r.bookingId === miss.id);
      expect(nudge?.startsAt).toBe(await startOf(miss.id));
      const ask = (await listDueReferralAsks(db, nowIso)).find((r) => r.bookingId === done.id);
      expect(ask?.startsAt).toBe(await startOf(done.id));
      expect(Date.parse(review!.startsAt)).toBe(start.getTime());
    });
  });
});

const SECRET_FOR_SNAPSHOT = process.env.BIS_REPLICA_JWT_SECRET;

/** A signed-in Owner of `accountId` (users row + Owner membership + client access on), torn down after. */
async function asOwner(db: SupabaseClient, accountId: string, fn: (user: SupabaseClient, sub: string) => Promise<void>) {
  const secret = process.env.BIS_REPLICA_JWT_SECRET!;
  const sub = `u_bstatus_owner_${Math.random().toString(36).slice(2, 10)}`;
  const svc = serviceDb();
  const userRow = await svc.from("users").insert({ clerk_user_id: sub, email: `${sub}@example.com` }).select("id").single();
  if (userRow.error) throw new Error(userRow.error.message);
  try {
    const { data: acct, error } = await db.from("accounts").update({ client_access_enabled: true })
      .eq("id", accountId).select("clerk_org_id").single();
    if (error) throw new Error(error.message);
    const m = await db.from("memberships")
      .insert({ user_id: (userRow.data as { id: string }).id, scope: "account", account_id: accountId, role: "owner" }).select("id").single();
    if (m.error) throw new Error(m.error.message);
    const token = signJwt({ role: "authenticated", org_id: (acct as { clerk_org_id: string }).clerk_org_id, sub,
      exp: Math.floor(Date.now() / 1000) + 600 }, secret);
    await fn(userDb(token), sub);
  } finally {
    const userId = (userRow.data as { id: string }).id;
    const { error: mErr } = await svc.from("memberships").delete().eq("user_id", userId);
    if (mErr) throw new Error(`memberships cleanup failed: ${mErr.message}`);
    const { error } = await svc.from("users").delete().eq("clerk_user_id", sub);
    if (error) throw new Error(`users cleanup failed: ${error.message}`);
  }
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const b64 = (b: Buffer) => b.toString("base64url");
  const head = b64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}
