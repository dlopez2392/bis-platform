import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { archiveContacts } from "../contacts";
import {
  listDuplicatePairs, countDuplicatePairs, dismissDuplicatePair, undismissDuplicatePair,
  mergeContacts, undoContactMerge, contactMergePreview, followMerge, mergedIdsOf,
} from "../contact-merge";

/**
 * Task 5 (F-006), live half: `contact-merge.ts`'s wrappers against the REAL 0106 RPCs, end to end — on
 * the CI project only (0106 is not on bis-ci yet, so this file is proven by CI `verify`, which builds its
 * own stack from the branch's migrations, never run locally against any Supabase project). The pure half
 * (a fake client, every mutation named in the plan) is `../contact-merge.test.ts`.
 *
 * Inserted directly (not through `createContact`), as `contact-dedupe-schema.test.ts`'s own `person`
 * helper does: `createContact` resolves an identical phone to the EXISTING contact rather than creating a
 * second row (its own dedupe, one layer up from 0106's), so two rows that are "the same person" by phone
 * can only be produced by writing the phone column directly.
 */
async function person(
  db: SupabaseClient, accountId: string, p: { first: string; last: string; phone: string },
): Promise<string> {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: p.first, last_name: p.last, phone: p.phone, author_kind: "person" })
    .select("id").single();
  if (error) throw new Error(`person insert failed: ${error.message}`);
  return (data as { id: string }).id;
}

describe("contact-merge.ts's wrappers end to end (CI only: withTestAccount + serviceDb)", () => {
  it("lists, counts, dismisses, undismisses, refuses a stale merge, merges, follows the pointer, and undoes it — a second account's identical pair never appears under the first (second-account rule)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const a1 = await person(db, accountId, { first: "Ana", last: "Ruiz", phone: "+19565550401" });
        const a2 = await person(db, accountId, { first: "Anna", last: "Ruiz", phone: "+19565550401" });
        const b1 = await person(dbB, accountB, { first: "Bea", last: "Soto", phone: "+19565550402" });
        const b2 = await person(dbB, accountB, { first: "Beah", last: "Soto", phone: "+19565550402" });

        // listDuplicatePairs and countDuplicatePairs agree, and each account sees only its own pair.
        const pairsA = await listDuplicatePairs(db, accountId);
        expect(pairsA).toHaveLength(1);
        expect([pairsA[0]!.a.id, pairsA[0]!.b.id].sort()).toEqual([a1, a2].sort());
        expect(await countDuplicatePairs(db, accountId)).toBe(1);

        const pairsB = await listDuplicatePairs(dbB, accountB);
        expect(pairsB).toHaveLength(1);
        expect([pairsB[0]!.a.id, pairsB[0]!.b.id].sort()).toEqual([b1, b2].sort());
        expect(pairsB[0]!.id).not.toBe(pairsA[0]!.id);

        // Dismiss, then its own Undo.
        const flagId = pairsA[0]!.id;
        expect(await dismissDuplicatePair(db, accountId, flagId, "user_test")).toBe("dismissed");
        expect(await listDuplicatePairs(db, accountId)).toEqual([]);
        expect(await countDuplicatePairs(db, accountId)).toBe(0);
        expect(await undismissDuplicatePair(db, accountId, flagId, "user_test")).toBe("restored");
        expect(await listDuplicatePairs(db, accountId)).toHaveLength(1);

        // A preview's `seen`, taken BEFORE a write to a merge field (archiveContacts sets archived_at,
        // never updated_at — plan review m3's lesson, that `stale` must compare a fingerprint of the
        // merge's own fields, not updated_at), is refused once that field has moved under it.
        const stalePreview = await contactMergePreview(db, accountId, a1, a2);
        if (stalePreview.status !== "ok") throw new Error(`expected ok, got ${stalePreview.status}`);
        await archiveContacts(db, accountId, [a1]);
        const staleOutcome = await mergeContacts(db, accountId, {
          keepId: a1, otherId: a2, choices: {}, seen: stalePreview.seen, actor: "user_test",
        });
        expect(staleOutcome).toEqual({ status: "stale" });

        // A fresh preview's seen merges cleanly.
        const freshPreview = await contactMergePreview(db, accountId, a1, a2);
        if (freshPreview.status !== "ok") throw new Error(`expected ok, got ${freshPreview.status}`);
        const outcome = await mergeContacts(db, accountId, {
          keepId: a1, otherId: a2, choices: {}, seen: freshPreview.seen, actor: "user_test",
        });
        if (outcome.status !== "merged") throw new Error(`expected merged, got ${outcome.status}`);

        // Every lookup by id follows the pointer.
        expect(await followMerge(db, accountId, a2)).toBe(a1);
        expect(await followMerge(db, accountId, a1)).toBe(a1);
        expect(await mergedIdsOf(db, accountId, a1)).toEqual([a2]);

        // Undo, within the window, puts the pointer back.
        const undone = await undoContactMerge(db, accountId, outcome.mergeId, "user_test");
        expect(undone).toMatchObject({ status: "undone", otherId: a2 });
        expect(await followMerge(db, accountId, a2)).toBe(a2);
        expect(await mergedIdsOf(db, accountId, a1)).toEqual([]);

        // A second Undo of the same merge is refused, not silently re-applied.
        expect(await undoContactMerge(db, accountId, outcome.mergeId, "user_test")).toEqual({ status: "already_undone" });
      }),
    ));

  it("mergeContacts refuses the same contact twice (status \"same\") and an unknown contact (\"not_found\")", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, { first: "Solo", last: "Person", phone: "+19565550403" });
      const same = await mergeContacts(db, accountId, {
        keepId: a, otherId: a, choices: {}, seen: { keep: "0".repeat(32), other: "0".repeat(32) }, actor: "user_test",
      });
      expect(same).toEqual({ status: "same" });

      const notFound = await mergeContacts(db, accountId, {
        keepId: a, otherId: "00000000-0000-0000-0000-000000000000", choices: {},
        seen: { keep: "0".repeat(32), other: "0".repeat(32) }, actor: "user_test",
      });
      expect(notFound).toEqual({ status: "not_found" });
    }));

  it("undoContactMerge refuses an unknown merge id (\"not_found\")", () =>
    withTestAccount(async (db, accountId) => {
      expect(await undoContactMerge(db, accountId, 999999999, "user_test")).toEqual({ status: "not_found" });
    }));

  it("contactMergePreview answers \"not_found\" for an unknown contact", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, { first: "Solo", last: "Person", phone: "+19565550404" });
      expect(await contactMergePreview(db, accountId, a, "00000000-0000-0000-0000-000000000000"))
        .toEqual({ status: "not_found" });
    }));
});
