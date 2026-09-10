import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, getContact, listTags, addTagToContact, listContactTags } from "../contacts";
import { buildMatchIndex, applyImportBatch, type MatchIndex } from "../contact-import";

// Transcribed verbatim from docs/superpowers/plans/2026-09-09-contacts-data.md,
// Task 6 Step 1, wrapped in this suite's withTestAccount/actorId conventions
// (the fixture hands back no actorId — "user_test", as every sibling suite
// does). The sixth test is the BINDING this task adds: an empty `tags` cell
// must never clear a contact's existing tags.
describe("applyImportBatch", () => {
  it("creates a new contact and updates a matching one in the same batch", () =>
    withTestAccount(async (db, accountId) => {
      const existing = await createContact(db, accountId,
        { email: "ada@example.com", firstName: "Ada" }, "user_test");
      const index = await buildMatchIndex(db, accountId);
      const r = await applyImportBatch(db, accountId, [
        { input: { email: "ada@example.com", companyName: "Analytical Engines" }, tags: [] },
        { input: { email: "grace@example.com", firstName: "Grace" }, tags: [] },
      ], index, "user_test", { createTags: false });

      expect(r).toEqual({ created: 1, updated: 1 });
      const ada = await getContact(db, accountId, existing.id);
      expect(ada!.company_name).toBe("Analytical Engines");
      expect(ada!.first_name).toBe("Ada"); // untouched: the CSV had no first name
    }));

  it("matches on phone across formatting — (956) 292-1696 is +19562921696", () =>
    withTestAccount(async (db, accountId) => {
      const existing = await createContact(db, accountId, { phone: "+19562921696" }, "user_test");
      const index = await buildMatchIndex(db, accountId);
      const r = await applyImportBatch(db, accountId,
        [{ input: { phone: "(956) 292-1696", firstName: "Dan" }, tags: [] }],
        index, "user_test", { createTags: false });
      expect(r).toEqual({ created: 0, updated: 1 });
      expect((await getContact(db, accountId, existing.id))!.first_name).toBe("Dan");
    }));

  it("a non-empty cell OVERWRITES — this is not fillContactBlanks", () =>
    withTestAccount(async (db, accountId) => {
      const existing = await createContact(db, accountId,
        { email: "a@b.co", firstName: "Old" }, "user_test");
      const index = await buildMatchIndex(db, accountId);
      await applyImportBatch(db, accountId,
        [{ input: { email: "a@b.co", firstName: "New" }, tags: [] }],
        index, "user_test", { createTags: false });
      expect((await getContact(db, accountId, existing.id))!.first_name).toBe("New");
    }));

  // MUTATION-CHECK FINDING (reported in full, not papered over): removing the
  // "add the newly created id to the index" line does NOT make this test
  // fail. Verified by actually running it, per this task's own instruction
  // not to trust reasoning about a mutation without running it. Mechanism:
  // row 2's lookup misses this INDEX, so applyImportBatch calls createContact
  // — but createContact's OWN findDuplicate (Trap 1) queries the live table,
  // where row 1 is already committed (rows are awaited in order), so it
  // independently reports existing:true. Trap 2's fix (below) then applies
  // row 2's patch and counts it as `updated`, identically to what the index
  // would have produced. So for count-based assertions like this one, the
  // index line is a real, measured performance optimization (it skips a
  // redundant createContact/findDuplicate round trip — see Trap 1's comment
  // in contact-import.ts) rather than a correctness dependency THIS
  // particular test can observe. The next test exists because chasing that
  // finding surfaced a real, previously-uncovered gap: Trap 2's fix is not
  // exercised by any of the plan's five tests under normal (non-mutated)
  // execution at all.
  it("collapses two identical rows inside ONE batch to a single contact", () =>
    withTestAccount(async (db, accountId) => {
      const index = await buildMatchIndex(db, accountId);
      const r = await applyImportBatch(db, accountId, [
        { input: { email: "dup@example.com", firstName: "A" }, tags: [] },
        { input: { email: "dup@example.com", lastName: "B" }, tags: [] },
      ], index, "user_test", { createTags: false });
      expect(r).toEqual({ created: 1, updated: 1 });
    }));

  it("does not create an unknown tag when createTags is false", () =>
    withTestAccount(async (db, accountId) => {
      const index = await buildMatchIndex(db, accountId);
      await applyImportBatch(db, accountId,
        [{ input: { email: "t@example.com" }, tags: ["brand-new"] }],
        index, "user_test", { createTags: false });
      expect((await listTags(db, accountId)).map((t) => t.name)).not.toContain("brand-new");
    }));

  // THE BINDING. Export emits `tags` empty for every row (no bulk
  // tags-for-many-contacts read exists), so "export this list, fix a phone
  // number, re-import" hands back a file whose every tags cell is blank. If
  // empty read as "clear the tags", that flow silently strips every tag from
  // every contact in the account and both sides report success.
  it("an empty tags cell leaves an existing contact's tags untouched", () =>
    withTestAccount(async (db, accountId) => {
      const existing = await createContact(db, accountId, { email: "tagged@example.com" }, "user_test");
      await addTagToContact(db, accountId, existing.id, "vip");
      const index = await buildMatchIndex(db, accountId);
      await applyImportBatch(db, accountId,
        [{ input: { email: "tagged@example.com", firstName: "Updated" }, tags: [] }],
        index, "user_test", { createTags: false });
      const tags = await listContactTags(db, accountId, existing.id);
      expect(tags.map((t) => t.name)).toEqual(["vip"]);
    }));

  // ADDITIONAL — beyond the plan's five plus the binding (seven total, not
  // six). Closes a gap found while running mutation-check 1 above: none of
  // the plan's five tests reach applyImportBatch's `result.existing === true`
  // branch under NORMAL execution — only the deliberately-mutated run above
  // did. A stale/incomplete index (built before a matching contact existed,
  // or never populated at all — anything that makes THIS index miss while
  // createContact's own live dedupe still hits) is a real, reachable case,
  // not a hypothetical: buildMatchIndex snapshots once at batch start, and
  // nothing stops another write landing on that email between the snapshot
  // and this row. Pins BOTH halves of Trap 2 in one assertion each: the
  // count must read `existing`, not just "was it in the index", AND the
  // row's own fields must still be applied — createContact returns early on
  // a duplicate WITHOUT writing anything, so skipping the follow-up
  // updateContact would silently drop this row's data on the floor.
  it("applies the row's fields and counts as updated when createContact's own dedupe catches what the index missed", () =>
    withTestAccount(async (db, accountId) => {
      const existing = await createContact(db, accountId,
        { email: "race@example.com", firstName: "Before" }, "user_test");
      const staleIndex: MatchIndex = { byEmail: new Map(), byPhone: new Map() };
      const r = await applyImportBatch(db, accountId,
        [{ input: { email: "race@example.com", firstName: "After" }, tags: [] }],
        staleIndex, "user_test", { createTags: false });
      expect(r).toEqual({ created: 0, updated: 1 });
      expect((await getContact(db, accountId, existing.id))!.first_name).toBe("After");
    }));

  // ADDITIONAL — coordinator-requested gap closure. Every test above that
  // touches tags either seeds one directly via addTagToContact (the binding
  // test) or asserts a tag's ABSENCE from the account's vocabulary (the
  // createTags:false test). None of them proves applyImportBatch ever
  // applies a tag through the import path at all — verified by mutation: with
  // the tag-application loop deleted entirely, all seven tests above still
  // passed. "target" starts with zero tags and carries none in its own row;
  // "vip" reaches it only if the import machinery resolves and applies it.
  it("applies a tag through the import when it already exists on the account", () =>
    withTestAccount(async (db, accountId) => {
      // addTagToContact is the only way to create a tag, and always attaches
      // it to a contact, so an unrelated contact seeds "vip" into the
      // account's vocabulary without ever touching the target.
      const seed = await createContact(db, accountId, { email: "seed@example.com" }, "user_test");
      await addTagToContact(db, accountId, seed.id, "vip");

      const target = await createContact(db, accountId, { email: "target@example.com" }, "user_test");
      const index = await buildMatchIndex(db, accountId);
      await applyImportBatch(db, accountId,
        [{ input: { email: "target@example.com" }, tags: ["vip"] }],
        index, "user_test", { createTags: false });

      expect((await listContactTags(db, accountId, target.id)).map((t) => t.name)).toEqual(["vip"]);
    }));

  // ADDITIONAL — the adjacent case: createTags:true must both create the
  // unknown tag AND apply it, not just clear it to be created elsewhere.
  it("creates and applies a brand-new tag when createTags is true", () =>
    withTestAccount(async (db, accountId) => {
      const target = await createContact(db, accountId, { email: "newtag@example.com" }, "user_test");
      const index = await buildMatchIndex(db, accountId);
      await applyImportBatch(db, accountId,
        [{ input: { email: "newtag@example.com" }, tags: ["brand-new-2"] }],
        index, "user_test", { createTags: true });

      expect((await listTags(db, accountId)).map((t) => t.name)).toContain("brand-new-2");
      expect((await listContactTags(db, accountId, target.id)).map((t) => t.name)).toEqual(["brand-new-2"]);
    }));
});
