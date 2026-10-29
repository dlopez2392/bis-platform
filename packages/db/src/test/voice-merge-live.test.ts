import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { listContactsOnNumber } from "../voice";

/**
 * Task 6 (F-006, migration 0106), live half: `listContactsOnNumber` against a REAL tombstone (the actual
 * generated `merged_into` column), proving `voice-merge.test.ts`'s fake-client cases hold against the real
 * database too — and the second-account rule the plan's "Shared facts" table names for this read. CI only
 * (0106 is not on bis-ci yet): proven by CI `verify`, never run locally against any Supabase project
 * (worktree rule).
 *
 * `withTestAccount`'s own `db` IS `serviceDb()` (fixtures.ts), so `makeTombstone` below — a direct
 * `merged_into`/`merged_at` write — is exactly the write T3's `merge_contacts` will eventually make
 * (`contact-merge-lookups-live.test.ts`'s own comment explains why this is not a shortcut).
 */
async function makeTombstone(db: SupabaseClient, accountId: string, tombstoneId: string, keepId: string) {
  const { error } = await db.from("contacts")
    .update({ merged_into: keepId, merged_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", tombstoneId);
  if (error) throw new Error(`makeTombstone failed: ${error.message}`);
}

describe("listContactsOnNumber follows a real tombstone (0106, owner ruling D8)", () => {
  it("K's own live row and T's tombstone on the SAME number answer ONE row, K's own (mutation: no de-duplication -> two rows)", () =>
    withTestAccount(async (db, accountId) => {
      const kept = await createContact(db, accountId, { firstName: "Kept", phone: "+19565550511" }, "user_test");
      const tomb = await createContact(db, accountId, { firstName: "Tomb", phone: "+19565550511" }, "user_test");
      await makeTombstone(db, accountId, tomb.id, kept.id);

      const { rows } = await listContactsOnNumber(db, accountId, "+19565550511");
      expect(rows.map((r) => r.id)).toEqual([kept.id]);
    }));

  it("T alone on a number resolves to K, carrying the TOMBSTONE's own phone, not K's (mutation: carry K's own phone -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const kept = await createContact(db, accountId, { firstName: "Kept", lastName: "Person", phone: "+19565550513" }, "user_test");
      const tomb = await createContact(db, accountId, { firstName: "Tomb", phone: "+19565550512" }, "user_test");
      await makeTombstone(db, accountId, tomb.id, kept.id);

      const { rows } = await listContactsOnNumber(db, accountId, "+19565550512");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: kept.id, first_name: "Kept", last_name: "Person", phone: "+19565550512" });
    }));

  it("account B's contact on the same number never appears in A's answer (mutation: drop .eq(\"account_id\", …) from the kept-person read -> FAILS)", () =>
    withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const keptA = await createContact(dbA, accountA, { firstName: "KeptA", phone: "+19565550514" }, "user_test");
        const tombA = await createContact(dbA, accountA, { firstName: "TombA", phone: "+19565550514" }, "user_test");
        await makeTombstone(dbA, accountA, tombA.id, keptA.id);
        await createContact(dbB, accountB, { firstName: "InB", phone: "+19565550514" }, "user_test");

        const { rows } = await listContactsOnNumber(dbA, accountA, "+19565550514");
        expect(rows.map((r) => r.id)).toEqual([keptA.id]);
      });
    }));
});
