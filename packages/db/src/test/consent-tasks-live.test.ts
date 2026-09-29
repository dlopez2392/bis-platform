import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEvent } from "../consent";
import { createContact } from "../contacts";
import { ensureConsentTask, completeTasksForConsentEvents, reopenTasks } from "../activities";
import { listAccountWork } from "../work-queue";

/** The consent To-do through PostgREST, on the CI project: one per ledger row, completed and reopened as a set, shown with its row's action. */
describe("consent To-do rows (CI only: withTestAccount + serviceDb)", () => {
  it("a second ensure returns the first task; the work queue reports the linked row's action; complete then reopen round-trips (mutation: drop consent_event_id from openTasks' select → consent is undefined, FAILS)", async () => {
    await withTestAccount(async (_tdb, id) => {
      const db = serviceDb();
      const contact = await createContact(db, id, { firstName: "Hold", phone: "+19565550133" }, "consent-tasks-live", "system");
      const ev = await appendConsentEvent(db, { accountId: id, channel: "sms", address: "+19565550133", action: "held", method: "free_text", contactId: contact.id });
      const one = await ensureConsentTask(db, id, { contactId: contact.id, consentEventId: ev.id, title: "Hold may have asked to stop texts" }, "consent-tasks-live", "system");
      const two = await ensureConsentTask(db, id, { contactId: contact.id, consentEventId: ev.id, title: "again" }, "consent-tasks-live", "system");
      expect(one.created).toBe(true);
      expect(two).toEqual({ id: one.id, created: false });
      const work = await listAccountWork(db, id);
      expect(work.find((w) => w.id === `task:${one.id}`)?.consent).toEqual({ eventId: ev.id, action: "held" });
      expect(await completeTasksForConsentEvents(db, id, [ev.id], "consent-tasks-live", "system")).toEqual([one.id]);
      expect((await listAccountWork(db, id)).some((w) => w.id === `task:${one.id}`)).toBe(false);
      await reopenTasks(db, id, [one.id], "consent-tasks-live", "system");
      expect((await listAccountWork(db, id)).some((w) => w.id === `task:${one.id}`)).toBe(true);
    });
  });
});
