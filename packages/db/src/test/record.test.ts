import { describe, it, expect, vi } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage } from "../messaging";
import { getOrCreateCalendar, createBooking, cancelBookingByToken } from "../booking";
import { assignPhoneNumber } from "../voice";
import { addTask } from "../activities";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity } from "../opportunities";
import { contactFacts, contactNextUp } from "../record";

const ACTOR = "user_test";
const iso = (v: string) => new Date(v).toISOString();

async function seedMessage(db: SupabaseClient, accountId: string, conversationId: string,
  channel: "email" | "sms" | "form", at: string, status: string) {
  const { id } = await createMessage(db, accountId,
    { conversationId, channel, direction: channel === "form" ? "inbound" : "outbound", body: "x" }, ACTOR);
  const { error } = await db.from("messages").update({ created_at: at, status }).eq("id", id);
  if (error) throw new Error(`seed message failed: ${error.message}`);
}

describe("contactFacts (S-03 part 1, spec §7)", () => {
  it("bookingsMade counts bookings made, not reschedules; a cancelled one still counts (C8/D14)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const span = (v: string) => ({ startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) });
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-02T15:00:00Z") }, ACTOR);
      await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-03T15:00:00Z"), rescheduledFromId: first.id }, ACTOR);
      const third = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-04T15:00:00Z") }, ACTOR);
      await cancelBookingByToken(db, third.cancelToken);
      expect((await contactFacts(db, accountId, ana)).bookingsMade).toEqual({ ok: true, value: 2 });
    }));

  it("lastTalked is the newest email/text that did not fail or a call that is not spam; inbox copies never count (mutation: drop the channel filter -> the newer form copy wins, FAILS; drop the status filter -> the failed email wins, FAILS; drop 'bounced' from the exclusion -> the bounced email wins, FAILS; drop excludeSpam -> the spam call wins, FAILS; label every message a text -> the newest email reads as a text, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
      const call = async (at: string, outcome: string) => {
        const { error } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id, contact_id: ana, started_at: at, outcome });
        if (error) throw new Error(`seed call failed: ${error.message}`);
      };
      await seedMessage(db, accountId, conv, "sms", "2026-10-01T15:00:00Z", "delivered");
      await call("2026-10-02T15:00:00Z", "booked");
      await seedMessage(db, accountId, conv, "email", "2026-10-03T15:00:00Z", "failed");
      await seedMessage(db, accountId, conv, "email", "2026-10-03T18:00:00Z", "bounced");
      await seedMessage(db, accountId, conv, "form", "2026-10-05T15:00:00Z", "delivered");
      await call("2026-10-06T15:00:00Z", "spam");
      const f = await contactFacts(db, accountId, ana);
      expect(f.lastTalked.ok).toBe(true);
      const v = (f.lastTalked as { ok: true; value: { at: string; channel: string } }).value;
      expect({ at: iso(v.at), channel: v.channel }).toEqual({ at: "2026-10-02T15:00:00.000Z", channel: "call" });
      await seedMessage(db, accountId, conv, "sms", "2026-10-04T15:00:00Z", "sent");
      const g = (await contactFacts(db, accountId, ana)).lastTalked as { ok: true; value: { at: string; channel: string } };
      expect({ at: iso(g.value.at), channel: g.value.channel }).toEqual({ at: "2026-10-04T15:00:00.000Z", channel: "text" });
      await seedMessage(db, accountId, conv, "email", "2026-10-07T15:00:00Z", "delivered");
      const h = (await contactFacts(db, accountId, ana)).lastTalked as { ok: true; value: { at: string; channel: string } };
      expect({ at: iso(h.value.at), channel: h.value.channel }).toEqual({ at: "2026-10-07T15:00:00.000Z", channel: "email" });
    }));

  it("lastTalked is a ready null for a customer nobody has talked to", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      expect((await contactFacts(db, accountId, ana)).lastTalked).toEqual({ ok: true, value: null });
    }));

  it("openDeals counts open deals and sums them; past the cap the amount is left out, never understated (mutation: sum the returned rows past the cap -> a partial sum of two of the three, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      for (const value of [100, 200, 300]) await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: `Deal ${value}`, value }, ACTOR);
      const won = await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "Won", value: 999 }, ACTOR);
      await db.from("opportunities").update({ status: "won" }).eq("id", won.id);
      expect((await contactFacts(db, accountId, ana)).openDeals).toEqual({ ok: true, value: { count: 3, amount: 600 } });
      expect((await contactFacts(db, accountId, ana, { openDealsCap: 2 })).openDeals).toEqual({ ok: true, value: { count: 3, amount: null } });
      expect((await contactFacts(db, accountId, ana, { openDealsCap: 3 })).openDeals).toEqual({ ok: true, value: { count: 3, amount: 600 } });
    }));

  it("openDeals sums cents exactly: 0.10 + 0.20 is 0.3, never 0.30000000000000004 (mutation: sum the floats -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      for (const value of [0.1, 0.2]) await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: `Deal ${value}`, value }, ACTOR);
      expect((await contactFacts(db, accountId, ana)).openDeals).toEqual({ ok: true, value: { count: 2, amount: 0.3 } });
    }));

  it("openDeals fails closed when the server returns no exact count: the fact is unavailable, never a count guessed from the rows (mutation: count ?? rows.length -> a count of 3 stated as fact, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      for (const value of [100, 200, 300]) await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: `Deal ${value}`, value }, ACTOR);
      // Drop the `count` option on the opportunities read, so PostgREST answers with count = null.
      const noCount = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "from") return Reflect.get(target, prop, receiver);
          return (table: string) => {
            const q = target.from(table);
            if (table !== "opportunities") return q;
            return { select: (cols: string) => q.select(cols) };
          };
        },
      }) as SupabaseClient;
      const onError = vi.fn();
      const f = await contactFacts(noCount, accountId, ana, { onError });
      expect(f.openDeals).toEqual({ ok: false });
      expect(onError).toHaveBeenCalledWith("deals", expect.anything());
    }));

  it("a failed read is reported by name and never thrown; the other facts still load (mutation: let settle rethrow -> contactFacts rejects, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const broken = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "from") return (table: string) => target.from(table === "opportunities" ? "no_such_table_s03" : table);
          return Reflect.get(target, prop, receiver);
        },
      }) as SupabaseClient;
      const onError = vi.fn();
      const f = await contactFacts(broken, accountId, ana, { onError });
      expect(f.openDeals).toEqual({ ok: false });
      expect(f.bookingsMade).toEqual({ ok: true, value: 0 });
      expect(onError).toHaveBeenCalledWith("deals", expect.anything());
    }));

  it.each(["conversations", "messages"])("a failed %s read makes lastTalked unavailable, never 'nobody talked'; the other facts still load (mutation: that read's error check returns null -> a ready null, FAILS)", (brokenTable) =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      // A conversation must exist, or the messages read is never reached.
      await ensureConversation(db, accountId, ana, ACTOR);
      const broken = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "from") return (table: string) => target.from(table === brokenTable ? "no_such_table_s03" : table);
          return Reflect.get(target, prop, receiver);
        },
      }) as SupabaseClient;
      const onError = vi.fn();
      const f = await contactFacts(broken, accountId, ana, { onError });
      expect(f.lastTalked).toEqual({ ok: false });
      expect(f.bookingsMade).toEqual({ ok: true, value: 0 });
      expect(f.openDeals).toEqual({ ok: true, value: { count: 0, amount: 0 } });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith("talked", expect.anything());
    }));
});

describe("contactNextUp (S-03 part 1, spec §7, C9)", () => {
  it("bookings still ahead and open dated To-dos soonest first, at most three, plus a count of open undated ones (mutation: drop .is('completed_at', null) -> the done To-do enters, FAILS; drop the due_at not-null filter -> an undated To-do enters the wide read, FAILS; drop the undated count's completed_at filter -> the done undated To-do is counted, FAILS; drop the due_at order -> insertion order, FAILS; drop the limit -> a fourth To-do, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const book = (v: string) => createBooking(db, accountId, { calendarId: cal.id, contactId: ana, startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) }, ACTOR);
      const soon = await book("2026-10-14T15:00:00Z");
      const later = await book("2026-10-30T15:00:00Z");
      await book("2026-10-05T15:00:00Z"); // before nowIso
      const gone = await book("2026-10-13T15:00:00Z");
      await cancelBookingByToken(db, gone.cancelToken);
      const task = (title: string, dueAt?: string) => addTask(db, accountId, { contactId: ana, title, dueAt }, ACTOR);
      // Inserted OUT of due order, and four open dated ones, so the order and the cap of three can fail.
      const due25 = await task("Order parts", "2026-10-25T05:00:00Z");
      const done = await task("Done one", "2026-10-02T05:00:00Z");
      await db.from("tasks").update({ completed_at: "2026-10-03T00:00:00Z" }).eq("id", done.id);
      const overdue = await task("Call back", "2026-10-01T05:00:00Z");
      const due28 = await task("Book the crew", "2026-10-28T05:00:00Z");
      const due20 = await task("Quote", "2026-10-20T05:00:00Z");
      await task("Someday");
      await task("Someday too");
      const doneSomeday = await task("Done someday");
      await db.from("tasks").update({ completed_at: "2026-10-03T00:00:00Z" }).eq("id", doneSomeday.id);
      const n = await contactNextUp(db, accountId, ana, "2026-10-12T15:00:00Z");
      expect(n.bookings.map((b) => b.id)).toEqual([soon.id, later.id]);
      expect(n.datedTasks.map((t) => t.id)).toEqual([overdue.id, due20.id, due25.id]);
      expect(n.undatedCount).toBe(2);
      // Past the default limit of 3: Postgres sorts NULL due dates LAST, so at limit 3 an undated
      // To-do never reaches the list even without the not-null filter. A wide read is what can fail.
      const wide = await contactNextUp(db, accountId, ana, "2026-10-12T15:00:00Z", 10);
      expect(wide.datedTasks.map((t) => t.id)).toEqual([overdue.id, due20.id, due25.id, due28.id]);
    }));

  it.each([
    ["dated", /contactNextUp To-dos failed/],
    ["undated", /contactNextUp undated count failed/],
  ] as const)("a failed %s To-do read rejects, never an empty card (mutation: drop that read's error check -> resolves, FAILS)", (which, message) =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      // Both To-do reads start at from("tasks"); the undated one is the head count. Break only one.
      const broken = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "from") return Reflect.get(target, prop, receiver);
          return (table: string) => {
            const q = target.from(table);
            if (table !== "tasks") return q;
            return {
              select: (cols: string, o?: { count?: "exact"; head?: boolean }) =>
                ((o?.head ? "undated" : "dated") === which ? target.from("no_such_table_s03") : q).select(cols, o),
            };
          };
        },
      }) as SupabaseClient;
      await expect(contactNextUp(broken, accountId, ana, "2026-10-12T15:00:00Z")).rejects.toThrow(message);
    }));
});
