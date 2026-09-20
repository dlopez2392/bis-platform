import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { createForm } from "../forms";
import { upsertVoiceProfile } from "../voice";
import {
  enableConcierge, disableConcierge, getVoiceProfileByPublicId,
  createConciergeConversation, getConciergeConversation, claimConciergeTurn,
  appendConciergeTurns, setConciergeSubmission,
  countConciergeConversationsByIp, countConciergeConversationsForAccount,
} from "../concierge";

/**
 * `enableConcierge` reads the account's existing `voice_profiles` row and
 * UPDATEs it (concierge.ts:53-64) -- it does not insert one, on purpose,
 * because the persona fields it never touches (persona_name, greetings,
 * facts, services) must already belong to a real onboarded profile. Neither
 * `createAccount` nor `withTestAccount` creates that row (confirmed by
 * reading both -- `accounts.ts` has no `voice_profiles` insert at all), so
 * any test that calls `enableConcierge` needs one first. `upsertVoiceProfile`
 * with an empty patch inserts the table's own defaults (voice.ts:142-159,
 * every column but `id`/`account_id` has one -- 0019_voice_core.sql:22-37),
 * which is all any test here needs.
 *
 * DEVIATION FROM THE PLAN: `docs/superpowers/plans/2026-09-20-web-concierge.md`'s
 * Step 5 code calls `enableConcierge` directly after `createForm`, with no
 * profile setup. Run verbatim it fails all three tests below with
 * `enableConcierge failed: no voice profile for this account`
 * (concierge.ts:56) -- a real gap in the test's own setup, not a defect in
 * `enableConcierge`, which is correctly refusing to synthesize a persona.
 * Fixing the test, not the accessor; see the Task 1 report for the full RED
 * transcript this produced before the fix.
 */
async function seedVoiceProfile(db: Parameters<typeof upsertVoiceProfile>[0], accountId: string) {
  await upsertVoiceProfile(db, accountId, {}, accountId);
}

describe("concierge accessors", () => {
  it("enableConcierge mints a public id, and re-enabling keeps the SAME one", () =>
    withTestAccount(async (db, accountId) => {
      await seedVoiceProfile(db, accountId);
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const first = await enableConcierge(db, accountId, form.id);
      // `newPublicId`'s ALPHABET is "abcdefghijkmnpqrstuvwxyz23456789"
      // (forms.ts:52) -- lowercase only, no `l`, no `o`, digits 2-9. A looser
      // /^[A-Za-z0-9]{12}$/ is a superset that would pass for an id this
      // function cannot produce.
      expect(first.publicId).toMatch(/^[a-km-z2-9]{12}$/);
      await disableConcierge(db, accountId);
      const second = await enableConcierge(db, accountId, form.id);
      // MUTATION: drop the `?? newPublicId()` guard and always mint --
      // this FAILS, because every snippet already on a client's site would
      // have silently stopped working.
      expect(second.publicId).toBe(first.publicId);
    }));

  it("getVoiceProfileByPublicId returns null when the concierge is OFF", () =>
    withTestAccount(async (db, accountId) => {
      await seedVoiceProfile(db, accountId);
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { publicId } = await enableConcierge(db, accountId, form.id);
      expect(await getVoiceProfileByPublicId(db, publicId)).not.toBeNull();
      await disableConcierge(db, accountId);
      // MUTATION: drop `.eq("concierge_enabled", true)` -- this FAILS.
      expect(await getVoiceProfileByPublicId(db, publicId)).toBeNull();
    }));

  it("getVoiceProfileByPublicId returns null when no destination form is set", () =>
    withTestAccount(async (db, accountId) => {
      await seedVoiceProfile(db, accountId);
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { publicId } = await enableConcierge(db, accountId, form.id);
      await db.from("voice_profiles")
        .update({ concierge_form_id: null }).eq("account_id", accountId);
      // MUTATION: drop `.not("concierge_form_id", "is", null)` -- this FAILS.
      expect(await getVoiceProfileByPublicId(db, publicId)).toBeNull();
    }));

  it("claimConciergeTurn counts up and returns null at the cap", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "aaa", locale: "en",
        attribution: {}, origin: null,
      });
      expect(await claimConciergeTurn(db, id, 2)).toBe(1);
      expect(await claimConciergeTurn(db, id, 2)).toBe(2);
      // MUTATION: change the SQL's `turn_count < p_max` to `<=` -- this FAILS.
      expect(await claimConciergeTurn(db, id, 2)).toBeNull();
    }));

  it("two concurrent claims at the boundary yield exactly one success", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "bbb", locale: "en",
        attribution: {}, origin: null,
      });
      const results = await Promise.all([
        claimConciergeTurn(db, id, 1), claimConciergeTurn(db, id, 1),
      ]);
      // MUTATION: replace the SQL function with a read-then-write pair in
      // the accessor -- this FAILS intermittently, which is why the cap is
      // one statement.
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    }));

  it("appendConciergeTurns appends rather than replacing", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "ccc", locale: "en",
        attribution: {}, origin: null,
      });
      await appendConciergeTurns(db, id, [
        { role: "visitor", text: "hi", at: new Date().toISOString() },
      ]);
      await appendConciergeTurns(db, id, [
        { role: "assistant", text: "hello", at: new Date().toISOString() },
      ]);
      const row = await getConciergeConversation(db, id);
      // MUTATION: drop the spread and write `turns` alone -- this FAILS.
      expect(row!.transcript.map((t) => t.text)).toEqual(["hi", "hello"]);
    }));

  it("setConciergeSubmission writes once and ignores a second capture", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "ddd", locale: "en",
        attribution: {}, origin: null,
      });
      const { data: s1 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      const { data: s2 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      await setConciergeSubmission(db, id, s1!.id);
      await setConciergeSubmission(db, id, s2!.id);
      // MUTATION: drop `.is("submission_id", null)` -- this FAILS, and one
      // visitor becomes two leads.
      expect((await getConciergeConversation(db, id))!.submission_id).toBe(s1!.id);
    }));

  // The ordering proof, as a pure assertion with no DB in it so it cannot be
  // flaky or vacuous. The other tests in this file prove it a second way,
  // implicitly: each creates a conversation and lets withTestAccount tear the
  // account down, which throws "cleanup failed on forms" if the ordering is
  // wrong. MUTATION: move the entry after "forms" -- this FAILS.
  it("is torn down before forms, which its restrict FK points at", () => {
    const i = ACCOUNT_OWNED_TABLES.indexOf("concierge_conversations");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(ACCOUNT_OWNED_TABLES.indexOf("forms"));
  });

  // BOTH SIDES OF BOTH FILTERS. A counter tested against a table holding
  // only its own rows cannot fail a swapped filter column.
  it("the counters filter on the right column and the right window", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const mine = { accountId, formId: form.id, locale: "en",
                     attribution: {}, origin: null };
      await createConciergeConversation(db, { ...mine, ipHash: "mine" });
      await createConciergeConversation(db, { ...mine, ipHash: "theirs" });
      const old = await createConciergeConversation(db, { ...mine, ipHash: "mine" });
      await db.from("concierge_conversations")
        .update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", old.id);

      const since = new Date(Date.now() - 600_000).toISOString();
      // MUTATION: swap `ip_hash` for `account_id` in the by-IP counter -- it
      // would return 3 here, not 1.
      expect(await countConciergeConversationsByIp(db, "mine", since)).toBe(1);
      // MUTATION: drop the `.gte("created_at", ...)` -- it would return 3.
      expect(await countConciergeConversationsForAccount(db, accountId, since)).toBe(2);
    }));
});
