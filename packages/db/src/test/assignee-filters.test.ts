import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { listContacts, countContacts, createContact, updateContact, flagMatchesOf } from "../contacts";
import { listConversations } from "../messaging";
import { listAccountWork } from "../work-queue";
import { addTask } from "../activities";

/**
 * Mine / Unassigned list filters (F-085 part 1, spec §8) — Task 3's own db
 * layer. CI-only (withTestAccount + serviceDb, same as assignment.test.ts):
 * these call the real Supabase project's PostgREST, which this package's
 * local Postgres replica cannot stand in for.
 *
 * No membership rows here (unlike assignment.test.ts's `person` helper):
 * none of this file's assertions touch role or RLS, only `assigned_to`
 * columns that already existed before 0068, so a plain `users` row is
 * enough to be a legal assignee.
 */
const RUN = Math.random().toString(36).slice(2, 10);

async function person(db: SupabaseClient, tag: string): Promise<string> {
  const clerk = `user_af_${tag}_${RUN}`;
  const { data, error } = await db.from("users")
    .insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}

/** withTestAccount, then this run's users rows — users go LAST, same ordering
 *  reason as assignment.test.ts's withAssignAccount (contacts/tasks.assigned_to
 *  have no delete action, so a users delete inside the account teardown would
 *  fail on the FK while a row still names the person). */
async function withAssigneeAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>): Promise<void> {
  try {
    await withTestAccount(fn);
  } finally {
    const { error } = await serviceDb().from("users").delete().like("clerk_user_id", `user_af_%_${RUN}`);
    if (error) throw new Error(`assignee-filters.test cleanup failed on users: ${error.message}`);
  }
}

async function rawContact(
  db: SupabaseClient, accountId: string, name: string, assignedTo: string | null,
): Promise<{ id: string; created_at: string }> {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: name, assigned_to: assignedTo })
    .select("id, created_at").single();
  if (error) throw error;
  return data as { id: string; created_at: string };
}

describe("assignee filters (F-085 part 1, spec §8)", () => {
  it("listContacts/countContacts: mine, unassigned, no filter, and a before cursor pages within the filtered set (mutation: drop the filter in countContacts only -> the total case FAILS)", () =>
    withAssigneeAccount(async (db, accountId) => {
      const a = await person(db, "a");
      const c1 = await rawContact(db, accountId, "Mine One", a);
      const c2 = await rawContact(db, accountId, "Mine Two", a);
      const c3 = await rawContact(db, accountId, "Open", null);

      const mine = await listContacts(db, accountId, { assignee: { who: "mine", userId: a } });
      expect(mine.map((r) => r.id).sort()).toEqual([c1.id, c2.id].sort());
      expect(await countContacts(db, accountId, { assignee: { who: "mine", userId: a } })).toBe(2);

      const unassigned = await listContacts(db, accountId, { assignee: { who: "unassigned" } });
      expect(unassigned.map((r) => r.id)).toEqual([c3.id]);
      expect(await countContacts(db, accountId, { assignee: { who: "unassigned" } })).toBe(1);

      const all = await listContacts(db, accountId, {});
      expect(all.map((r) => r.id).sort()).toEqual([c1.id, c2.id, c3.id].sort());
      expect(await countContacts(db, accountId, {})).toBe(3);

      // Paging within the filtered set: two pages of limit 1 for "mine"
      // union back to exactly the two mine contacts — never Open, never a repeat.
      const page1 = await listContacts(db, accountId, { assignee: { who: "mine", userId: a }, limit: 1 });
      expect(page1).toHaveLength(1);
      const last = page1[0] as { id: string; created_at: string };
      const page2 = await listContacts(db, accountId, {
        assignee: { who: "mine", userId: a }, limit: 1,
        before: { v: last.created_at, id: last.id },
      });
      expect(page2).toHaveLength(1);
      expect([page1[0]!.id, page2[0]!.id].sort()).toEqual([c1.id, c2.id].sort());
    }));

  it("listConversations: mine returns only the conversation whose contact is A's (mutation: contacts(...) instead of contacts!inner(...) -> every row comes back, the unmatched one with a null embed -> FAILS)", () =>
    withAssigneeAccount(async (db, accountId) => {
      const a = await person(db, "b");
      const other = await person(db, "c");
      const mineContact = await rawContact(db, accountId, "Mine", a);
      const otherContact = await rawContact(db, accountId, "Other", other);
      const { data: mineConvo, error: e1 } = await db.from("conversations")
        .insert({ account_id: accountId, contact_id: mineContact.id }).select("id").single();
      if (e1) throw e1;
      const { data: otherConvo, error: e2 } = await db.from("conversations")
        .insert({ account_id: accountId, contact_id: otherContact.id }).select("id").single();
      if (e2) throw e2;

      const mine = await listConversations(db, accountId, { assignee: { who: "mine", userId: a } });
      expect(mine.map((r) => r.id)).toEqual([mineConvo!.id]);

      const unassigned = await listConversations(db, accountId, { assignee: { who: "unassigned" } });
      expect(unassigned).toEqual([]);

      // Sanity: both rows are genuinely there, unfiltered.
      const all = await listConversations(db, accountId, {});
      expect(all.map((r) => r.id).sort()).toEqual([mineConvo!.id, otherConvo!.id].sort());
    }));

  it("listAccountWork: mine goes by the TASK's own assignee, even on someone else's customer; unassigned is a task with no assignee plus Unassigned customers' rows", () =>
    withAssigneeAccount(async (db, accountId) => {
      const a = await person(db, "d");
      const b = await person(db, "e");
      const mineCustomer = await rawContact(db, accountId, "Mine Customer", a);
      const otherCustomer = await rawContact(db, accountId, "Other Customer", b);
      const noneCustomer = await rawContact(db, accountId, "Open Customer", null);

      // Mine: the task is A's, even though the customer it's against is B's.
      const { data: taskMine, error: tErr } = await db.from("tasks")
        .insert({ account_id: accountId, contact_id: otherCustomer.id, title: "call B's customer", assigned_to: a })
        .select("id").single();
      if (tErr) throw tErr;
      // Unassigned: no assignee, and deliberately no customer either (so it
      // cannot suppress any contact's own conversation/booking row below).
      const { data: taskNone, error: tErr2 } = await db.from("tasks")
        .insert({ account_id: accountId, title: "loose", assigned_to: null })
        .select("id").single();
      if (tErr2) throw tErr2;
      // Neither filter's business.
      const { error: tErr3 } = await db.from("tasks")
        .insert({ account_id: accountId, title: "B's own", assigned_to: b });
      if (tErr3) throw tErr3;

      const convo = async (contactId: string): Promise<string> => {
        const { data, error } = await db.from("conversations")
          .insert({ account_id: accountId, contact_id: contactId, unread_count: 1 }).select("id").single();
        if (error) throw error;
        return data!.id as string;
      };
      const mineConvoId = await convo(mineCustomer.id);
      const noneConvoId = await convo(noneCustomer.id);
      await convo(otherCustomer.id); // neither filter's business

      const { data: calendar, error: calErr } = await db.from("calendars")
        .insert({ account_id: accountId, public_id: `cal_af_${RUN}` }).select("id").single();
      if (calErr) throw calErr;
      const past = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
      const booking = async (contactId: string, hoursAgo: number): Promise<string> => {
        const { data, error } = await db.from("bookings").insert({
          account_id: accountId, calendar_id: calendar!.id, contact_id: contactId,
          starts_at: past(hoursAgo + 1), ends_at: past(hoursAgo), cancel_token: `tok_af_${RUN}_${hoursAgo}`,
          author_kind: "person",
        }).select("id").single();
        if (error) throw error;
        return data!.id as string;
      };
      const mineBookingId = await booking(mineCustomer.id, 2);
      const noneBookingId = await booking(noneCustomer.id, 4);
      await booking(otherCustomer.id, 6); // neither filter's business

      const mine = await listAccountWork(db, accountId, { assignee: { who: "mine", userId: a } });
      expect(mine.map((r) => r.id).sort()).toEqual(
        [`task:${taskMine!.id}`, `conversation:${mineConvoId}`, `booking:${mineBookingId}`].sort(),
      );

      const unassigned = await listAccountWork(db, accountId, { assignee: { who: "unassigned" } });
      expect(unassigned.map((r) => r.id).sort()).toEqual(
        [`task:${taskNone!.id}`, `conversation:${noneConvoId}`, `booking:${noneBookingId}`].sort(),
      );
    }));

  it("createContact stores assigned_to when given", () =>
    withAssigneeAccount(async (db, accountId) => {
      const a = await person(db, "f");
      const created = await createContact(db, accountId, { firstName: "W", assignedTo: a }, "user_test");
      const { data, error } = await db.from("contacts").select("assigned_to").eq("id", created.id).single();
      if (error) throw error;
      expect(data!.assigned_to).toBe(a);
    }));

  it("updateContact cannot set assigned_to — only createContact may (A5/A4 safety: a reassignment must go through assignContacts, never a plain field edit) (mutation: let toRow write assigned_to again -> FAILS)", () =>
    withAssigneeAccount(async (db, accountId) => {
      const a = await person(db, "i");
      const created = await createContact(db, accountId, { firstName: "Safe" }, "user_test");
      expect(created.existing).toBe(false);
      // `assignedTo` is not a key of ContactInput any more (CreateContactInput
      // only), so a real caller cannot even write this; `as any` stands in
      // for a caller that tries anyway (or a future regression that widens
      // ContactInput back), proving the RUNTIME behaviour independent of the
      // type-level guard tsc already gives every other caller.
      await updateContact(db, accountId, created.id, { firstName: "Safe2", assignedTo: a } as any, "user_test");
      const { data, error } = await db.from("contacts")
        .select("assigned_to, first_name").eq("id", created.id).single();
      if (error) throw error;
      // The legitimate part of the same call still lands...
      expect(data!.first_name).toBe("Safe2");
      // ...but assigned_to is untouched: still Unassigned, never A.
      expect(data!.assigned_to).toBeNull();
    }));

  it("flagMatchesOf: a shared phone writes one hidden_match pair; a second call is the designed no-op and returns 0", () =>
    withAssigneeAccount(async (db, accountId) => {
      const { data: c1, error: e1 } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "One", phone: "+19565550133" }).select("id").single();
      if (e1) throw e1;
      const { data: c2, error: e2 } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Two", phone: "+19565550133" }).select("id").single();
      if (e2) throw e2;

      expect(await flagMatchesOf(db, accountId, c2!.id)).toBe(1);
      const { data: flags, error: fErr } = await db.from("contact_duplicate_flags")
        .select("contact_a, contact_b, reason").eq("account_id", accountId);
      if (fErr) throw fErr;
      expect(flags).toHaveLength(1);
      expect(flags![0]!.reason).toBe("hidden_match");
      expect([flags![0]!.contact_a, flags![0]!.contact_b].sort()).toEqual([c1!.id, c2!.id].sort());

      expect(await flagMatchesOf(db, accountId, c2!.id)).toBe(0);
      const { data: again, error: aErr } = await db.from("contact_duplicate_flags")
        .select("id").eq("account_id", accountId);
      if (aErr) throw aErr;
      expect(again).toHaveLength(1);
    }));

  it("addTask stores assignedTo", () =>
    withAssigneeAccount(async (db, accountId) => {
      const a = await person(db, "g");
      const { id: taskId } = await addTask(db, accountId, { title: "follow up", assignedTo: a }, "user_test");
      const { data, error } = await db.from("tasks").select("assigned_to").eq("id", taskId).single();
      if (error) throw error;
      expect(data!.assigned_to).toBe(a);
    }));
});

/**
 * A tiny stand-in for the real client, scripted to answer `flagMatchesOf`'s
 * exact call sequence: `contacts` is read twice (the subject's own keys,
 * then the candidate matches), `contact_duplicate_flags` is written once
 * per candidate. No network, no bis-ci — this is a pure unit test of the
 * throw/no-op branch, which does not need a live row to prove.
 */
function fakeFlagMatchesOfDb(opts: {
  me: { data: unknown; error: unknown };
  hits: { data: unknown; error: unknown };
  insert: { error: { code: string; message: string } | null };
}): SupabaseClient {
  let contactsCalls = 0;
  const chain = (result: unknown, terminal: "maybeSingle" | "limit") => {
    const c: any = {
      select: () => c, eq: () => c, neq: () => c, or: () => c,
      [terminal]: () => Promise.resolve(result),
    };
    return c;
  };
  return {
    from(table: string) {
      if (table === "contacts") {
        contactsCalls += 1;
        return contactsCalls === 1 ? chain(opts.me, "maybeSingle") : chain(opts.hits, "limit");
      }
      if (table === "contact_duplicate_flags") {
        return { insert: () => Promise.resolve(opts.insert) };
      }
      throw new Error(`fakeFlagMatchesOfDb: unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("flagMatchesOf: a write failure that is not the designed 23505 no-op is never swallowed (sibling to createContact's own email_phone_conflict insert)", () => {
  it("throws, naming the failure, rather than logging and returning as if nothing happened (mutation: swallow it like flagDuplicatePair does -> resolves 0 instead of throwing, FAILS)", async () => {
    const db = fakeFlagMatchesOfDb({
      me: { data: { email_key: null, phone_key: "5551234567" }, error: null },
      hits: { data: [{ id: "11111111-1111-1111-1111-111111111111" }], error: null },
      insert: { error: { code: "23503", message: "boom" } },
    });
    await expect(
      flagMatchesOf(db, "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"),
    ).rejects.toThrow(/flagMatchesOf insert failed/);
  });

  it("still returns 0 and writes nothing on the designed 23505 repeat (unchanged behaviour)", async () => {
    const db = fakeFlagMatchesOfDb({
      me: { data: { email_key: null, phone_key: "5551234567" }, error: null },
      hits: { data: [{ id: "11111111-1111-1111-1111-111111111111" }], error: null },
      insert: { error: { code: "23505", message: "duplicate key" } },
    });
    await expect(
      flagMatchesOf(db, "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"),
    ).resolves.toBe(0);
  });
});
