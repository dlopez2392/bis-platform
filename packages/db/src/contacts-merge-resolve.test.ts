import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listContacts, countContacts, createContact, updateContact, setContactPhoneCountry,
  flagMatchesOf, fillContactBlanksReport, DELETE_BLOCK_REASONS,
} from "./contacts";
import { buildMatchIndex } from "./contact-import";

/**
 * Task 4 (F-006): a merged-away record (0106's `contacts.merged_into`) leaves every list, and every
 * lookup by phone, email or contact id lands on the kept record. Pure; the live behaviour (the trigger
 * actually filing a tombstone, the second-account rule) is CI-only (test/contact-merge-lookups-live.test.ts).
 *
 * `recordingDb` starts from `contacts-archive.test.ts`'s own (every call recorded, resolved on `then`) but
 * answers PER SEQUENTIAL `.from(table)` CALL rather than one fixed value per table: `findDuplicate`,
 * `fillContactBlanksReport` and `setContactPhoneCountry` each run more than one distinct query against
 * "contacts" within a single call, and this task's own cases need those queries to answer differently
 * (a tombstone on the first read, the kept row on the second) — something archive's tests never needed,
 * since none of its own functions run two different shapes of query against the same table in one call.
 * Each call is also tagged with its own `.from()` invocation number, so a test can assert "the UPDATE call
 * itself carried this filter" rather than merely "this filter was issued somewhere in the whole run".
 */
type Answer = { data: unknown; error: unknown };
function recordingDb(responses: Record<string, Answer[]> = {}) {
  const calls: { table: string; method: string; args: unknown[]; call: number }[] = [];
  const nextIndex: Record<string, number> = {};
  let callCounter = 0;
  const db = {
    from: (table: string) => {
      const call = callCounter++;
      const idx = nextIndex[table] ?? 0;
      nextIndex[table] = idx + 1;
      const list = responses[table] ?? [];
      const answer: Answer = list[idx] ?? list[list.length - 1] ?? { data: [], error: null };
      const chain: unknown = new Proxy({}, {
        get(_t, method: string) {
          if (method === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(answer).then(res, rej);
          }
          return (...args: unknown[]) => { calls.push({ table, method, args, call }); return chain; };
        },
      });
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
  return { db, calls };
}
const has = (calls: { method: string; args: unknown[] }[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));
const hasInCall = (
  calls: { method: string; args: unknown[]; call: number }[], call: number, method: string, ...args: unknown[]
) => calls.some((c) => c.call === call && c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

describe("the tombstone filter, one rule for every list and its total (0106)", () => {
  it("listContacts leaves a merged-away record out, excluded or archived-only alike (mutation: drop `.is(\"merged_into\", null)` from one branch of withArchived -> that branch's case FAILS)", async () => {
    const exclude = recordingDb();
    await listContacts(exclude.db, "A");
    expect(has(exclude.calls, "is", "merged_into", null)).toBe(true);

    const only = recordingDb();
    await listContacts(only.db, "A", { archived: "only" });
    expect(has(only.calls, "is", "merged_into", null)).toBe(true);
  });

  it("countContacts does too, so the header total never counts a tombstone (mutation: drop it from countContacts only -> FAILS)", async () => {
    const exclude = recordingDb();
    await countContacts(exclude.db, "A");
    expect(has(exclude.calls, "is", "merged_into", null)).toBe(true);

    const only = recordingDb();
    await countContacts(only.db, "A", { archived: "only" });
    expect(has(only.calls, "is", "merged_into", null)).toBe(true);
  });
});

describe("findDuplicate through createContact: a hit on a merged-away record answers the kept record (owner ruling D8)", () => {
  it("an email match on a tombstone resolves to the record it points at (mutation: drop the resolve in findDuplicate -> answers the tombstone's own id instead)", async () => {
    const { db } = recordingDb({
      contacts: [{ data: [{ id: "T", merged_into: "K" }], error: null }],
    });
    const result = await createContact(db, "A", { email: "held@example.com" }, "user_test");
    expect(result).toEqual({ id: "K", existing: true, flagged: false });
  });

  it("a direct phone match on a tombstone resolves to the record it points at too (mutation: drop the resolve on the phone branch -> answers the tombstone's own id instead)", async () => {
    const { db } = recordingDb({
      contacts: [{ data: [{ id: "T", merged_into: "K" }], error: null }],
    });
    const result = await createContact(db, "A", { phone: "+19565550199" }, "user_test");
    expect(result).toEqual({ id: "K", existing: true, flagged: false });
  });

  it("an email match on a tombstone (-> K) and a phone match directly on K is not a conflict: no email_phone_conflict insert (mutation: compare the raw ids BEFORE resolving -> the insert is recorded)", async () => {
    const { db, calls } = recordingDb({
      // findDuplicate's email branch runs first, then its direct phone branch — exactly the order the
      // source reads them in, so these two answers line up with that order, not with the test's own prose.
      contacts: [
        { data: [{ id: "T", merged_into: "K" }], error: null },
        { data: [{ id: "K", merged_into: null }], error: null },
      ],
    });
    const result = await createContact(db, "A", { email: "held@example.com", phone: "+19565550199" }, "user_test");
    expect(result).toEqual({ id: "K", existing: true, flagged: false });
    expect(calls.some((c) => c.table === "contact_duplicate_flags" && c.method === "insert")).toBe(false);
  });
});

describe("flagDuplicatesAfterWrite (through updateContact), setContactPhoneCountry's twin read and flagMatchesOf's candidate read all skip a merged-away record too", () => {
  it("updateContact's post-write email check excludes a tombstone (mutation: drop `.is(\"merged_into\", null)` from flagDuplicatesAfterWrite's email read -> FAILS)", async () => {
    // No phone in this input, so updateContact's own current-phone read never runs: the update itself is
    // the first "contacts" call, flagDuplicatesAfterWrite's email-twin read the second.
    const { db, calls } = recordingDb({
      contacts: [
        { data: [], error: null },   // the update itself
        { data: [], error: null },   // flagDuplicatesAfterWrite's email-twin read
      ],
    });
    await updateContact(db, "A", "c1", { email: "a@example.com" }, "user_test");
    expect(has(calls, "is", "merged_into", null)).toBe(true);
  });

  it("updateContact's post-write phone check excludes a tombstone too (mutation: drop it from the phone branch -> FAILS)", async () => {
    const { db, calls } = recordingDb({
      contacts: [
        { data: { phone: "+19565550100" }, error: null },  // current-phone read
        { data: [], error: null },                           // the update
        { data: [], error: null },                           // flagDuplicatesAfterWrite's phone-twin read
      ],
    });
    await updateContact(db, "A", "c1", { phone: "+19565550111" }, "user_test");
    expect(has(calls, "is", "merged_into", null)).toBe(true);
  });

  it("setContactPhoneCountry's own twin read excludes a tombstone (mutation: drop it from that read -> FAILS)", async () => {
    const { db, calls } = recordingDb({
      contacts: [
        { data: [{ id: "c1" }], error: null },   // the update's own .select("id") — truthy length, so the pick is reported as "updated"
        { data: [], error: null },                // the twin read
      ],
    });
    const outcome = await setContactPhoneCountry(
      db, "A", "c1", { expectedPhone: "+15550000000", phone: "+525550000000", unconfirmed: false }, "user_test",
    );
    expect(outcome).toBe("updated");
    expect(has(calls, "is", "merged_into", null)).toBe(true);
  });

  it("flagMatchesOf's candidate read excludes a tombstone (mutation: drop it from that read -> FAILS)", async () => {
    const { db, calls } = recordingDb({
      contacts: [
        { data: { email_key: null, phone_key: "9565550123" }, error: null },  // the subject's own keys
        { data: [], error: null },                                             // the candidate read
      ],
    });
    expect(await flagMatchesOf(db, "A", "c2")).toBe(0);
    expect(has(calls, "is", "merged_into", null)).toBe(true);
  });
});

describe("fillContactBlanksReport on a merged-away record fills the record it points at (owner ruling D8)", () => {
  it("a fill aimed at a tombstone lands on the kept record, not the tombstone (mutation: write the tombstone's own id -> FAILS)", async () => {
    const { db, calls } = recordingDb({
      contacts: [
        { data: { id: "T", merged_into: "K", first_name: null, last_name: null, email: null, phone: null }, error: null },
        { data: { id: "K", merged_into: null, first_name: "Kept", last_name: "Person", email: null, phone: null }, error: null },
        { data: [], error: null },   // the update itself, now aimed at K
      ],
    });
    const result = await fillContactBlanksReport(db, "A", "T", { email: "new@example.com" }, "user_test");
    expect(result.fields).toEqual(["email"]);

    const updateCall = calls.find((c) => c.method === "update")?.call;
    expect(updateCall, "an update call must have happened").not.toBeUndefined();
    expect(hasInCall(calls, updateCall!, "eq", "id", "K")).toBe(true);
    expect(hasInCall(calls, updateCall!, "eq", "id", "T")).toBe(false);
  });
});

describe("buildMatchIndex maps a merged-away record's email and phone to the record it points at", () => {
  it("both keys map to K, not T (mutation: map to the tombstone's own id -> FAILS)", async () => {
    const { db } = recordingDb({
      contacts: [{ data: [{ id: "T", email: "a@x.mx", phone: "+19565550401", holds_shared_number: false, merged_into: "K" }], error: null }],
    });
    const index = await buildMatchIndex(db, "A");
    expect(index.byEmail.get("a@x.mx")).toBe("K");
    expect(index.byPhone.get("9565550401")).toBe("K");
  });
});

describe("DELETE_BLOCK_REASONS", () => {
  it("includes \"merges\": a contact with a live merge cannot be deleted for good", () => {
    expect(DELETE_BLOCK_REASONS).toContain("merges");
  });
});
