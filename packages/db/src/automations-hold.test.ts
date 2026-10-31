import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listDueSmsReminders, listDueAppointmentConfirms, getDueSmsReminderById, getDueAppointmentConfirmById,
} from "./automations";

/**
 * F-046 part 1 (plan Task 9, Step 1): the two TEXT due-lists wait for a staff job's Undo hold to be SETTLED,
 * as the email reminder's two reads do (booking-agenda.test.ts, T4). Gated on the claim, never on the clock:
 * `hold_until` passing proves nothing was settled, and a text sent before the settle would reach the customer
 * ahead of the confirmation, or for a job undone before its claim. The by-id twins add nothing (plan
 * correction 3: a held subject is only ever made from a due-list row, which this filter already excludes).
 * A SCRIPTED fake: every `from()` takes the next answer off a queue in call order and records each builder
 * call, so a missing, extra or reordered filter shows up as the call it is. No database.
 */
type Call = [string, ...unknown[]];
type Answer = { data?: unknown; error?: { code?: string; message: string } | null };
type Entry = { table: string; calls: Call[] };

const OPS = ["select", "update", "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not", "or", "order", "limit",
  "single", "maybeSingle"];

function scripted(answers: Answer[]) {
  const queue = [...answers];
  const log: Entry[] = [];
  const db = {
    from(table: string) {
      const entry: Entry = { table, calls: [] };
      log.push(entry);
      const a = queue.shift();
      if (!a) throw new Error(`fake: no answer left for from("${table}")`);
      const result = { data: a.data ?? null, error: a.error ?? null };
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      for (const op of OPS) chain[op] = (...args: unknown[]) => { entry.calls.push([op, ...args]); return chain; };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, log, left: () => queue.length };
}

const ACCT = "acct_1";
const NOW = "2027-03-01T12:00:00.000Z";
const HOLD_FILTER = "hold_until.is.null,hold_settled_at.not.is.null";
const ENABLED = { data: [{ account_id: ACCT, body: "See you soon", body_es: null, config: {} }] };
const ACCOUNT = (suppressed: boolean) => ({
  data: {
    timezone: "America/Chicago", brand_name: "Acme", brand_logo_path: null, brand_color: null, brand_neutral: null,
    brand_corners: null, brand_type: null, brand_mode: null, reply_to_email: null, from_email: null,
    outbound_suppressed: suppressed, mailing_address: null, language: null,
  },
});
const ROW = {
  id: "bk_1", account_id: ACCT, contact_id: "ct_1", starts_at: "2027-03-01T14:00:00.000Z", booker_timezone: null,
  sms_reminder_failed_at: null, closure_kept_at: null, contacts: { account_id: ACCT, phone: "+19565550100", language: null },
};

const bookingsCalls = (log: Entry[]) => log.find((e) => e.table === "bookings")!.calls;

describe("listDueSmsReminders — a staff job's text waits for its hold to SETTLE (plan Task 9)", () => {
  it("reads booked, unsent rows with no hold or a CLAIMED one, right after the sent stamp, and nothing more (mutation: drop the .or → FAILS; mutation: gate on hold_until.lte.<now> → FAILS)", async () => {
    const { db, log, left } = scripted([ENABLED, { data: [] }]);
    expect(await listDueSmsReminders(db, NOW)).toEqual([]);
    expect(log.map((e) => e.table)).toEqual(["automations", "bookings"]);
    expect(bookingsCalls(log)).toStrictEqual([
      ["select", expect.any(String)], ["in", "account_id", [ACCT]],
      ["eq", "status", "booked"], ["is", "sms_reminder_sent_at", null], ["or", HOLD_FILTER],
      ["gte", "starts_at", "2027-03-01T13:30:00.000Z"], ["lte", "starts_at", "2027-03-01T14:15:00.000Z"],
      ["order", "starts_at", { ascending: true }],
    ]);
    expect(left()).toBe(0);
  });

  it("still routes every row through loadSendableRows: a suppressed account's row is dropped, a live one kept (outbound-suppressed.test.ts's rule)", async () => {
    const suppressed = scripted([ENABLED, { data: [ROW] }, ACCOUNT(true)]);
    expect(await listDueSmsReminders(suppressed.db, NOW)).toEqual([]);
    expect(suppressed.log.map((e) => e.table)).toEqual(["automations", "bookings", "accounts"]);
    const live = scripted([ENABLED, { data: [ROW] }, ACCOUNT(false)]);
    expect((await listDueSmsReminders(live.db, NOW)).map((r) => r.bookingId)).toEqual(["bk_1"]);
  });

  it("its by-id twin adds NO hold filter (plan correction 3: a release's by-id read never meets an unsettled hold, and `gone` would drop the held subject for good)", async () => {
    const { db, log } = scripted([{ data: null }]);
    expect(await getDueSmsReminderById(db, "bk_1")).toEqual({ due: null, why: "gone" });
    expect(bookingsCalls(log).some(([op]) => op === "or")).toBe(false);
  });
});

describe("listDueAppointmentConfirms — a staff job's confirmation ask waits for its hold to SETTLE (plan Task 9)", () => {
  it("reads booked, unasked rows with no hold or a CLAIMED one, right after the asked stamp, and nothing more (mutation: drop the .or → FAILS; mutation: gate on hold_until.lte.<now> → FAILS)", async () => {
    const { db, log, left } = scripted([ENABLED, { data: [] }]);
    expect(await listDueAppointmentConfirms(db, NOW)).toEqual([]);
    expect(log.map((e) => e.table)).toEqual(["automations", "bookings"]);
    expect(bookingsCalls(log)).toStrictEqual([
      ["select", expect.any(String)], ["in", "account_id", [ACCT]],
      ["eq", "status", "booked"], ["is", "confirm_asked_at", null], ["or", HOLD_FILTER],
      ["gte", "starts_at", expect.any(String)], ["lte", "starts_at", expect.any(String)],
      ["order", "starts_at", { ascending: true }],
    ]);
    expect(left()).toBe(0);
  });

  it("still routes every row through loadSendableRows: a suppressed account's row is dropped, a live one kept", async () => {
    const suppressed = scripted([ENABLED, { data: [ROW] }, ACCOUNT(true)]);
    expect(await listDueAppointmentConfirms(suppressed.db, NOW)).toEqual([]);
    expect(suppressed.log.map((e) => e.table)).toEqual(["automations", "bookings", "accounts"]);
    const live = scripted([ENABLED, { data: [ROW] }, ACCOUNT(false)]);
    expect((await listDueAppointmentConfirms(live.db, NOW)).map((r) => r.bookingId)).toEqual(["bk_1"]);
  });

  it("its by-id twin adds NO hold filter (plan correction 3)", async () => {
    const { db, log } = scripted([{ data: null }]);
    expect(await getDueAppointmentConfirmById(db, "bk_1")).toEqual({ due: null, why: "gone" });
    expect(bookingsCalls(log).some(([op]) => op === "or")).toBe(false);
  });
});
