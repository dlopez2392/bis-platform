import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listAccountWork } from "../work-queue";
import { addTask } from "../activities";
import { getOrCreateCalendar, createBooking } from "../booking";

describe("listAccountWork", () => {
  it("returns an open task and omits a completed one", async () => {
    await withTestAccount(async (db, accountId) => {
      const open = await addTask(db, accountId, { title: "Call Maria back" }, "user_test");
      const done = await addTask(db, accountId, { title: "Already handled" }, "user_test");
      await db.from("tasks").update({ completed_at: new Date().toISOString() })
        .eq("id", done.id);

      const rows = await listAccountWork(db, accountId);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(`task:${open.id}`);
      expect(ids).not.toContain(`task:${done.id}`);
    });
  });

  it("includes a lead call with no outbound message after it", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: c } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Maria", last_name: "Gomez" })
        .select("id").single();
      // Fresh fixture accounts carry no phone_numbers row — insert one rather
      // than selecting; calls.phone_number_id is NOT NULL.
      const { data: pn } = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+15559990002" })
        .select("id").single();
      const { data: call } = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, contact_id: c!.id,
        outcome: "lead", started_at: new Date(Date.now() - 3_600_000).toISOString(),
      }).select("id").single();

      const rows = await listAccountWork(db, accountId);
      expect(rows.map((r) => r.id)).toContain(`call:${call!.id}`);
    });
  });

  it("includes a conversation with unread messages", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: c } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Sam", last_name: "Rivera" })
        .select("id").single();
      const { data: convo } = await db.from("conversations").insert({
        account_id: accountId, contact_id: c!.id, unread_count: 2,
        last_message_at: new Date().toISOString(),
      }).select("id").single();

      const rows = await listAccountWork(db, accountId);
      expect(rows.map((r) => r.id)).toContain(`conversation:${convo!.id}`);
    });
  });

  it("includes a stale booking nobody marked completed or no_show", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { data: c } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Jo", last_name: "Kim" })
        .select("id").single();
      const booking = await createBooking(db, accountId, {
        calendarId: cal.id, contactId: c!.id,
        startsAt: new Date(Date.now() - 7_200_000),
        endsAt: new Date(Date.now() - 3_600_000),
      }, "user_test");

      const rows = await listAccountWork(db, accountId);
      expect(rows.map((r) => r.id)).toContain(`booking:${booking.id}`);
    });
  });

  it("excludes an abandoned call", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: c } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Ann", last_name: "Lee" })
        .select("id").single();
      // Fresh fixture accounts carry no phone_numbers row — insert one rather
      // than selecting; calls.phone_number_id is NOT NULL.
      const { data: pn } = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+15559990001" })
        .select("id").single();
      const { data: call } = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, contact_id: c!.id,
        outcome: "abandoned", started_at: new Date(Date.now() - 3_600_000).toISOString(),
      }).select("id").single();

      const rows = await listAccountWork(db, accountId);
      expect(rows.map((r) => r.id)).not.toContain(`call:${call!.id}`);
    });
  });

  it("an open task on a contact suppresses that contact's derived rows", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: c } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Ann", last_name: "Lee" })
        .select("id").single();
      await db.from("conversations").insert({
        account_id: accountId, contact_id: c!.id, unread_count: 2,
        last_message_at: new Date().toISOString(),
      });

      const before = await listAccountWork(db, accountId);
      expect(before.some((r) => r.source === "conversation")).toBe(true);

      await addTask(db, accountId, { contactId: c!.id, title: "Reply to Ann" }, "user_test");
      const after = await listAccountWork(db, accountId);
      expect(after.some((r) => r.source === "conversation")).toBe(false);
    });
  });
});
