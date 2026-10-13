import { describe, it, expect, vi } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage } from "../messaging";
import { getOrCreateCalendar, createBooking, cancelBookingByToken } from "../booking";
import { assignPhoneNumber } from "../voice";
import { addNote, addTask } from "../activities";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity } from "../opportunities";
import { createForm, createSubmission, linkSubmissionContact } from "../forms";
import { createGroupWithMember, addContactToGroup, setGroupPrimaryContact } from "../client-groups";
import {
  contactFacts, contactNextUp, listContactTimelinePage, listPeopleNames, TIMELINE_SOURCES,
  listTimelinePage, groupActivityMembers, groupFacts, groupNextUp,
} from "../record";

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

  // What each case pins differs: the broken dated read comes back as an ERROR, but the broken undated
  // read is a HEAD request, and postgrest-js turns its empty 404 into `{ error: null, count: null }`,
  // so that case is caught by the null-count guard, not by the error check.
  it.each([
    ["dated", "drop the To-dos read's error check -> resolves, FAILS", /contactNextUp To-dos failed/],
    ["undated", "drop the undated null-count guard -> a missing count reads as none, FAILS", /contactNextUp undated count failed/],
  ] as const)("a failed %s To-do read rejects, never an empty card (mutation: %s)", (which, _mutation, message) =>
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

describe("listContactTimelinePage (S-03 1b, spec §7, C3, C4)", () => {
  it("merges the seven sources newest first, each row its own kind (mutation: leave calls out of the merge -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const at = (d: number) => `2026-10-0${d}T15:00:00+00:00`;
      const stamp = async (table: string, id: string, d: number) => {
        const { error } = await db.from(table).update({ created_at: at(d) }).eq("id", id);
        if (error) throw new Error(`stamp ${table}: ${error.message}`);
      };
      await stamp("notes", (await addNote(db, accountId, ana, "n", ACTOR)).id, 1);
      await stamp("tasks", (await addTask(db, accountId, { contactId: ana, title: "t" }, ACTOR)).id, 2);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      await stamp("opportunities", (await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "d" }, ACTOR)).id, 3);
      const form = await createForm(db, accountId, { name: "Quote request" }, ACTOR);
      const sub = await createSubmission(db, accountId, form.id, { answers: [] });
      await linkSubmissionContact(db, accountId, sub.id, ana);
      await stamp("form_submissions", sub.id, 4);
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      await seedMessage(db, accountId, conv, "sms", at(5), "delivered");
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const b = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, startsAt: new Date("2027-03-02T15:00:00Z"), endsAt: new Date("2027-03-02T16:00:00Z") }, ACTOR);
      await stamp("bookings", b.id, 6);
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
      const { error } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id, contact_id: ana, started_at: at(7), outcome: "booked" });
      if (error) throw new Error(error.message);
      const page = await listContactTimelinePage(db, accountId, ana);
      expect(page.items.map((i) => i.kind)).toEqual(["call", "booking", "message", "submission", "deal", "task", "note"]);
      expect(page).toMatchObject({ older: null, failed: [] });
    }));

  it("the inbox's form and voice copies are not timeline rows (C4; mutation: drop the channels option -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      await seedMessage(db, accountId, conv, "form", "2026-10-05T15:00:00Z", "delivered");
      await createMessage(db, accountId, { conversationId: conv, channel: "voice", direction: "inbound", body: "x" }, "voice", "ai");
      expect((await listContactTimelinePage(db, accountId, ana)).items).toEqual([]);
    }));

  it("rows at one instant across a page boundary are neither lost nor repeated (mutation: compare `at` only in the cursor filter -> a row is lost, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const same = "2026-10-09T16:12:00.123456+00:00";
      const n = (await addNote(db, accountId, ana, "n", ACTOR)).id;
      const t = (await addTask(db, accountId, { contactId: ana, title: "t" }, ACTOR)).id;
      const noteTie = await db.from("notes").update({ created_at: same }).eq("id", n);
      if (noteTie.error) throw new Error(`note tie update failed: ${noteTie.error.message}`);
      const taskTie = await db.from("tasks").update({ created_at: same }).eq("id", t);
      if (taskTie.error) throw new Error(`task tie update failed: ${taskTie.error.message}`);
      const p1 = await listContactTimelinePage(db, accountId, ana, undefined, { limit: 1 });
      expect(p1.older).not.toBeNull();
      const p2 = await listContactTimelinePage(db, accountId, ana, p1.older!, { limit: 1 });
      expect(p2.older).toBeNull();
      // The page boundary really is a tie across two tables: without it the and(...) half is never exercised.
      expect(p2.items[0]!.at).toBe(p1.items[0]!.at);
      expect([...p1.items, ...p2.items].map((i) => i.id).sort()).toEqual([n, t].sort());
      expect(p1.items[0]!.id > p2.items[0]!.id).toBe(true);
    }));

  it("a source that fails is reported by name and the rest still load (spec §7; mutation: let one source's error reject the whole page -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      await addNote(db, accountId, ana, "still here", ACTOR);
      const failing = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "from") {
            return (table: string) => {
              if (table === "calls") throw new Error("calls down");
              return target.from(table);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const errors: string[] = [];
      const page = await listContactTimelinePage(failing, accountId, ana, undefined, { onError: (s) => errors.push(s) });
      expect(page.failed).toEqual(["calls"]);
      expect(errors).toEqual(["calls"]);
      expect(page.items.map((i) => i.kind)).toEqual(["note"]);
      expect(TIMELINE_SOURCES).toHaveLength(7);
    }));
});

describe("listPeopleNames (spec §6, Names)", () => {
  it("name, else email, for the ids asked; an id with no row is simply absent (mutation: return the email even when a name exists -> FAILS)", () =>
    withTestAccount(async (db) => {
      const run = Math.random().toString(36).slice(2, 10);
      const a = `user_names_a_${run}`;
      const b = `user_names_b_${run}`;
      const { error } = await db.from("users").insert([
        { clerk_user_id: a, email: `${a}@example.com`, name: "Dan López" },
        { clerk_user_id: b, email: `${b}@example.com`, name: null },
      ]);
      if (error) throw new Error(error.message);
      try {
        expect(await listPeopleNames(db, [a, b, `user_gone_${run}`, a])).toEqual({ [a]: "Dan López", [b]: `${b}@example.com` });
        expect(await listPeopleNames(db, [])).toEqual({});
      } finally {
        const { error: cleanupError } = await db.from("users").delete().in("clerk_user_id", [a, b]);
        if (cleanupError) throw new Error(`record.test cleanup failed on users: ${cleanupError.message}`);
      }
    }));
});

// ---- S-03 part 2b: the household and business page reads a SET of members (spec §6, C5, C6, C8, C9).

/** n contacts in one household; returns contact ids and membership ids in join order. */
async function household(db: SupabaseClient, accountId: string, n: number) {
  const run = Math.random().toString(36).slice(2, 8);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await createContact(db, accountId, { firstName: `P${i}`, lastName: "Garcia" }, ACTOR)).id);
  const g = await createGroupWithMember(db, accountId, ids[0]!, "household", `Garcia ${run}`, null, ACTOR);
  if (g.status !== "ok") throw new Error(g.status);
  const memberIds = [g.memberId];
  for (const id of ids.slice(1)) {
    const r = await addContactToGroup(db, accountId, id, g.groupId, null, ACTOR);
    if (r.status !== "ok") throw new Error(r.status);
    memberIds.push(r.memberId);
  }
  return { groupId: g.groupId, ids, memberIds };
}

/** A db whose every `.in("contact_id", ...)` on any builder is recorded (the one-id path must stay `.eq`). */
function recordingIn(db: SupabaseClient, seen: unknown[][]): SupabaseClient {
  const wrap = (o: object): unknown => new Proxy(o, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r) as unknown;
      if (typeof v !== "function") return v;
      if (p === "then") return (v as (...a: unknown[]) => unknown).bind(t);
      return (...a: unknown[]) => {
        if (p === "in" && a[0] === "contact_id") seen.push(a);
        const out = (v as (...a: unknown[]) => unknown).apply(t, a);
        if (out === t) return r;
        return out !== null && typeof out === "object" ? wrap(out) : out;
      };
    },
  });
  return wrap(db) as SupabaseClient;
}

describe("listTimelinePage across a set (S-03 part 2b, C6)", () => {
  it("merges one member's call, another's booking and a third's note in (at, id) order, each naming its own member (mutation: drop contactId from the call entry -> undefined, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { ids: [c1, c2, c3] } = await household(db, accountId, 3);
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
      const { error } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id, contact_id: c1, started_at: "2026-10-03T15:00:00+00:00", outcome: "booked" });
      if (error) throw new Error(error.message);
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const b = await createBooking(db, accountId, { calendarId: cal.id, contactId: c2!, startsAt: new Date("2027-03-02T15:00:00Z"), endsAt: new Date("2027-03-02T16:00:00Z") }, ACTOR);
      const bs = await db.from("bookings").update({ created_at: "2026-10-02T15:00:00+00:00" }).eq("id", b.id);
      if (bs.error) throw new Error(bs.error.message);
      const n = await addNote(db, accountId, c3!, "n", ACTOR);
      const ns = await db.from("notes").update({ created_at: "2026-10-01T15:00:00+00:00" }).eq("id", n.id);
      if (ns.error) throw new Error(ns.error.message);
      const page = await listTimelinePage(db, accountId, [c1!, c2!, c3!]);
      expect(page.items.map((i) => [i.kind, i.contactId])).toEqual([["call", c1], ["booking", c2], ["note", c3]]);
      expect(page).toMatchObject({ older: null, failed: [] });
    }));

  it("the contact page's one id is the same page item for item, and stays on `.eq` (mutation: pass the set form for one id -> a contact_id `.in` is recorded, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { ids: [c1, c2] } = await household(db, accountId, 2);
      await addNote(db, accountId, c1!, "mine", ACTOR);
      await addTask(db, accountId, { contactId: c1!, title: "t" }, ACTOR);
      await addNote(db, accountId, c2!, "theirs", ACTOR);
      const seen: unknown[][] = [];
      const one = await listContactTimelinePage(recordingIn(db, seen), accountId, c1!);
      const set = await listTimelinePage(db, accountId, [c1!]);
      expect(seen).toEqual([]);
      expect(one).toEqual(set);
      expect(one.items.map((i) => i.kind).sort()).toEqual(["note", "task"]);
      expect(one.items.every((i) => i.contactId === c1)).toBe(true);
    }));

  it("an empty set is an empty page, empty facts and an empty Next up, with no read at all (mutation: drop the timeline's short-circuit -> forContacts refuses and all seven sources fail, FAILS)", async () => {
    const from = vi.fn(() => { throw new Error("no read expected"); });
    const db = { from } as unknown as SupabaseClient;
    expect(await listTimelinePage(db, "acct", [])).toEqual({ items: [], older: null, failed: [] });
    expect(await groupFacts(db, "acct", [])).toEqual({ bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null } });
    expect(await groupNextUp(db, "acct", [], "2026-10-12T15:00:00Z")).toEqual({ bookings: [], datedTasks: [], undatedCount: 0 });
    expect(from).not.toHaveBeenCalled();
  });
});

describe("groupActivityMembers (S-03 part 2b, C5, D7)", () => {
  it("the call-first member, then most recently talked to (never-talked last), then newest joined; cut at the cap while the total stays exact (mutation: sort nulls first -> a never-talked member second, FAILS; mutation: drop the call-first rule -> FAILS; mutation: created_at ascending -> FAILS; mutation: total from the cut list -> 2, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 4);
      const [c0, c1, c2, c3] = h.ids;
      const talked = async (contactId: string, at: string) => {
        const { id } = await ensureConversation(db, accountId, contactId, ACTOR);
        const { error } = await db.from("conversations").update({ last_message_at: at }).eq("id", id);
        if (error) throw new Error(error.message);
      };
      await talked(c0!, "2026-09-01T15:00:00+00:00"); // the oldest talk: first only because they are called first
      await talked(c2!, "2026-10-05T15:00:00+00:00");
      // c1 and c3 never talked; c3 joined after c1, so c3 comes before c1.
      const joined = ["2026-08-01T00:00:00+00:00", "2026-08-02T00:00:00+00:00", "2026-08-03T00:00:00+00:00", "2026-08-04T00:00:00+00:00"];
      for (const [i, memberId] of h.memberIds.entries()) {
        const { error } = await db.from("client_group_members").update({ created_at: joined[i] }).eq("id", memberId);
        if (error) throw new Error(error.message);
      }
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[0]!, ACTOR)).toMatchObject({ status: "ok" });
      const all = await groupActivityMembers(db, accountId, h.groupId, 10);
      expect(all.people.map((p) => p.contactId)).toEqual([c0, c2, c3, c1]);
      expect(all.people[1]).toEqual({ contactId: c2, firstName: "P2", lastName: "Garcia" });
      const cut = await groupActivityMembers(db, accountId, h.groupId, 2);
      expect(cut.people.map((p) => p.contactId)).toEqual([c0, c2]);
      expect(cut.total).toEqual({ ok: true, value: 4 });
    }));
});

describe("groupFacts (S-03 part 2b, C8, C9)", () => {
  it("bookings made across the set, not reschedules (mutation: count the first id only -> 1, FAILS); Last talked is the newest across the set and names its member (mutation: take the older of the two -> FAILS; mutation: map the message's member from the first id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { ids: [c1, c2, c3] } = await household(db, accountId, 3);
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const span = (v: string) => ({ startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) });
      await createBooking(db, accountId, { calendarId: cal.id, contactId: c1!, ...span("2027-03-02T15:00:00Z") }, ACTOR);
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: c2!, ...span("2027-03-03T15:00:00Z") }, ACTOR);
      await createBooking(db, accountId, { calendarId: cal.id, contactId: c2!, ...span("2027-03-04T15:00:00Z"), rescheduledFromId: first.id }, ACTOR);
      const { id: conv1 } = await ensureConversation(db, accountId, c1!, ACTOR);
      await seedMessage(db, accountId, conv1, "sms", "2026-10-03T15:00:00Z", "delivered");
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
      const { error } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id, contact_id: c2, started_at: "2026-10-05T15:00:00Z", outcome: "booked" });
      if (error) throw new Error(error.message);
      const ids = [c1!, c2!, c3!];
      const f = await groupFacts(db, accountId, ids);
      expect(f.bookingsMade).toEqual({ ok: true, value: 2 });
      const t = f.lastTalked as { ok: true; value: { at: string; channel: string; contactId: string } };
      expect({ at: iso(t.value.at), channel: t.value.channel, contactId: t.value.contactId })
        .toEqual({ at: "2026-10-05T15:00:00.000Z", channel: "call", contactId: c2 });
      const { id: conv3 } = await ensureConversation(db, accountId, c3!, ACTOR);
      await seedMessage(db, accountId, conv3, "email", "2026-10-06T15:00:00Z", "delivered");
      await seedMessage(db, accountId, conv1, "sms", "2026-10-07T15:00:00Z", "failed");
      const g = (await groupFacts(db, accountId, ids)).lastTalked as { ok: true; value: { at: string; channel: string; contactId: string } };
      expect({ at: iso(g.value.at), channel: g.value.channel, contactId: g.value.contactId })
        .toEqual({ at: "2026-10-06T15:00:00.000Z", channel: "email", contactId: c3 });
    }));

  it("a failed read is that fact's { ok: false }, named, never thrown (mutation: let it reject -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { ids } = await household(db, accountId, 2);
      const broken = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "from") return (table: string) => target.from(table === "conversations" ? "no_such_table_s03" : table);
          return Reflect.get(target, prop, receiver);
        },
      }) as SupabaseClient;
      const onError = vi.fn();
      const f = await groupFacts(broken, accountId, ids, { onError });
      expect(f).toEqual({ bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: false } });
      expect(onError).toHaveBeenCalledWith("talked", expect.anything());
    }));
});

describe("groupNextUp (S-03 part 2b, C9)", () => {
  it("bookings and dated To-dos across the set each carry their member; the undated count spans the set (mutation: count the first id only -> 1, FAILS; mutation: drop contact_id from the To-do select -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { ids: [c1, c2, c3] } = await household(db, accountId, 3);
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const b = await createBooking(db, accountId, { calendarId: cal.id, contactId: c1!, startsAt: new Date("2026-10-14T15:00:00Z"), endsAt: new Date("2026-10-14T16:00:00Z") }, ACTOR);
      const t = await addTask(db, accountId, { contactId: c2!, title: "Quote", dueAt: "2026-10-20T05:00:00Z" }, ACTOR);
      await addTask(db, accountId, { contactId: c1!, title: "Someday" }, ACTOR);
      await addTask(db, accountId, { contactId: c3!, title: "Someday too" }, ACTOR);
      const n = await groupNextUp(db, accountId, [c1!, c2!, c3!], "2026-10-12T15:00:00Z");
      expect(n.bookings).toEqual([expect.objectContaining({ id: b.id, contact_id: c1 })]);
      expect(n.datedTasks).toEqual([expect.objectContaining({ id: t.id, contact_id: c2, title: "Quote" })]);
      expect(n.undatedCount).toBe(2);
    }));
});
