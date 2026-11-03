import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";

/** End-to-end through Kong, PostgREST and supabase-js (A1, A2): the header a service write carries is the author
 *  the database records. CI's local stack only (withTestAccount; `db` is serviceDb()). 0111 (F-115 part 1).
 *  RED BEFORE APPLY, legitimately: there is no record_changes table to read. */
describe("record_changes through the API", () => {
  it("a service update with an x-bis-author header is recorded as that author (mutation: drop the step-4 branch -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      // createContact keeps its (actorId, actorType) pair (plan Task 2 Step 5: a writer that already
      // takes an explicit RowAuthor for creation keeps it and gains withAuthor on the insert) — the
      // explicit `author` below is what withAuthor actually sends on this INSERT; this test's own
      // concern is the UPDATE below, which is why its author is spelled out rather than left to the
      // actorType "system" -> contactAuthor fallback.
      const c = await createContact(db, accountId,
        { firstName: "Rc", phone: "+19565550111", author: { authorKind: "automation", authorId: null } },
        "user_test", "system");
      const r = await db.from("contacts").update({ dnd: { sms: true } }).eq("id", c.id).eq("account_id", accountId)
        .setHeader("x-bis-author", JSON.stringify({ kind: "ai", via: "ai_act:00000000-0000-0000-0000-000000000111" }));
      expect(r.error).toBeNull();
      const { data, error } = await db.from("record_changes").select("field, author_kind, author_id, via")
        .eq("account_id", accountId).eq("record_id", c.id).eq("op", "update");
      expect(error).toBeNull();
      expect(data).toEqual([{ field: "dnd", author_kind: "ai", author_id: null, via: "ai_act:00000000-0000-0000-0000-000000000111" }]);
    }));
});
