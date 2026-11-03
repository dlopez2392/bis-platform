import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addTagToContact } from "./contacts";

/**
 * F-115 (migration 0112, plan Task 3 Step 7): `addTagToContact` is the representative test for the
 * "tags" writer family (also: removeTagFromContact, addTagToContacts, removeTagFromContacts). The
 * `contact_tag` Q1 type audits nothing (a tag is added or removed, never edited), so only the
 * `contact_tags` write itself — never the `tags` vocabulary upsert, not a Q1 table — carries the
 * author. Pure: the live round trip is `test/contacts.test.ts`. Pattern follows
 * `contacts-archive.test.ts`'s `recordingDb`.
 */
function recordingDb(answers: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const headers: { table: string; name: string; value: string }[] = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(answers[table] ?? { data: [], error: null }).then(res, rej);
        }
        if (method === "setHeader") {
          return (name: string, value: string) => { headers.push({ table, name, value }); return chain; };
        }
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const db = { from: (table: string) => chainFor(table) } as unknown as SupabaseClient;
  return { db, calls, headers };
}

const AUTHOR = { authorKind: "person", authorId: "user_owner" } as const;

describe("addTagToContact", () => {
  it("the contact_tags upsert carries the author on x-bis-author, never the tags upsert (F-115; mutation: drop withAuthor from the contact_tags upsert -> FAILS)", async () => {
    const { db, headers } = recordingDb({
      tags: { data: { id: "tag-1" }, error: null },
      contact_tags: { data: null, error: null },
    });
    await addTagToContact(db, "acct-1", "contact-1", "VIP", AUTHOR);
    expect(headers).toEqual([
      { table: "contact_tags", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a missing author is refused before any query (F-115; mutation: drop requireAuthor -> the upsert runs unattributed, FAILS)", async () => {
    const { db, calls } = recordingDb();
    await expect(addTagToContact(db, "acct-1", "contact-1", "VIP", undefined as never))
      .rejects.toThrow("addTagToContact: a server write must say who made it");
    expect(calls).toEqual([]);
  });
});
