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

  it("lastTalked is the newest email/text that did not fail or a call that is not spam; inbox copies never count (mutation: drop the channel filter -> the newer form copy wins, FAILS; drop the status filter -> the failed email wins, FAILS; drop excludeSpam -> the spam call wins, FAILS)", () =>
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
      await seedMessage(db, accountId, conv, "form", "2026-10-05T15:00:00Z", "delivered");
      await call("2026-10-06T15:00:00Z", "spam");
      const f = await contactFacts(db, accountId, ana);
      expect(f.lastTalked.ok).toBe(true);
      const v = (f.lastTalked as { ok: true; value: { at: string; channel: string } }).value;
      expect({ at: iso(v.at), channel: v.channel }).toEqual({ at: "2026-10-02T15:00:00.000Z", channel: "call" });
      await seedMessage(db, accountId, conv, "sms", "2026-10-04T15:00:00Z", "sent");
      const g = (await contactFacts(db, accountId, ana)).lastTalked as { ok: true; value: { at: string; channel: string } };
      expect({ at: iso(g.value.at), channel: g.value.channel }).toEqual({ at: "2026-10-04T15:00:00.000Z", channel: "text" });
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
});

describe("contactNextUp (S-03 part 1, spec §7, C9)", () => {
  it("bookings still ahead and open dated To-dos soonest first, plus a count of open undated ones (mutation: drop .is('completed_at', null) -> the done To-do enters, FAILS; drop the due_at not-null filter -> an undated To-do enters the wide read, FAILS; drop the undated count's completed_at filter -> the done undated To-do is counted, FAILS)", () =>
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
      const overdue = await task("Call back", "2026-10-01T05:00:00Z");
      const done = await task("Done one", "2026-10-02T05:00:00Z");
      await db.from("tasks").update({ completed_at: "2026-10-03T00:00:00Z" }).eq("id", done.id);
      const due20 = await task("Quote", "2026-10-20T05:00:00Z");
      const due25 = await task("Order parts", "2026-10-25T05:00:00Z");
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
      expect(wide.datedTasks.map((t) => t.id)).toEqual([overdue.id, due20.id, due25.id]);
    }));
});
