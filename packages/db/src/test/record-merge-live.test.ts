import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { insertAiActs } from "../ai-acts";
import { assignPhoneNumber } from "../voice";
import { mergeContacts, undoContactMerge, contactMergePreview } from "../contact-merge";
import { listTimelinePage, listContactTimelinePage } from "../record";

/**
 * F-006 part 1 (plan Task 9), live half: the `merge` source against the REAL 0106 functions, on the CI
 * project only (0106 is not on bis-ci yet: this file is proven by CI `verify`, which builds its own
 * stack from the branch's migrations, never run locally against any Supabase project — global
 * constraint 17). The pure half (a fake client, every mutation named in the plan) is
 * `../../../apps/web` ... no — this file's own pure sibling is `timeline-merge.test.ts`, which proves
 * `listContactMergeLog`'s shape over a fake client; this file proves correction 11: through the id set
 * `[keepId, otherId]`, the kept record's page shows the tombstone's own history too.
 */
const ACTOR = "user_test";

async function person(db: SupabaseClient, accountId: string, first: string): Promise<string> {
  const { id } = await createContact(db, accountId, { firstName: first }, ACTOR);
  return id;
}

describe("the merge source on the live timeline (plan Task 9, correction 11)", () => {
  it("through the id set, the kept record's page shows both the merge row and the tombstone's own history; undo adds a mergeUndone row; a second account's merge never appears (mutation: read [keepId] only -> the tombstone's act is missing, FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const keepId = await person(db, accountId, "Keep");
        const otherId = await person(db, accountId, "Other");
        // The tombstone's own act, seeded BEFORE the merge (record.test.ts's actOn shape): a voice act
        // must name its call (0091's ai_acts_source), so a real call on a real number comes first.
        const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
        const { data: call, error: callErr } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id }).select("id").single();
        if (callErr) throw new Error(`seed call failed: ${callErr.message}`);
        await insertAiActs(db, accountId, [{
          kind: "contact_field_filled", actor: "voice", callId: call!.id as string, chatId: null, contactId: otherId,
          target: { field: "firstName" }, before: { value: null }, after: { value: "Other" },
        }]);

        const preview = await contactMergePreview(db, accountId, keepId, otherId);
        if (preview.status !== "ok") throw new Error(`expected ok, got ${preview.status}`);
        const outcome = await mergeContacts(db, accountId, { keepId, otherId, choices: {}, seen: preview.seen, actor: ACTOR });
        if (outcome.status !== "merged") throw new Error(`expected merged, got ${outcome.status}`);

        // Through [keepId, otherId] the kept page shows the merge row AND the tombstone's own act
        // (correction 11: consent is the one source left out; ai_acts is not).
        const both = await listTimelinePage(db, accountId, [keepId, otherId], undefined, { aiActs: true });
        expect(both.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["merge", "aiAct"]));
        const mergeRow = both.items.find((i) => i.kind === "merge");
        expect(mergeRow).toMatchObject({
          contactId: keepId,
          merge: { otherId, otherVisible: true, otherFirstName: "Other", undoneAt: null, undoneBy: null },
        });

        // Reading [keepId] alone (the mutation this test names) loses the tombstone's own act.
        const keepOnly = await listTimelinePage(db, accountId, [keepId], undefined, { aiActs: true });
        expect(keepOnly.items.some((i) => i.kind === "aiAct")).toBe(false);

        // Undo adds a SECOND row (mergeUndone) without losing the original merge row.
        const undone = await undoContactMerge(db, accountId, outcome.mergeId, ACTOR);
        expect(undone.status).toBe("undone");
        const afterUndo = await listTimelinePage(db, accountId, [keepId, otherId]);
        expect(afterUndo.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["merge", "mergeUndone"]));
        const undoneRow = afterUndo.items.find((i) => i.kind === "mergeUndone");
        expect(undoneRow).toMatchObject({ contactId: keepId, merge: { otherId, undoneBy: ACTOR } });

        // Second-account rule: account B's own contact shares no merge or mergeUndone row with A's.
        const bOne = await person(dbB, accountB, "Bea");
        const pageB = await listContactTimelinePage(dbB, accountB, bOne);
        expect(pageB.items.filter((i) => i.kind === "merge" || i.kind === "mergeUndone")).toEqual([]);

        // `listContactTimelinePage`'s own `sources` names "merge" too, on the plain one-person path.
        expect((await listContactTimelinePage(db, accountId, keepId)).sources).toContain("merge");
      }),
    ));
});
