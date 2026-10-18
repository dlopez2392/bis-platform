import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  listDocumentRequirements, getRequiredDocumentCategories, setRequiredDocumentCategories, getActiveDocumentSkip, getDocumentSkip,
  skipDocumentRequirement, undoDocumentSkip, unskipDocumentRequirement, undoDocumentUnskip, listDocumentSkipTimeline,
  restoreRequiredDocumentCategories,
} from "../document-requirements";
import { cleanRequiredCategories, requirementsMeter, REQUIRABLE_DOCUMENT_CATEGORIES, DOCUMENT_CATEGORIES } from "../document-rules";

/**
 * The requirements module (spec 5.1-5.4) on the service client behind PostgREST on the replica (the
 * actions hold one AFTER their proof), plus the read's wrapper on a fake rpc client: the definer read
 * refuses the service role by design (it has no account in its token), and its SQL is
 * document-requirements-schema.test.ts's job.
 */
const ACTOR = "user_drq2_test";
const OTHER = "user_drq2_other";
const page = { limit: 31 };

describe("document-rules: the list's pure rules (spec 5.1; D8)", () => {
  it("cleanRequiredCategories keeps the SQL check's rules and the vault's order (mutations: allow 'other'; keep a duplicate; keep the caller's order -> FAILS)", () => {
    expect(cleanRequiredCategories(["warranty", "id", "id", "insurance"])).toEqual(["id", "insurance", "warranty"]);
    expect(cleanRequiredCategories([])).toEqual([]);
    for (const bad of [["other"], ["receipt"], [null], [1], "id", null, { id: true }]) {
      expect(cleanRequiredCategories(bad), JSON.stringify(bad)).toBeNull();
    }
    expect([...REQUIRABLE_DOCUMENT_CATEGORIES]).toEqual(DOCUMENT_CATEGORIES.filter((c) => c !== "other"));
  });
  it("cleanRequiredCategories refuses a sparse array: a hole is not a category (review item 6; mutation: check with `every`, which skips holes -> FAILS)", () => {
    const holey: unknown[] = [];
    holey[1] = "id";
    expect(holey).toHaveLength(2);
    expect(cleanRequiredCategories(holey)).toBeNull();
  });
  it("requirementsMeter leaves skipped items out of both numbers (spec 5.3; mutation: count skipped as required -> FAILS)", () => {
    expect(requirementsMeter([{ state: "met" }, { state: "missing" }, { state: "skipped" }, { state: "checking" }, { state: "expired" }]))
      .toEqual({ met: 1, required: 4 });
    expect(requirementsMeter([{ state: "skipped" }])).toEqual({ met: 0, required: 0 });
  });
});

describe("listDocumentRequirements: the read's wrapper (fake rpc)", () => {
  const fake = (answer: { data: unknown; error: { message: string } | null }) => {
    const calls: unknown[][] = [];
    return { calls, client: { rpc: async (...a: unknown[]) => { calls.push(a); return answer; } } as unknown as SupabaseClient };
  };
  it("calls the function with the account, the contact and the account's today, and answers the rows (mutation: drop or rename p_today in the rpc arguments -> FAILS; the account's-day-vs-UTC mutation is the ROUTE test's, Task 5, M7)", async () => {
    const f = fake({ data: [{ category: "insurance", state: "met" }, { category: "id", state: "checking" }], error: null });
    expect(await listDocumentRequirements(f.client, "acc-1", "ct-1", "2026-10-16")).toEqual([
      { category: "insurance", state: "met" }, { category: "id", state: "checking" }]);
    expect(f.calls).toEqual([["document_requirements", { p_account_id: "acc-1", p_contact_id: "ct-1", p_today: "2026-10-16" }]]);
  });
  it("throws on an error, a null answer, an unknown category or state (mutation: answer [] for a null -> the card would read 'off' for a failure -> FAILS)", async () => {
    await expect(listDocumentRequirements(fake({ data: null, error: { message: "x" } }).client, "a", "c", "2026-10-16")).rejects.toThrow(/document_requirements/);
    await expect(listDocumentRequirements(fake({ data: null, error: null }).client, "a", "c", "2026-10-16")).rejects.toThrow(/unexpected answer/);
    await expect(listDocumentRequirements(fake({ data: [{ category: "other", state: "met" }], error: null }).client, "a", "c", "2026-10-16")).rejects.toThrow(/unexpected answer/);
    await expect(listDocumentRequirements(fake({ data: [{ category: "id", state: "done" }], error: null }).client, "a", "c", "2026-10-16")).rejects.toThrow(/unexpected answer/);
  });
});

describe("the list on the account (spec 5.2)", () => {
  it("set writes the cleaned list and get reads it back; a bad list writes nothing (mutations: write the raw input; swallow the TypeError -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual([]);
      expect(await setRequiredDocumentCategories(db, accountId, ["insurance", "id", "insurance"])).toEqual(["id", "insurance"]);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id", "insurance"]);
      await expect(setRequiredDocumentCategories(db, accountId, ["other"])).rejects.toThrow(TypeError);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id", "insurance"]);
      await expect(setRequiredDocumentCategories(db, crypto.randomUUID(), ["id"])).rejects.toThrow(/no account/);
      // Review item 4 (mutation: answer [] for a missing account -> FAILS): a missing account is never "off".
      await expect(getRequiredDocumentCategories(db, crypto.randomUUID())).rejects.toThrow(/no account/);
    }));
});

describe("skips: at once, with the actor's own Undo (spec 5.4; deviations 1, 2)", () => {
  it("skip, a second skip is 'already', the proof reads find it, un-skip stamps it, a new skip is allowed after (mutation: un-skip deletes the row -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const s = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "insurance", actorId: ACTOR });
      if (s.status !== "skipped") throw new Error(s.status);
      expect(await skipDocumentRequirement(db, { accountId, contactId: ana, category: "insurance", actorId: OTHER })).toEqual({ status: "already" });
      expect((await getActiveDocumentSkip(db, accountId, ana, "insurance"))?.id).toBe(s.skip.id);
      const u = await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER);
      expect(u).not.toBeNull();
      expect(await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER)).toBeNull();
      const row = await getDocumentSkip(db, accountId, s.skip.id);
      expect([row?.unskipped_by, row?.unskipped_at]).toEqual([OTHER, u!.unskippedAt]);
      expect(await getActiveDocumentSkip(db, accountId, ana, "insurance")).toBeNull();
      expect((await skipDocumentRequirement(db, { accountId, contactId: ana, category: "insurance", actorId: ACTOR })).status).toBe("skipped");
    }));

  it("Undo of a skip deletes only the actor's own active row; Undo of an un-skip restores only the actor's own, at the instant it named, and never over a newer skip (mutations: drop the skipped_by filter; restore with a fresh now; ignore the 23505 -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "id", actorId: ACTOR });
      if (a.status !== "skipped") throw new Error(a.status);
      expect(await undoDocumentSkip(db, accountId, a.skip.id, OTHER)).toBe(false);
      expect(await undoDocumentSkip(db, accountId, a.skip.id, ACTOR)).toBe(true);
      expect(await getDocumentSkip(db, accountId, a.skip.id)).toBeNull();

      const b = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "id", actorId: ACTOR });
      if (b.status !== "skipped") throw new Error(b.status);
      const u = await unskipDocumentRequirement(db, accountId, b.skip.id, ACTOR);
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, new Date(Date.parse(u!.unskippedAt) + 1).toISOString(), ACTOR)).toBe(false);
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, u!.unskippedAt, OTHER)).toBe(false);
      const c = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "id", actorId: OTHER });
      expect(c.status).toBe("skipped");
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, u!.unskippedAt, ACTOR)).toBe(false);
      if (c.status === "skipped") expect(await undoDocumentSkip(db, accountId, c.skip.id, OTHER)).toBe(true);
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, u!.unskippedAt, ACTOR)).toBe(true);
      expect((await getActiveDocumentSkip(db, accountId, ana, "id"))?.id).toBe(b.skip.id);
    }));

  it("Undo of a skip never deletes a skip someone has since un-skipped, even the actor's own (review item 1; mutation: drop .is('unskipped_at', null) from undoDocumentSkip -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const s = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "photo", actorId: ACTOR });
      if (s.status !== "skipped") throw new Error(s.status);
      const u = await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER);
      expect(u).not.toBeNull();
      expect(await undoDocumentSkip(db, accountId, s.skip.id, ACTOR)).toBe(false);
      const row = await getDocumentSkip(db, accountId, s.skip.id);
      expect([row?.unskipped_by, row?.unskipped_at]).toEqual([OTHER, u!.unskippedAt]);
    }));

  it("every write is scoped to its account (mutation: drop .eq('account_id') from the un-skip -> another account's row moves -> FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const s = await skipDocumentRequirement(dbB, { accountId: accountB, contactId: bea, category: "permit", actorId: ACTOR });
        if (s.status !== "skipped") throw new Error(s.status);
        expect(await unskipDocumentRequirement(db, accountId, s.skip.id, ACTOR)).toBeNull();
        expect(await undoDocumentSkip(db, accountId, s.skip.id, ACTOR)).toBe(false);
        expect(await getDocumentSkip(db, accountId, s.skip.id)).toBeNull();
        expect((await getDocumentSkip(dbB, accountB, s.skip.id))?.unskipped_at).toBeNull();
        // Review item 5 (mutation: drop .eq('account_id') from getActiveDocumentSkip -> FAILS): the proof
        // read under the wrong account finds nothing; under its own it finds the row (the control).
        expect(await getActiveDocumentSkip(db, accountId, bea, "permit")).toBeNull();
        expect((await getActiveDocumentSkip(dbB, accountB, bea, "permit"))?.id).toBe(s.skip.id);

        // Review item 3 (mutation: drop .eq('account_id') from undoDocumentUnskip -> FAILS).
        const ub = await unskipDocumentRequirement(dbB, accountB, s.skip.id, ACTOR);
        expect(ub).not.toBeNull();
        expect(await undoDocumentUnskip(db, accountId, s.skip.id, ub!.unskippedAt, ACTOR)).toBe(false);
        const after = await getDocumentSkip(dbB, accountB, s.skip.id);
        expect([after?.unskipped_by, after?.unskipped_at]).toEqual([ACTOR, ub!.unskippedAt]);

        // Review item 5 (mutation: drop .eq('account_id') from listDocumentSkipTimeline's base -> FAILS):
        // Bea's skip and un-skip read under her own account (the control), and nothing under another.
        const own = await listDocumentSkipTimeline(dbB, accountB, bea, page);
        expect([own.skips.map((r) => r.id), own.unskips.map((r) => r.id)]).toEqual([[s.skip.id], [s.skip.id]]);
        expect(await listDocumentSkipTimeline(db, accountId, bea, page)).toEqual({ skips: [], unskips: [] });
      })));
});

describe("listDocumentSkipTimeline (spec 5.4: each move is a timeline row)", () => {
  it("a skip row at created_at, and its un-skip row at unskipped_at, for the asked contacts only (mutation: drop the contact filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bo = (await createContact(db, accountId, { firstName: "Bo" }, ACTOR)).id;
      const s = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "warranty", actorId: ACTOR });
      await skipDocumentRequirement(db, { accountId, contactId: bo, category: "warranty", actorId: ACTOR });
      if (s.status !== "skipped") throw new Error(s.status);
      const u = await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER);
      const t = await listDocumentSkipTimeline(db, accountId, ana, page);
      expect(t.skips.map((r) => [r.id, r.category, r.skipped_by, r.created_at])).toEqual([[s.skip.id, "warranty", ACTOR, s.skip.created_at]]);
      expect(t.unskips.map((r) => [r.id, r.unskipped_by, r.unskipped_at])).toEqual([[s.skip.id, OTHER, u!.unskippedAt]]);
      const both = await listDocumentSkipTimeline(db, accountId, [ana, bo], page);
      expect(both.skips).toHaveLength(2);
      // Review item 2 (mutation: drop .not('unskipped_at', 'is', null) from the un-skips read -> Bo's
      // still-active skip reads as a "needed again" row -> FAILS).
      expect(both.unskips.map((r) => r.id)).toEqual([s.skip.id]);
    }));

  // I7: two rows whose created_at order and unskipped_at order DIFFER, read one row at a time, so the
  // un-skips' own ordering column is the only thing that decides which one comes first.
  it("each read is ordered by its OWN instant: the newest skip by created_at, the newest un-skip by unskipped_at, and the cursor pages on it (mutation: order or page the un-skips by created_at -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const first = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "warranty", actorId: ACTOR });
      const second = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "photo", actorId: ACTOR });
      if (first.status !== "skipped" || second.status !== "skipped") throw new Error("seed");
      await unskipDocumentRequirement(db, accountId, second.skip.id, OTHER); // un-skipped FIRST
      await unskipDocumentRequirement(db, accountId, first.skip.id, OTHER); // un-skipped LAST
      const t = await listDocumentSkipTimeline(db, accountId, ana, { limit: 1 });
      expect(t.skips.map((r) => r.id)).toEqual([second.skip.id]); // created last
      expect(t.unskips.map((r) => r.id)).toEqual([first.skip.id]); // un-skipped last
      const older = await listDocumentSkipTimeline(db, accountId, ana, { limit: 1, before: { v: t.unskips[0]!.unskipped_at!, id: first.skip.id } });
      expect(older.unskips.map((r) => r.id)).toEqual([second.skip.id]);
    }));
});

describe("restoreRequiredDocumentCategories (S-07 3a: the Owner card's Undo; plan deviation 9)", () => {
  it("puts the previous list back only while the stored list is exactly the expected one (mutation: drop the list eq -> the second call answers true -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await setRequiredDocumentCategories(db, accountId, ["id", "insurance"]);
      expect(await restoreRequiredDocumentCategories(db, accountId, ["id", "insurance"], ["id"])).toBe(true);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id"]);
      expect(await restoreRequiredDocumentCategories(db, accountId, ["id", "insurance"], [])).toBe(false);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id"]);
      await setRequiredDocumentCategories(db, accountId, []);
      expect(await restoreRequiredDocumentCategories(db, accountId, [], ["warranty"])).toBe(true);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["warranty"]);
      await expect(restoreRequiredDocumentCategories(db, accountId, ["other"], [])).rejects.toThrow(TypeError);
    }));
});
