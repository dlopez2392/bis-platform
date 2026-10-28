import { describe, it, expect } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { setBranding } from "../branding";
import {
  getOrCreateCalendar, createBooking, setBookingStatus, updateCalendarSettings,
  listDueFollowups,
} from "../booking";
import {
  upsertAutomation,
  listDueReviewRequests, listDueNoShowNudges, listDueReferralAsks, listDueQuoteFollowups,
  listDueReactivations, listDueSmsReminders, listDueAppointmentConfirms,
} from "../automations";
import { ensureConversation, createMessage } from "../messaging";
import { ensureDefaultPipeline, listPipelinesWithStages } from "../crm-config";
import { createOpportunity } from "../opportunities";

/**
 * T5 (0103, owner ruling Q2): a scheduled send that would START a new
 * conversation skips an archived contact; one that keeps a promise already
 * made (the SMS reminder, the appointment confirmation) still goes.
 *
 * Direct write, service-role (`archiveContact` below): the stamp trigger's
 * archive branch (`app.contacts_archive_stamp`) only runs for an
 * `authenticated` caller — `withTestAccount`'s `db` is `serviceDb()` — so
 * this mirrors T1's own schema test in setting `archived_at` straight. T1
 * proves the trigger; this file proves the QUERY side only.
 */
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

async function archiveContact(db: SupabaseClient, contactId: string): Promise<void> {
  const { error } = await db.from("contacts").update({ archived_at: new Date().toISOString() }).eq("id", contactId);
  if (error) throw new Error(`archiveContact failed: ${error.message}`);
}

describe("0103 (T5): scheduled sends skip archived contacts", () => {
  it("listDueReviewRequests: account A's archived customer is out; account B's identical active one is in", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const now = new Date("2027-03-10T12:00:00Z");
        await upsertAutomation(dbA, accountA, "review_request",
          { enabled: true, body: "Loved working with you?", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
          "user_test");
        await upsertAutomation(dbB, accountB, "review_request",
          { enabled: true, body: "Loved working with you?", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
          "user_test");

        const calA = await getOrCreateCalendar(dbA, accountA, "user_test");
        const { id: archivedContact } = await createContact(dbA, accountA, { firstName: "Archived", phone: "(956) 555-0201" }, "user_test");
        const archivedBooking = await createBooking(dbA, accountA,
          { calendarId: calA.id, contactId: archivedContact,
            startsAt: new Date(now.getTime() - 3 * HOUR), endsAt: new Date(now.getTime() - 2 * HOUR) },
          "user_test");
        await setBookingStatus(dbA, accountA, archivedBooking.id, "completed", "user_test");
        await archiveContact(dbA, archivedContact);

        const calB = await getOrCreateCalendar(dbB, accountB, "user_test");
        const { id: activeContact } = await createContact(dbB, accountB, { firstName: "Active", phone: "(956) 555-0202" }, "user_test");
        const activeBooking = await createBooking(dbB, accountB,
          { calendarId: calB.id, contactId: activeContact,
            startsAt: new Date(now.getTime() - 3 * HOUR), endsAt: new Date(now.getTime() - 2 * HOUR) },
          "user_test");
        await setBookingStatus(dbB, accountB, activeBooking.id, "completed", "user_test");

        // Mutation: drop listDueReviewRequests' `.is("contacts.archived_at", null)` -> FAILS
        const ids = (await listDueReviewRequests(dbA, now.toISOString())).map((r) => r.bookingId);
        expect(ids).not.toContain(archivedBooking.id);
        expect(ids).toContain(activeBooking.id);
      });
    });
  });

  it("listDueNoShowNudges: account A's archived customer is out; account B's identical active one is in", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const now = new Date("2027-03-10T12:00:00Z");
        await upsertAutomation(dbA, accountA, "no_show_nudge", { enabled: true, body: "Come back!", config: { channel: "sms" } }, "user_test");
        await upsertAutomation(dbB, accountB, "no_show_nudge", { enabled: true, body: "Come back!", config: { channel: "sms" } }, "user_test");
        const clock = (db: SupabaseClient, id: string, at: Date) =>
          db.from("bookings").update({ status: "no_show", no_show_at: at.toISOString() }).eq("id", id).then(({ error }) => {
            if (error) throw new Error(error.message);
          });

        const calA = await getOrCreateCalendar(dbA, accountA, "user_test");
        const { id: archivedContact } = await createContact(dbA, accountA, { firstName: "Archived", phone: "(956) 555-0203" }, "user_test");
        const archivedBooking = await createBooking(dbA, accountA,
          { calendarId: calA.id, contactId: archivedContact,
            startsAt: new Date(now.getTime() - 3 * HOUR), endsAt: new Date(now.getTime() - 2 * HOUR) },
          "user_test");
        await clock(dbA, archivedBooking.id, new Date(now.getTime() - 90 * MINUTE));
        await archiveContact(dbA, archivedContact);

        const calB = await getOrCreateCalendar(dbB, accountB, "user_test");
        const { id: activeContact } = await createContact(dbB, accountB, { firstName: "Active", phone: "(956) 555-0204" }, "user_test");
        const activeBooking = await createBooking(dbB, accountB,
          { calendarId: calB.id, contactId: activeContact,
            startsAt: new Date(now.getTime() - 3 * HOUR), endsAt: new Date(now.getTime() - 2 * HOUR) },
          "user_test");
        await clock(dbB, activeBooking.id, new Date(now.getTime() - 90 * MINUTE));

        // Mutation: drop listDueNoShowNudges' `.is("contacts.archived_at", null)` -> FAILS
        const ids = (await listDueNoShowNudges(dbA, now.toISOString())).map((r) => r.bookingId);
        expect(ids).not.toContain(archivedBooking.id);
        expect(ids).toContain(activeBooking.id);
      });
    });
  });

  it("listDueReferralAsks: account A's archived customer is out; account B's identical active one is in", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const now = new Date("2027-08-20T12:00:00Z");
        await upsertAutomation(dbA, accountA, "referral_ask", { enabled: true, body: "", config: { channel: "sms" } }, "user_test");
        await upsertAutomation(dbB, accountB, "referral_ask", { enabled: true, body: "", config: { channel: "sms" } }, "user_test");

        const mk = async (db: SupabaseClient, accountId: string, calendarId: string, contactId: string) => {
          const b = await createBooking(db, accountId,
            { calendarId, contactId, startsAt: new Date(now.getTime() - 40 * HOUR - MINUTE), endsAt: new Date(now.getTime() - 40 * HOUR) },
            "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
          return b;
        };

        const calA = await getOrCreateCalendar(dbA, accountA, "user_test");
        const { id: archivedContact } = await createContact(dbA, accountA, { firstName: "Archived", phone: "(956) 555-0205" }, "user_test");
        const archivedBooking = await mk(dbA, accountA, calA.id, archivedContact);
        await archiveContact(dbA, archivedContact);

        const calB = await getOrCreateCalendar(dbB, accountB, "user_test");
        const { id: activeContact } = await createContact(dbB, accountB, { firstName: "Active", phone: "(956) 555-0206" }, "user_test");
        const activeBooking = await mk(dbB, accountB, calB.id, activeContact);

        // Mutation: drop listDueReferralAsks' `.is("contacts.archived_at", null)` -> FAILS
        const ids = (await listDueReferralAsks(dbA, now.toISOString())).map((r) => r.bookingId);
        expect(ids).not.toContain(archivedBooking.id);
        expect(ids).toContain(activeBooking.id);
      });
    });
  });

  it("listDueQuoteFollowups: account A's archived customer's deal is out; account B's identical active one is in", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const now = new Date("2027-10-20T12:00:00Z");

        const setUp = async (db: SupabaseClient, accountId: string, firstName: string, phone: string) => {
          const { pipelineId } = await ensureDefaultPipeline(db, accountId);
          const pipelines = await listPipelinesWithStages(db, accountId);
          const stageId = pipelines.find((p) => p.id === pipelineId)!.stages[0]!.id;
          await upsertAutomation(db, accountId, "quote_followup",
            { enabled: true, body: "", config: { stageId, quietDays: 3, channel: "sms" } }, "user_test");
          const { id: contactId } = await createContact(db, accountId, { firstName, phone }, "user_test");
          const opp = await createOpportunity(db, accountId, { contactId, pipelineId, name: "Reroof" }, "user_test");
          const { error } = await db.from("opportunities")
            .update({ stage_id: stageId, stage_changed_at: new Date(now.getTime() - 5 * DAY).toISOString() })
            .eq("id", opp.id);
          if (error) throw new Error(`park failed: ${error.message}`);
          return { oppId: opp.id, contactId };
        };

        const archived = await setUp(dbA, accountA, "Archived", "(956) 555-0207");
        await archiveContact(dbA, archived.contactId);
        const active = await setUp(dbB, accountB, "Active", "(956) 555-0208");

        // Mutation: drop listDueQuoteFollowups' `.is("contacts.archived_at", null)` -> FAILS
        const ids = (await listDueQuoteFollowups(dbA, now.toISOString())).map((r) => r.opportunityId);
        expect(ids).not.toContain(archived.oppId);
        expect(ids).toContain(active.oppId);
      });
    });
  });

  it("listDueFollowups: account A's archived customer's booking is out; account B's identical active one is in", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const now = new Date("2027-03-10T12:00:00Z");
        await updateCalendarSettings(dbA, accountA, { followupEnabled: true, followupBody: "How did it go?" }, "user_test");
        await updateCalendarSettings(dbB, accountB, { followupEnabled: true, followupBody: "How did it go?" }, "user_test");

        const calA = await getOrCreateCalendar(dbA, accountA, "user_test");
        const { id: archivedContact } = await createContact(dbA, accountA, { firstName: "Archived", email: "archived-fu@example.com" }, "user_test");
        const archivedBooking = await createBooking(dbA, accountA,
          { calendarId: calA.id, contactId: archivedContact,
            startsAt: new Date(now.getTime() - 3 * HOUR), endsAt: new Date(now.getTime() - 2 * HOUR) },
          "user_test");
        await archiveContact(dbA, archivedContact);

        const calB = await getOrCreateCalendar(dbB, accountB, "user_test");
        const { id: activeContact } = await createContact(dbB, accountB, { firstName: "Active", email: "active-fu@example.com" }, "user_test");
        const activeBooking = await createBooking(dbB, accountB,
          { calendarId: calB.id, contactId: activeContact,
            startsAt: new Date(now.getTime() - 3 * HOUR), endsAt: new Date(now.getTime() - 2 * HOUR) },
          "user_test");

        // Mutation: drop listDueFollowups' `.is("contacts.archived_at", null)` -> FAILS
        const ids = (await listDueFollowups(dbA, now.toISOString())).map((r) => r.bookingId);
        expect(ids).not.toContain(archivedBooking.id);
        expect(ids).toContain(activeBooking.id);
      });
    });
  });

  it("listDueReactivations: account A's archived customer is out; account B's identical active one is in", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const now = new Date("2027-09-21T12:00:00Z");
        const longAgo = new Date("2026-10-01T12:00:00Z");   // ~11.7 months, well inside the 9-month default
        const SEND_READY = { mailingAddress: "1 Fixture Way\nMcAllen, TX 78501", replyToEmail: "owner@example.com" };

        const setUp = async (db: SupabaseClient, accountId: string, firstName: string) => {
          const cal = await getOrCreateCalendar(db, accountId, "user_test");
          await upsertAutomation(db, accountId, "reactivation", { enabled: true, body: "", config: { months: 9 } }, "user_test");
          await setBranding(db, accountId, SEND_READY, "user_test");
          const { id: contactId } = await createContact(db, accountId, { firstName, email: `${firstName.toLowerCase()}@example.com` }, "user_test");
          const convo = await ensureConversation(db, accountId, contactId, "user_test");
          await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
          await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("conversation_id", convo.id);
          await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
          const b = await createBooking(db, accountId,
            { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
          return contactId;
        };

        const archivedContact = await setUp(dbA, accountA, "Archived");
        await archiveContact(dbA, archivedContact);
        const activeContact = await setUp(dbB, accountB, "Active");

        // Mutation: drop the conversations read's `.is("contacts.archived_at", null)` -> FAILS
        const ids = (await listDueReactivations(dbA, now.toISOString())).map((r) => r.contactId);
        expect(ids).not.toContain(archivedContact);
        expect(ids).toContain(activeContact);
      });
    });
  });

  it("listDueReactivations: a page full of archived contacts does not starve an active one behind them (mutation: filter in memory after the page instead of in the query -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation", { enabled: true, body: "", config: { months: 9 } }, "user_test");
      await setBranding(db, accountId, { mailingAddress: "1 Fixture Way\nMcAllen, TX 78501", replyToEmail: "owner@example.com" }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");

      // A dedicated, otherwise-unused date range (the reservation convention
      // of automations.test.ts:1443-1447, which claims 2019-01-01..2020-03-01
      // for its own starvation case — this walk is platform-wide, so two
      // files' fixtures in the same oldest-first window could interleave).
      const mk = async (name: string, at: Date, completed: boolean, archived: boolean) => {
        const { id } = await createContact(db, accountId, { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        const { id: msg } = await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: at.toISOString() }).eq("id", msg);
        await db.from("conversations").update({ last_message_at: at.toISOString() }).eq("id", convo.id);
        if (completed) {
          const b = await createBooking(db, accountId,
            { calendarId: cal.id, contactId: id, startsAt: new Date(at.getTime() - HOUR), endsAt: at }, "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        }
        if (archived) await archiveContact(db, id);
        return id;
      };

      await mk("Archivedone", new Date("2015-01-01T12:00:00Z"), true, true);
      await mk("Archivedtwo", new Date("2015-01-08T12:00:00Z"), true, true);
      await mk("Archivedthree", new Date("2015-01-15T12:00:00Z"), true, true);
      await mk("Archivedfour", new Date("2015-01-22T12:00:00Z"), true, true);
      const active = await mk("Customer", new Date("2015-02-01T12:00:00Z"), true, false);

      // Two pages of two: in the CORRECT implementation (the filter inside
      // the query), the four archived conversations never appear in the
      // result at all, so `active` is the first row of page 1. In the WRONG
      // implementation (filtered in memory after the page), the four
      // archived rows fill both pages' budget and `active`, fifth in the
      // oldest-first order, is never reached.
      const ids = (await listDueReactivations(db, now.toISOString(), { pageSize: 2, maxPages: 2 }))
        .map((r) => r.contactId);
      expect(ids).toContain(active);
    });
  });

  it("listDueSmsReminders: an archived customer's upcoming appointment is still returned (ruling Q2: a promise already made is kept)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "sms_reminder", { enabled: true, body: "See you soon!", config: {} }, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Archived", phone: "(956) 555-0209" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() + 2 * HOUR), endsAt: new Date(now.getTime() + 2 * HOUR + MINUTE) },
        "user_test");
      await archiveContact(db, contactId);

      // Mutation: add `.is("contacts.archived_at", null)` to listDueSmsReminders -> FAILS
      const ids = (await listDueSmsReminders(db, now.toISOString())).map((r) => r.bookingId);
      expect(ids).toContain(booking.id);
    });
  });

  it("listDueAppointmentConfirms: an archived customer's upcoming appointment is still returned (ruling Q2: a promise already made is kept)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "appointment_confirm", { enabled: true, body: "Any questions, just reply.", config: {} }, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Archived", phone: "(956) 555-0210" }, "user_test");
      const now = new Date("2027-04-12T12:00:00Z");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date(now.getTime() + 47 * HOUR + 30 * MINUTE), endsAt: new Date(now.getTime() + 47 * HOUR + 31 * MINUTE) },
        "user_test");
      await archiveContact(db, contactId);

      // Mutation: add `.is("contacts.archived_at", null)` to listDueAppointmentConfirms -> FAILS
      const ids = (await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId);
      expect(ids).toContain(booking.id);
    });
  });
});
