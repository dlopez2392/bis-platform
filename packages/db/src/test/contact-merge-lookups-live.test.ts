import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact, listContacts, countContacts } from "../contacts";
import { buildMatchIndex, applyImportBatch } from "../contact-import";

/**
 * Task 4 (F-006), live half: `listContacts`/`countContacts`, `createContact`'s dedupe and the import's
 * match index all behave the same against a REAL tombstone as `contacts-merge-resolve.test.ts` proves
 * against a mock — against the actual generated `merged_into` column, the FK it carries into its own
 * account, and the service role's standing exemption from the 0106 "a signed-in session cannot touch a
 * tombstone" guard. CI only (0106 is not on bis-ci yet): this file is proven by CI `verify`, never run
 * locally against any Supabase project (worktree rule).
 *
 * `withTestAccount`'s own `db` IS `serviceDb()` (fixtures.ts:140-141), so `makeTombstone` below — a direct
 * `merged_into`/`merged_at` write — is exactly the write T3's `merge_contacts` will eventually make, not a
 * shortcut this test invents: 0106 section 3 (`app.contacts_tombstone_server_only`) refuses that same write
 * from a signed-in ("authenticated") session and lets it through for every other role, service_role included.
 */
async function makeTombstone(
  db: SupabaseClient, accountId: string, tombstoneId: string, keepId: string,
) {
  const { error } = await db.from("contacts")
    .update({ merged_into: keepId, merged_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", tombstoneId);
  if (error) throw new Error(`makeTombstone failed: ${error.message}`);
}

describe("createContact's dedupe follows a real tombstone to the record it points at (owner ruling D8)", () => {
  it("a new contact with the tombstone's own email answers the kept record, existing (mutation: resolve dropped -> answers the tombstone, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const kept = await createContact(db, accountId, { firstName: "Kept", email: "kept-email@example.com" }, "user_test");
      const tomb = await createContact(db, accountId, { firstName: "Tomb", email: "tomb-email@example.com" }, "user_test");
      await makeTombstone(db, accountId, tomb.id, kept.id);

      const again = await createContact(db, accountId, { firstName: "Again", email: "tomb-email@example.com" }, "user_test");
      expect(again).toEqual({ id: kept.id, existing: true, flagged: false });
    }));

  it("a new contact with the tombstone's own phone answers the kept record too (mutation: resolve dropped -> answers the tombstone, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const kept = await createContact(db, accountId, { firstName: "Kept", phone: "+19565550401" }, "user_test");
      const tomb = await createContact(db, accountId, { firstName: "Tomb", phone: "+19565550402" }, "user_test");
      await makeTombstone(db, accountId, tomb.id, kept.id);

      const again = await createContact(db, accountId, { firstName: "Again", phone: "+19565550402" }, "user_test");
      expect(again).toEqual({ id: kept.id, existing: true, flagged: false });
    }));

  it("a SECOND account's contact holding the tombstone's own email is never confused with A's tombstone: A still resolves to A's kept record (mutation: drop the account_id filter from findDuplicate's email read -> B's contact answers instead, FAILS)", () =>
    withTestAccount(async (db, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const kept = await createContact(db, accountA, { firstName: "Kept" }, "user_test");
        const tomb = await createContact(db, accountA, { firstName: "Tomb", email: "shared-tomb@example.com" }, "user_test");
        await makeTombstone(db, accountA, tomb.id, kept.id);
        // Account B's contact shares the TOMBSTONE's own email — the tombstone keeps it (owner ruling D8) —
        // so a filter scoped wrong (across accounts) would hand A's answer to B's row.
        const inB = await createContact(dbB, accountB, { firstName: "InB", email: "shared-tomb@example.com" }, "user_test");

        const again = await createContact(db, accountA, { firstName: "Again", email: "shared-tomb@example.com" }, "user_test");
        expect(again).toEqual({ id: kept.id, existing: true, flagged: false });
        expect(again.id).not.toBe(inB.id);
      });
    }));
});

describe("applyImportBatch's match index follows a real tombstone too", () => {
  it("a re-imported row matching the tombstone's own email updates the record it points at, never the hidden pointer (mutation: map to the tombstone -> the KEPT row is never updated, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const kept = await createContact(db, accountId, { firstName: "Kept", email: "import-email@example.com" }, "user_test");
      const tomb = await createContact(db, accountId, { firstName: "Tomb", email: "tomb-import@example.com" }, "user_test");
      await makeTombstone(db, accountId, tomb.id, kept.id);

      const index = await buildMatchIndex(db, accountId);
      expect(index.byEmail.get("tomb-import@example.com")).toBe(kept.id);

      const r = await applyImportBatch(db, accountId,
        [{ input: { email: "tomb-import@example.com", lastName: "Updated" }, tags: [] }],
        index, "user_test", { createTags: false });
      expect(r).toEqual({ created: 0, updated: 1, flagged: 0 });
      const { data } = await db.from("contacts").select("last_name").eq("account_id", accountId).eq("id", kept.id).single();
      expect(data?.last_name).toBe("Updated");
    }));

  it("a SECOND account's match index maps the same email to ITS OWN contact, never across to A's kept record (mutation: drop the account_id filter from buildMatchIndex's read -> B's index maps to A's kept id, FAILS)", () =>
    withTestAccount(async (db, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const kept = await createContact(db, accountA, { firstName: "Kept" }, "user_test");
        const tomb = await createContact(db, accountA, { firstName: "Tomb", email: "shared-import@example.com" }, "user_test");
        await makeTombstone(db, accountA, tomb.id, kept.id);
        const inB = await createContact(dbB, accountB, { firstName: "InB", email: "shared-import@example.com" }, "user_test");

        const indexA = await buildMatchIndex(db, accountA);
        expect(indexA.byEmail.get("shared-import@example.com")).toBe(kept.id);

        const indexB = await buildMatchIndex(dbB, accountB);
        expect(indexB.byEmail.get("shared-import@example.com")).toBe(inB.id);
      });
    }));
});

describe("listContacts and countContacts leave a real tombstone out, cross-tenant rows unaffected (second-account rule)", () => {
  it("the tombstone is gone from this account's list and total; an identical contact on a SECOND account is untouched (mutation: drop `.is(\"merged_into\", null)` from withArchived -> the tombstone reappears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (dbB, accountB) => {
        const kept = await createContact(db, accountId, { firstName: "Kept" }, "user_test");
        const tomb = await createContact(db, accountId, { firstName: "Tomb" }, "user_test");
        await makeTombstone(db, accountId, tomb.id, kept.id);
        // Account B's contact shares the tombstone's own name, so a filter scoped wrong (by name, not by
        // account+id) would leave B's row out too — it must not.
        const inB = await createContact(dbB, accountB, { firstName: "Tomb" }, "user_test");

        const rowsA = await listContacts(db, accountId);
        expect(rowsA!.map((r: { id: string }) => r.id).sort()).toEqual([kept.id].sort());
        expect(await countContacts(db, accountId)).toBe(1);

        const rowsB = await listContacts(dbB, accountB);
        expect(rowsB!.map((r: { id: string }) => r.id)).toEqual([inB.id]);
        expect(await countContacts(dbB, accountB)).toBe(1);
      });
    }));

  it("the Archived view leaves a tombstone out too — a merged-away record is never shown as archived either (mutation: drop the filter from the \"only\" branch -> the tombstone reappears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const kept = await createContact(db, accountId, { firstName: "Kept" }, "user_test");
      const tomb = await createContact(db, accountId, { firstName: "Tomb" }, "user_test");
      await makeTombstone(db, accountId, tomb.id, kept.id);

      const rows = await listContacts(db, accountId, { archived: "only" });
      expect(rows).toEqual([]);
      expect(await countContacts(db, accountId, { archived: "only" })).toBe(0);
    }));
});
