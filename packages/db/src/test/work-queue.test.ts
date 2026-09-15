import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listAccountWork, listAgencyWork, mapBounded, AGENCY_READ_CONCURRENCY } from "../work-queue";
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

  // openTasks was the only one of the three sources with no row limit —
  // unansweredConversations and staleBookings both cap at 200. An account
  // with more open tasks than that must still return a bounded page rather
  // than every row ever created.
  it("caps open tasks at 200 rather than returning every row ever created", async () => {
    await withTestAccount(async (db, accountId) => {
      const rows = Array.from({ length: 201 }, (_, i) => ({
        account_id: accountId, title: `Bulk task ${i}`,
      }));
      const { error } = await db.from("tasks").insert(rows);
      expect(error).toBeNull();

      const work = await listAccountWork(db, accountId);
      const taskCount = work.filter((r) => r.source === "task").length;
      expect(taskCount).toBeLessThanOrEqual(200);
    });
  });

  // The screen buckets by due_at (Overdue/Today take priority over Waiting),
  // but the cap above used to order the READ by created_at — so an account
  // past the cap could have a task due today fall off in favour of tasks
  // created earlier that carry no due date at all. 200 undated tasks are
  // inserted FIRST (so they'd win a created_at-ascending race), then one more
  // dated task is created last — the shape that would have been dropped
  // under the old order.
  it("keeps a task with a due date over undated ones when open tasks exceed the cap", async () => {
    await withTestAccount(async (db, accountId) => {
      const undated = Array.from({ length: 200 }, (_, i) => ({
        account_id: accountId, title: `Bulk task ${i}`,
      }));
      const { error } = await db.from("tasks").insert(undated);
      expect(error).toBeNull();

      const dueToday = await addTask(
        db, accountId,
        { title: "Call about the estimate", dueAt: new Date().toISOString() },
        "user_test",
      );

      const work = await listAccountWork(db, accountId);
      expect(work.map((r) => r.id)).toContain(`task:${dueToday.id}`);
    });
  });
});

describe("listAgencyWork", () => {
  it("carries each account's brand_name (never name) and timezone", async () => {
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
    });
  });

  // The column is nullable. `brandDisplayName` (branding.ts) takes no second
  // argument, deliberately — `accounts.name` is the agency's internal label
  // and reached customers three times while a resolver still accepted it as
  // a fallback; removing the parameter is what makes that leak impossible
  // rather than merely discouraged. A blank brand_name is unreachable
  // through the product today (migration 0028 backfilled every existing
  // row; createAccount, the Branding save, and go-live all keep it
  // populated since) — this test reaches the path only by nulling the
  // column by hand — but when it IS blank, the row still must not fall back
  // to the internal label. `agency-work-list.tsx` is the one that renders a
  // neutral placeholder for the reader; this level just proves the value
  // itself stays blank rather than becoming `accounts.name`.
  it("returns a blank brand name, never the account's internal label, when brand_name is null", async () => {
    await withTestAccount(async (db, accountId) => {
      const open = await addTask(db, accountId, { title: "Call Maria back" }, "user_test");
      await db.from("accounts").update({ brand_name: null }).eq("id", accountId);

      const rows = await listAgencyWork(db);
      const mine = rows.filter((r) => r.accountId === accountId);
      expect(mine.some((r) => r.id === `task:${open.id}`)).toBe(true);
      expect(mine.every((r) => r.brandName === "")).toBe(true);
    });
  });

  // A suppressed account's own customers still wait on a reply — the reviewer
  // found Resaca's three waiting customers invisible on live data, on the
  // newest account in the agency, the exact profile of one suppressed
  // pending carrier registration. Excluding the account entirely made a
  // blank queue indistinguishable from a finished one. The fix is read-only:
  // nothing about actual sending changes, the row is included and flagged so
  // the agency sees the work and knows not to text.
  it("still lists a suppressed account's work, flagged, and leaves an unsuppressed sibling unflagged", async () => {
    await withTestAccount(async (db, accountId) => {
      const open = await addTask(db, accountId, { title: "Call Maria back" }, "user_test");

      const before = await listAgencyWork(db);
      const mineBefore = before.filter((r) => r.accountId === accountId);
      expect(mineBefore.some((r) => r.id === `task:${open.id}`)).toBe(true);
      expect(mineBefore.every((r) => r.suppressed === false)).toBe(true);

      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      const after = await listAgencyWork(db);
      const mineAfter = after.filter((r) => r.accountId === accountId);
      // Still present — the previous behaviour dropped the account entirely.
      expect(mineAfter.map((r) => r.id)).toContain(`task:${open.id}`);
      expect(mineAfter.every((r) => r.suppressed === true)).toBe(true);
    });
  });
});

describe("mapBounded", () => {
  // listAgencyWork's serial per-account loop measured at ~95ms + 135ms per
  // account on live data — a third of a second at two accounts, extrapolating
  // to several seconds at twenty-five. This is the helper that fixes it, unit
  // tested in isolation (a fake async fn with a counter and a timer) rather
  // than through a live Supabase read, which cannot prove overlap
  // deterministically. Two claims, two mutations: reverting to a serial
  // `for` loop makes `maxInFlight` collapse to 1 (fails the first
  // assertion); removing the chunking (`Promise.all(items.map(fn))`
  // unbounded) lets `maxInFlight` reach the full 20 (fails the second).
  it("runs items with more than one in flight at once, never more than the bound", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapBounded(items, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return i * 2;
    });

    expect(results).toEqual(items.map((i) => i * 2));
    // Proves concurrency: a serial loop can never have more than one in flight.
    expect(maxInFlight).toBeGreaterThan(1);
    // Proves the bound: an unbounded fan-out over 20 items would reach 20.
    expect(maxInFlight).toBeLessThanOrEqual(AGENCY_READ_CONCURRENCY);
  });
});
