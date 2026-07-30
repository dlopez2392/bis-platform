import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage, listConversations,
         incrementUnreadCount, clearUnreadCount } from "../messaging";
import {
  createForm, createSubmission, recordRejectedSubmission, countRecentSubmissions,
  shouldRecordRateLimit, findRecentDuplicate, linkSubmissionContact,
  setSubmissionProcessingError, emitFormSubmitted, listSubmissions, listContactSubmissions,
} from "../forms";

const ANSWERS = [{ key: "email", label: "Email", value: "lead@example.com" }];
const INPUT = {
  answers: ANSWERS, attribution: { utm_source: "google" }, locale: "en",
  ipHash: "hash_a", userAgent: "vitest", answersHash: "ah_1",
  consent: { given: true, text: "I agree to be contacted.", at: "2026-07-29T00:00:00.000Z" },
};

async function form(db: any, accountId: string) {
  const { id } = await createForm(db, accountId, { name: "Quote", fields: [] }, "user_test");
  return id;
}

describe("form submissions", () => {
  it("createSubmission stores answers, attribution and consent and emits nothing yet", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      const { id } = await createSubmission(db, accountId, formId, INPUT);

      const rows = await listSubmissions(db, accountId, formId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(id);
      expect(rows[0]!.answers).toEqual(ANSWERS);
      expect(rows[0]!.attribution).toEqual({ utm_source: "google" });
      expect(rows[0]!.consent!.text).toBe("I agree to be contacted.");
      expect(rows[0]!.spam_reason).toBeNull();

      const { data: ev } = await db.from("events").select("type")
        .eq("account_id", accountId).eq("type", "form.submitted");
      expect(ev).toHaveLength(0);
    }));

  it("emitFormSubmitted records a system actor carrying the contact", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      const { id } = await createSubmission(db, accountId, formId, INPUT);
      const { id: contactId } = await createContact(
        db, accountId, { email: "lead@example.com" }, "form", "system");

      await emitFormSubmitted(db, accountId, { formId, submissionId: id, contactId });

      const { data: ev } = await db.from("events")
        .select("actor_type, actor_id, payload")
        .eq("account_id", accountId).eq("type", "form.submitted");
      expect(ev).toHaveLength(1);
      expect(ev![0]!.actor_type).toBe("system");
      expect((ev![0]!.payload as any).contactId).toBe(contactId);
    }));

  it("a rejected submission is recorded but creates no contact, message or event", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      await recordRejectedSubmission(db, accountId, formId, { ...INPUT, spamReason: "honeypot" });

      const rows = await listSubmissions(db, accountId, formId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.spam_reason).toBe("honeypot");
      expect(rows[0]!.contact_id).toBeNull();

      const { data: contacts } = await db.from("contacts").select("id").eq("account_id", accountId);
      expect(contacts).toHaveLength(0);
      const { data: msgs } = await db.from("messages").select("id").eq("account_id", accountId);
      expect(msgs).toHaveLength(0);
      const { data: ev } = await db.from("events").select("type")
        .eq("account_id", accountId).eq("type", "form.submitted");
      expect(ev).toHaveLength(0);
    }));

  it("countRecentSubmissions counts every row for the ip inside the window only", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      await createSubmission(db, accountId, formId, INPUT);
      await recordRejectedSubmission(db, accountId, formId, { ...INPUT, spamReason: "honeypot" });
      await createSubmission(db, accountId, formId, { ...INPUT, ipHash: "hash_b" });

      const now = Date.now();
      const inWindow = new Date(now - 10 * 60 * 1000).toISOString();
      expect(await countRecentSubmissions(db, formId, "hash_a", inWindow)).toBe(2);
      expect(await countRecentSubmissions(db, formId, "hash_b", inWindow)).toBe(1);

      // A window that closed before these rows were written sees nothing.
      const future = new Date(now + 60 * 1000).toISOString();
      expect(await countRecentSubmissions(db, formId, "hash_a", future)).toBe(0);
    }));

  it("shouldRecordRateLimit marks one row per burst, not one per request", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      await createSubmission(db, accountId, formId, INPUT);

      const inWindow = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      // No marker yet in this window, so the first over-limit hit is worth
      // recording.
      expect(await shouldRecordRateLimit(db, formId, "hash_a", inWindow)).toBe(true);
      await recordRejectedSubmission(db, accountId, formId, { ...INPUT, spamReason: "rate_limited" });

      // A marker already exists in this window, so the rest of the burst adds nothing.
      expect(await shouldRecordRateLimit(db, formId, "hash_a", inWindow)).toBe(false);
    }));

  it("shouldRecordRateLimit only sees a marker inside the given window", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      await createSubmission(db, accountId, formId, INPUT);
      await recordRejectedSubmission(db, accountId, formId, { ...INPUT, spamReason: "rate_limited" });

      const now = Date.now();
      const inWindow = new Date(now - 10 * 60 * 1000).toISOString();
      // The marker falls inside this window, so it suppresses another.
      expect(await shouldRecordRateLimit(db, formId, "hash_a", inWindow)).toBe(false);

      // A window that starts after the marker was written excludes it —
      // a new burst in a later window gets its own marker again.
      const laterWindow = new Date(now + 60 * 1000).toISOString();
      expect(await shouldRecordRateLimit(db, formId, "hash_a", laterWindow)).toBe(true);
    }));

  it("findRecentDuplicate matches the same answers from the same ip", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      await createSubmission(db, accountId, formId, INPUT);
      const since = new Date(Date.now() - 60 * 1000).toISOString();

      expect(await findRecentDuplicate(db, formId, "hash_a", "ah_1", since)).not.toBeNull();
      expect(await findRecentDuplicate(db, formId, "hash_a", "ah_2", since)).toBeNull();
      expect(await findRecentDuplicate(db, formId, "hash_b", "ah_1", since)).toBeNull();
    }));

  it("linkSubmissionContact and setSubmissionProcessingError are visible on the row", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      const { id } = await createSubmission(db, accountId, formId, INPUT);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Lead" }, "form", "system");

      await linkSubmissionContact(db, accountId, id, contactId);
      await setSubmissionProcessingError(db, accountId, id, "notify failed: boom");

      const [row] = await listSubmissions(db, accountId, formId);
      expect(row!.contact_id).toBe(contactId);
      expect(row!.processing_error).toBe("notify failed: boom");
    }));

  it("listContactSubmissions returns only that contact's submissions", () =>
    withTestAccount(async (db, accountId) => {
      const formId = await form(db, accountId);
      const mine = await createSubmission(db, accountId, formId, INPUT);
      await createSubmission(db, accountId, formId, INPUT);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Lead" }, "form", "system");
      await linkSubmissionContact(db, accountId, mine.id, contactId);

      const rows = await listContactSubmissions(db, accountId, contactId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(mine.id);
      expect(rows[0]!.formName).toBe("Quote");
    }));

  it("an inbound form message increments unread, and opening the thread clears it", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Lead" }, "form", "system");
      const convo = await ensureConversation(db, accountId, contactId, "form", "system");

      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "form", direction: "inbound",
        body: "I need a quote for a deck.",
      }, "form", "system");
      await incrementUnreadCount(db, accountId, convo.id);
      await incrementUnreadCount(db, accountId, convo.id);

      let [summary] = await listConversations(db, accountId);
      expect(summary!.unreadCount).toBe(2);

      await clearUnreadCount(db, accountId, convo.id);
      [summary] = await listConversations(db, accountId);
      expect(summary!.unreadCount).toBe(0);
    }));

  it("concurrent increments do not lose a count", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Lead" }, "form", "system");
      const convo = await ensureConversation(db, accountId, contactId, "form", "system");

      await Promise.all(Array.from({ length: 5 }, () =>
        incrementUnreadCount(db, accountId, convo.id)));

      const [summary] = await listConversations(db, accountId);
      expect(summary!.unreadCount).toBe(5);
    }));
});
