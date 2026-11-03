import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { addPlace, addEquipment, removeEquipment } from "../places";
import { putBackChange, restoreRemoved } from "../record-restore";

/**
 * F-115 Task 6 (plan Task 6, Step 2): `putBackChange` and `restoreRemoved` end-to-end through Kong,
 * PostgREST and supabase-js (A1, A2) — the two things `record-restore-schema.test.ts` cannot prove on
 * a bare replica, because it has no PostgREST layer in front of it. CI's local stack only
 * (`withTestAccount`; `db` is `serviceDb()`). RED BEFORE APPLY, legitimately: `record_changes` does
 * not exist, and neither does `record-restore.ts`.
 */
describe("putBackChange and restoreRemoved through the API", () => {
  it("puts back a contact field, writing a NEW change row with via restore:<id> (mutation: drop putBackChange's CAS guard -> a stale value would still land, so the second put-back below would not answer 'changed')", () =>
    withTestAccount(async (db, accountId) => {
      const author = { authorKind: "person" as const, authorId: "user_rr_live_1" };
      const c = await createContact(db, accountId,
        { firstName: "Rr", phone: "+19565550112", author: { authorKind: "automation", authorId: null } },
        "user_test", "system");
      await db.from("contacts").update({ first_name: "Changed" }).eq("id", c.id).eq("account_id", accountId)
        .setHeader("x-bis-author", JSON.stringify({ kind: "person", id: "user_rr_live_1" }));
      const { data: rows, error } = await db.from("record_changes").select("id")
        .eq("account_id", accountId).eq("record_id", c.id).eq("op", "update").eq("field", "first_name")
        .order("id", { ascending: false }).limit(1);
      expect(error).toBeNull();
      const changeId = (rows ?? [])[0]?.id as number;
      expect(changeId).toBeTruthy();

      const outcome = await putBackChange(db, accountId, changeId, author);
      expect(outcome).toBe("put_back");
      const { data: contactRow } = await db.from("contacts").select("first_name").eq("id", c.id).single();
      expect(contactRow?.first_name).toBe("Rr");
      const { data: newRows } = await db.from("record_changes").select("via, author_kind, author_id")
        .eq("account_id", accountId).eq("record_id", c.id).eq("op", "update").eq("field", "first_name")
        .order("id", { ascending: false }).limit(1);
      expect(newRows?.[0]).toEqual({ via: `restore:${changeId}`, author_kind: "person", author_id: "user_rr_live_1" });

      // A second put-back of the SAME old change row: the value is no longer "Changed" (it is "Rr"
      // again), so the compare-and-swap refuses it.
      const again = await putBackChange(db, accountId, changeId, author);
      expect(again).toBe("changed");
    }));

  it("restores a removed unit with the same id, via restore:<id> (mutation: skip restoreEquipment's own insert -> 'restored' would be unreachable)", () =>
    withTestAccount(async (db, accountId) => {
      const author = { authorKind: "person" as const, authorId: "user_rr_live_2" };
      const c = await createContact(db, accountId,
        { firstName: "Ru", phone: "+19565550113", author: { authorKind: "automation", authorId: null } },
        "user_test", "system");
      const place = await addPlace(db, accountId, { contactId: c.id, groupId: null },
        { label: "Home", address: "1 Palm St", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null },
        { subjectId: c.id, author });
      const unit = await addEquipment(db, accountId, place.id, { name: "AC", make: "Carrier", model: null, serial: null, notes: null, installed_on: null, warranty_until: null },
        { subjectId: c.id, author });
      await removeEquipment(db, accountId, unit.id, { subjectId: c.id, author });
      const { data: rows, error } = await db.from("record_changes").select("id")
        .eq("account_id", accountId).eq("record_id", unit.id).eq("op", "delete")
        .order("id", { ascending: false }).limit(1);
      expect(error).toBeNull();
      const changeId = (rows ?? [])[0]?.id as number;
      expect(changeId).toBeTruthy();

      const outcome = await restoreRemoved(db, accountId, changeId, author, new Date());
      expect(outcome).toBe("restored");
      const { data: unitRow } = await db.from("equipment").select("id, name").eq("id", unit.id).single();
      expect(unitRow).toEqual({ id: unit.id, name: "AC" });

      const again = await restoreRemoved(db, accountId, changeId, author, new Date());
      expect(again).toBe("already_back");
    }));
});
