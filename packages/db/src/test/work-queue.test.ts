import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listAccountWork, listAgencyWork } from "../work-queue";
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

  it("carries the call's summary as the conversation row's title", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: c } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Nora", last_name: "Diaz" })
        .select("id").single();
      const { data: convo } = await db.from("conversations").insert({
        account_id: accountId, contact_id: c!.id, unread_count: 1,
        last_message_at: new Date().toISOString(),
      }).select("id").single();
      // Fresh fixture accounts carry no phone_numbers row — insert one rather
      // than selecting; calls.phone_number_id is NOT NULL.
      const { data: pn } = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+15559990004" })
        .select("id").single();
      await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, contact_id: c!.id,
        conversation_id: convo!.id, outcome: "lead",
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
        summary: "Wants a quote for a new roof",
      });

      const rows = await listAccountWork(db, accountId);
      const row = rows.find((r) => r.id === `conversation:${convo!.id}`);
      expect(row).toBeDefined();
      expect(row!.title).toBe("Wants a quote for a new roof");
    });
  });
});

describe("listAgencyWork", () => {
  it("carries each account's brand_name (never name) and timezone, and honors outbound_suppressed", async () => {
    await withTestAccount(async (db, accountId) => {
      const open = await addTask(db, accountId, { title: "Call Maria back" }, "user_test");

      // createAccount seeds brand_name from name, so both start "Fixture Co"
      // — identical values can't distinguish a read of the wrong column, so
      // diverge them before asserting. timezone also diverges from
      // createAccount's own default ("America/Chicago") so a passing
      // assertion proves the column travelled rather than coincidentally
      // matching the fixture's default.
      await db.from("accounts").update({ brand_name: "Fixture Co — branded", timezone: "America/New_York" })
        .eq("id", accountId);

      const before = await listAgencyWork(db);
      const mine = before.filter((r) => r.accountId === accountId);
      expect(mine.map((r) => r.id)).toContain(`task:${open.id}`);
      expect(mine.every((r) => r.brandName === "Fixture Co — branded")).toBe(true);
      expect(mine.every((r) => r.timezone === "America/New_York")).toBe(true);

      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      const after = await listAgencyWork(db);
      expect(after.some((r) => r.accountId === accountId)).toBe(false);
    });
  });
});
