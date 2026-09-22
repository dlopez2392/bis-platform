import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus, getDueReminderById, getDueFollowupById, stampReminderSent } from "../booking";
import { upsertAutomation, getDueSmsReminderById, getDueReviewRequestById, getDueNoShowNudgeById,
  getDueAppointmentConfirmById, stampAppointmentConfirmAsked,
  getDueReferralAskById, stampReferralAsked,
  getDueReactivationById, stampReactivationSent } from "../automations";
import { ensureConversation, createMessage } from "../messaging";

/**
 * Each lookup answers "is this still a thing to send" WITHOUT a time window
 * — the release step owns "when". Three answers per lookup: the row, `gone`,
 * `off`. Live, because the predicates are PostgREST filters and a mocked db
 * cannot tell `.eq("status","booked")` from `.eq("status","completed")`.
 */
async function seed(db: Parameters<typeof createContact>[0], accountId: string) {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(db, accountId,
    { firstName: "Due", email: "due@example.com", phone: "(956) 555-0199" }, "user_test");
  const { id: bookingId } = await createBooking(db, accountId,
    { calendarId: cal.id, contactId, startsAt: new Date("2027-03-05T15:00:00Z"), endsAt: new Date("2027-03-05T16:00:00Z") },
    "user_test");
  return { cal, contactId, bookingId };
}

describe("getDueReminderById", () => {
  it("returns the row for a booked, unstamped booking; `gone` once stamped or cancelled; `contactId` filled", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId, contactId } = await seed(db, accountId);
      const found = await getDueReminderById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);
      expect(found.due?.contactId).toBe(contactId);
      await stampReminderSent(db, bookingId);
      expect(await getDueReminderById(db, bookingId)).toEqual({ due: null, why: "gone" });
      expect(await getDueReminderById(db, "00000000-0000-0000-0000-000000000000")).toEqual({ due: null, why: "gone" });
    });
  });
});

describe("getDueFollowupById", () => {
  it("`off` while the calendar's follow-ups are disabled; the row once enabled (mutation: drop the followup_enabled check → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { cal, bookingId } = await seed(db, accountId);
      // getOrCreateCalendar's default has follow-ups OFF — read it rather than assume.
      const { data: c } = await db.from("calendars").select("followup_enabled").eq("id", cal.id).single();
      if ((c as { followup_enabled: boolean }).followup_enabled) {
        await db.from("calendars").update({ followup_enabled: false }).eq("id", cal.id);
      }
      expect(await getDueFollowupById(db, bookingId)).toEqual({ due: null, why: "off" });
      await db.from("calendars").update({ followup_enabled: true }).eq("id", cal.id);
      expect((await getDueFollowupById(db, bookingId)).due?.bookingId).toBe(bookingId);
    });
  });
});

describe("the recipe lookups: `off` until the recipe is on, `gone` in the wrong status", () => {
  it("sms reminder", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      expect(await getDueSmsReminderById(db, bookingId)).toEqual({ due: null, why: "off" });
      await upsertAutomation(db, accountId, "sms_reminder", { enabled: true, body: "", config: {} }, "user_test");
      expect((await getDueSmsReminderById(db, bookingId)).due?.bookingId).toBe(bookingId);
      await setBookingStatus(db, accountId, bookingId, "cancelled", "user_test");
      expect(await getDueSmsReminderById(db, bookingId)).toEqual({ due: null, why: "gone" });
    });
  });

  it("review request needs status completed", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect(await getDueReviewRequestById(db, bookingId)).toEqual({ due: null, why: "gone" });   // still booked
      await setBookingStatus(db, accountId, bookingId, "completed", "user_test");
      const found = await getDueReviewRequestById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);
      expect(found.due?.config).toEqual({ channel: "email", reviewUrl: "https://g.page/r/x/review" });
    });
  });

  it("no-show nudge needs status no_show and carries the calendar's public id", async () => {
    await withTestAccount(async (db, accountId) => {
      const { cal, bookingId } = await seed(db, accountId);
      await upsertAutomation(db, accountId, "no_show_nudge", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      await setBookingStatus(db, accountId, bookingId, "no_show", "user_test");
      const found = await getDueNoShowNudgeById(db, bookingId);
      expect(found.due?.calendarPublicId).toBe(cal.public_id);
    });
  });

  it("appointment confirm: off until the recipe is on, gone once asked", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      // "off", not "gone" — the releaser writes a DIFFERENT reason for each
      // ("This automation was turned off" vs "No longer due"), so a lookup
      // that collapsed them would put the wrong sentence on a client's
      // screen. Mutation: return `why: "gone"` from the `!auto` branch of
      // getDueAppointmentConfirmById → this case reds by name.
      expect(await getDueAppointmentConfirmById(db, bookingId)).toEqual({ due: null, why: "off" });
      await upsertAutomation(db, accountId, "appointment_confirm",
        { enabled: true, body: "", config: {} }, "user_test");
      // No window check on the by-id path, on purpose: a release is a held
      // row coming back, and its 75-minute window closed hours ago by
      // definition. `seed`'s booking is in 2027 and is never inside it.
      expect((await getDueAppointmentConfirmById(db, bookingId)).due?.bookingId).toBe(bookingId);
      await stampAppointmentConfirmAsked(db, bookingId);
      expect(await getDueAppointmentConfirmById(db, bookingId)).toEqual({ due: null, why: "gone" });
    });
  });

  it("referral ask: gone while still booked, off until the recipe is on, gone once asked, and carries the precedence input", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);

      // STILL BOOKED → `gone`. The lookup's own `.eq("status","completed")`
      // is the only thing that says so, and it is checked BEFORE the recipe
      // is enabled so the answer cannot be the `!auto` branch wearing the
      // wrong name. Mutation: drop `.eq("status","completed")` → this reds
      // with `why: "off"`, because the row is then found and the recipe is
      // not yet on.
      expect(await getDueReferralAskById(db, bookingId)).toEqual({ due: null, why: "gone" });

      await setBookingStatus(db, accountId, bookingId, "completed", "user_test");
      // "off", not "gone" — the releaser writes a DIFFERENT sentence for each
      // ("This automation was turned off" vs "No longer due"). Mutation:
      // return `why: "gone"` from the `!auto` branch → this reds by name.
      expect(await getDueReferralAskById(db, bookingId)).toEqual({ due: null, why: "off" });

      await upsertAutomation(db, accountId, "referral_ask",
        { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      // No window check on the by-id path, on purpose: a release is a held
      // row coming back, and its 85h window closed hours ago by definition.
      const found = await getDueReferralAskById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);

      // THE PRECEDENCE INPUT, ON THE RELEASE PATH. The list path resolves it
      // from a second `listEnabled`; this path re-reads it per account
      // because the agency may have switched the review request ON during
      // the hold, and a release that ignored that would text a referral ask
      // before the review it must follow. Asserted in BOTH directions, so
      // hard-coding it either way reds: `found` here is read with
      // review_request absent entirely.
      expect(found.due?.reviewRequestEnabled).toBe(false);
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect((await getDueReferralAskById(db, bookingId)).due?.reviewRequestEnabled).toBe(true);
      // The row EXISTS but is switched off — a different state from "no row
      // at all", and `enabledRecipeFor` must answer null for both.
      await upsertAutomation(db, accountId, "review_request",
        { enabled: false, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect((await getDueReferralAskById(db, bookingId)).due?.reviewRequestEnabled).toBe(false);

      // THE ONLY DOUBLE-SEND GUARD ON THE RELEASE PATH. `releaseReferralAsk`
      // (Task 6) calls this and then sends; nothing else re-checks the stamp.
      // Mutation: drop `.is("referral_asked_at", null)` → this reds, and a
      // held row whose booking was stamped during the hold is handed back as
      // due and the customer gets a second referral text.
      await stampReferralAsked(db, bookingId);
      expect(await getDueReferralAskById(db, bookingId)).toEqual({ due: null, why: "gone" });
    });
  });

  it("reactivation: off until the recipe is on, gone without a completed job or a conversation, gone once stamped", async () => {
    await withTestAccount(async (db, accountId) => {
      const { contactId, bookingId } = await seed(db, accountId);

      // "off", not "gone" — the releaser writes a DIFFERENT sentence for each
      // ("This automation was turned off" vs "No longer due"), so a lookup
      // that collapsed them would put the wrong sentence on a client's
      // screen. Mutation: return `why: "gone"` from the `!auto` branch of
      // getDueReactivationById → this case reds by name.
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "off" });

      await upsertAutomation(db, accountId, "reactivation",
        // TWELVE, not the default nine: `quietMonths` below then pins that
        // the row carries THIS ACCOUNT'S configured period, and a hard-coded
        // `REACTIVATION_DEFAULT_MONTHS` in the lookup reds it.
        { enabled: true, body: "", config: { months: 12 } }, "user_test");

      // THE ANTI-BLAST RULE ON THE RELEASE PATH. `seed`'s booking is still
      // `booked`, so this contact is a lead and not a past customer.
      // Mutation: drop the completed-booking read from
      // getDueReactivationById → this reds, and a held row for someone this
      // company never worked for is released and mailed.
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "gone" });
      await setBookingStatus(db, accountId, bookingId, "completed", "user_test");

      // Still `gone`: no conversation exists yet, so there is no
      // `last_message_at` to put in the row and nothing for the releaser's
      // own quiet re-check to read.
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "gone" });
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");

      // No quiet check on the by-id path, on purpose: the releaser applies it
      // separately through `conversationQuietSince`, so "they wrote in during
      // the hold" earns its own sentence instead of a flat "No longer due".
      const found = await getDueReactivationById(db, contactId);
      expect(found.due?.contactId).toBe(contactId);
      expect(found.due?.contactEmail).toBe("due@example.com");
      expect(found.due?.quietMonths).toBe(12);

      // THE ONLY DOUBLE-SEND GUARD ON THE RELEASE PATH. `releaseReactivation`
      // (Task 8) calls this and then sends; nothing else re-checks the stamp.
      // Mutation: drop `.is("reactivation_sent_at", null)` → this reds, and a
      // held row whose contact was stamped during the hold is handed back as
      // due and the customer gets a second email.
      await stampReactivationSent(db, contactId);
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "gone" });
    });
  });
});
