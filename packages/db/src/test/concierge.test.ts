import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { createForm } from "../forms";
import { upsertVoiceProfile, getVoiceProfile } from "../voice";
import {
  enableConcierge, disableConcierge, getVoiceProfileByPublicId,
  createConciergeConversation, getConciergeConversation, claimConciergeTurn,
  appendConciergeTurns, setConciergeSubmission,
  countConciergeConversationsByIp, countConciergeConversationsForAccount,
} from "../concierge";

// Per-process suffix, same hazard and same fix as concierge-grants.test.ts:12-13:
// this suite runs against the ONE Supabase project shared with production, and
// `countConciergeConversationsByIp` is deliberately NOT account-scoped, so a
// fixed `ip_hash` literal is an assertion about the whole table, not this run.
const RUN = Math.random().toString(36).slice(2, 10);

/**
 * `enableConcierge` reads the account's existing `voice_profiles` row via the
 * `concierge_enable` SQL function (0044) -- it does not insert one, on
 * purpose, because the persona fields it never touches (persona_name,
 * greetings, facts, services) must already belong to a real onboarded
 * profile. Neither `createAccount` nor `withTestAccount` creates that row
 * (confirmed by reading both -- `accounts.ts` has no `voice_profiles` insert
 * at all), so any test that calls `enableConcierge` needs one first.
 * `upsertVoiceProfile` with an empty patch inserts the table's own defaults
 * (voice.ts, every column but `id`/`account_id` has one --
 * 0019_voice_core.sql:22-37), which is all any test here needs.
 *
 * `actorId` is `"user_test"`, matching `voice.test.ts:53`'s precedent --
 * NOT the account id, which is a different value with a different meaning
 * (`emit`'s `actorId` is who did it, not what it was done to).
 *
 * DEVIATION FROM THE PLAN: `docs/superpowers/plans/2026-09-20-web-concierge.md`'s
 * Step 5 code calls `enableConcierge` directly after `createForm`, with no
 * profile setup. Run verbatim it fails all three tests below with
 * `enableConcierge failed: no voice profile for this account` -- a real gap
 * in the test's own setup, not a defect in `enableConcierge`, which is
 * correctly refusing to synthesize a persona. Fixing the test, not the
 * accessor; see the Task 1 report for the full RED transcript this produced
 * before the fix.
 */
async function seedVoiceProfile(db: Parameters<typeof upsertVoiceProfile>[0], accountId: string) {
  await upsertVoiceProfile(db, accountId, {}, "user_test");
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

  // Concurrency proof for the fix in IMPORTANT 6: `concierge_enable`'s
  // `coalesce(public_id, p_new_public_id)` + `returning public_id` hands back
  // WHAT THE ROW HOLDS, never what a given call minted. Two calls racing to
  // enable the same account must agree, or the losing snippet points at a
  // `/c/<publicId>` that resolves to nothing forever.
  it("two concurrent enables agree on the SAME public id", () =>
    withTestAccount(async (db, accountId) => {
      await seedVoiceProfile(db, accountId);
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const [a, b] = await Promise.all([
        enableConcierge(db, accountId, form.id),
        enableConcierge(db, accountId, form.id),
      ]);
      // MUTATION: have `enableConcierge` return the id it minted in JS
      // rather than the RPC's `data` -- this FAILS (deterministically, not
      // intermittently: two `newPublicId()` draws essentially never collide,
      // so the two calls hand back two different ids while the row holds
      // only one).
      expect(a.publicId).toBe(b.publicId);
    }));

  // Minor: the "no persona yet" path is reachable in production (Task 1
  // revision 7 -- an account that has never saved voice settings has no
  // `voice_profiles` row at all) and was untested.
  it("enableConcierge throws a clear error when the account has no voice profile", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      await expect(enableConcierge(db, accountId, form.id))
        .rejects.toThrow(/no voice profile/);
    }));

  it("disableConcierge throws rather than reporting success for an account with no profile row", () =>
    withTestAccount(async (db, accountId) => {
      // MUTATION: drop the `.select("id")` + zero-row check -- this FAILS,
      // because the call would resolve as if it had switched something off.
      await expect(disableConcierge(db, accountId)).rejects.toThrow(/matched no row/);
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
        accountId, formId: form.id, ipHash: `aaa-${RUN}`, locale: "en",
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
        accountId, formId: form.id, ipHash: `bbb-${RUN}`, locale: "en",
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

  // IMPORTANT 2: `claimConciergeTurn` does NOT serialise turns below the cap
  // (it refuses only at `turn_count >= p_max`), so appendConciergeTurns must
  // itself be atomic -- `concierge_append_turns` (0044) does
  // `transcript = transcript || p_turns` in one statement. This test appends
  // TWICE and checks the RETURNED LENGTH each time, which a read-modify-write
  // reimplementation cannot do honestly under concurrency (see the next test
  // for the concurrent proof; this one pins the sequential contract).
  it("appendConciergeTurns appends rather than replacing, and returns the new length", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: `ccc-${RUN}`, locale: "en",
        attribution: {}, origin: null,
      });
      const afterFirst = await appendConciergeTurns(db, id, [
        { role: "visitor", text: "hi", at: new Date().toISOString() },
      ]);
      expect(afterFirst).toBe(1);
      const afterSecond = await appendConciergeTurns(db, id, [
        { role: "assistant", text: "hello", at: new Date().toISOString() },
      ]);
      expect(afterSecond).toBe(2);
      const row = await getConciergeConversation(db, id);
      // MUTATION: drop the `||` and write `p_turns` alone -- this FAILS.
      expect(row!.transcript.map((t) => t.text)).toEqual(["hi", "hello"]);
    }));

  // The concurrency proof this fix exists for: two turns posted TOGETHER
  // must both survive. Under the old read-modify-write, both reads see the
  // same starting transcript and the later write clobbers the earlier one --
  // an exchange vanishes with no error, which is exactly the defect
  // IMPORTANT 2 names.
  it("two concurrent appends to the same conversation BOTH survive", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: `race-${RUN}`, locale: "en",
        attribution: {}, origin: null,
      });
      await Promise.all([
        appendConciergeTurns(db, id, [
          { role: "visitor", text: "one", at: new Date().toISOString() },
        ]),
        appendConciergeTurns(db, id, [
          { role: "visitor", text: "two", at: new Date().toISOString() },
        ]),
      ]);
      const row = await getConciergeConversation(db, id);
      // MUTATION: replace concierge_append_turns's use with a read-modify-write
      // in the accessor (get, spread, update) -- this FAILS: one of "one"/"two"
      // is silently lost.
      expect(row!.transcript.map((t) => t.text).sort()).toEqual(["one", "two"]);
    }));

  it("appendConciergeTurns throws when the conversation does not exist", async () => {
    await expect(
      appendConciergeTurns(serviceDb(), "00000000-0000-0000-0000-000000000000", [
        { role: "visitor", text: "hi", at: new Date().toISOString() },
      ]),
    ).rejects.toThrow(/not found/);
  });

  it("setConciergeSubmission writes once, reports which write happened, and ignores a second capture", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: `ddd-${RUN}`, locale: "en",
        attribution: {}, origin: null,
      });
      const { data: s1 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      const { data: s2 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      // MUTATION: always return true regardless of `.select("id")`'s row
      // count -- this FAILS: the second call must report it did NOT claim.
      expect(await setConciergeSubmission(db, id, s1!.id)).toBe(true);
      expect(await setConciergeSubmission(db, id, s2!.id)).toBe(false);
      // MUTATION: drop `.is("submission_id", null)` -- this FAILS, and one
      // visitor becomes two leads.
      expect((await getConciergeConversation(db, id))!.submission_id).toBe(s1!.id);
    }));

  // IMPORTANT 3's other half: a zero-row update because the CONVERSATION
  // ITSELF does not exist must throw, not quietly return false -- false
  // means "this row exists and someone else already claimed it", which is a
  // real, different state from "there is no such conversation".
  it("setConciergeSubmission throws when the conversation does not exist", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { data: s1 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      await expect(
        setConciergeSubmission(db, "00000000-0000-0000-0000-000000000000", s1!.id),
      ).rejects.toThrow(/not found/);
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
  // only its own rows cannot fail a swapped filter column. The `ip_hash`
  // literals carry the per-process RUN suffix (see the module comment): this
  // is a live-project assertion about the WHOLE TABLE for the by-IP counter,
  // and two overlapping runs both writing bare "mine" would both see 2.
  it("the counters filter on the right column and the right window", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const mine = { accountId, formId: form.id, locale: "en",
                     attribution: {}, origin: null };
      const mineHash = `mine-${RUN}`;
      await createConciergeConversation(db, { ...mine, ipHash: mineHash });
      await createConciergeConversation(db, { ...mine, ipHash: `theirs-${RUN}` });
      const old = await createConciergeConversation(db, { ...mine, ipHash: mineHash });
      await db.from("concierge_conversations")
        .update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", old.id);

      const since = new Date(Date.now() - 600_000).toISOString();
      // MUTATION: drop `.eq("ip_hash", ipHash)` on the by-IP counter -- this
      // is what the brief prescribes in place of the unconstructible
      // "swap ip_hash for account_id" (account_id is uuid; the swap throws a
      // cast error before the query ever runs). Dropping the filter counts
      // every row in the table created in this window, not just these two.
      expect(await countConciergeConversationsByIp(db, mineHash, since)).toBe(1);
      // MUTATION: drop the `.gte("created_at", ...)` -- it would return 3.
      expect(await countConciergeConversationsForAccount(db, accountId, since)).toBe(2);
    }));

  // IMPORTANT 4: every row the OLD version of this test seeded belonged to
  // ONE account, and the live table is empty outside a run, so dropping
  // `.eq("account_id", accountId)` from the by-account counter returned the
  // same number and stayed green. That filter is the per-tenant COST
  // CEILING -- counting globally would let one account's traffic throttle
  // every other client's widget, cross-tenant, with no error anywhere. This
  // seeds a SECOND account via a nested `withTestAccount` (never a bare
  // `createAccount` outside a try, which would strand an account permanently
  // in the project shared with production) and asserts the count for the
  // first ignores the second's conversation entirely.
  it("the by-account counter ignores another account's conversations", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (otherDb, otherAccountId) => {
        const form = await createForm(db, accountId, { name: "Leads" }, accountId);
        const otherForm = await createForm(otherDb, otherAccountId, { name: "Leads" }, otherAccountId);
        await createConciergeConversation(db, {
          accountId, formId: form.id, ipHash: `mineacct-${RUN}`, locale: "en",
          attribution: {}, origin: null,
        });
        await createConciergeConversation(otherDb, {
          accountId: otherAccountId, formId: otherForm.id, ipHash: `otheracct-${RUN}`,
          locale: "en", attribution: {}, origin: null,
        });
        const since = new Date(Date.now() - 600_000).toISOString();
        // MUTATION: drop `.eq("account_id", accountId)` on the by-account
        // counter -- this FAILS once a second account's row exists in the
        // same window (returns 2, not 1).
        expect(await countConciergeConversationsForAccount(db, accountId, since)).toBe(1);
      })));

  // IMPORTANT 7: `PROFILE_CONCIERGE_COLS` was a character-identical COPY of
  // voice.ts's module-private `PROFILE_COLS`, and the `as ConciergeProfile`
  // cast in getVoiceProfileByPublicId hides a copy that drifts -- a fourth
  // column added to one list and not the other returns a row missing it,
  // typed as present, with no type error and no failing test. The fix
  // exports `PROFILE_COLS` from voice.ts and concierge.ts builds its list
  // from THAT, so there is no second copy left to forget. This test proves
  // the two accessors read the identical column set at runtime.
  it("getVoiceProfileByPublicId returns the same columns getVoiceProfile does (no drifted copy)", () =>
    withTestAccount(async (db, accountId) => {
      await seedVoiceProfile(db, accountId);
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { publicId } = await enableConcierge(db, accountId, form.id);
      const full = await getVoiceProfile(db, accountId);
      const concierge = await getVoiceProfileByPublicId(db, publicId);
      // MUTATION: hard-code a shorter column list back into concierge.ts's
      // query (e.g. drop "textback_body") -- this FAILS.
      expect(Object.keys(concierge!).sort()).toEqual(Object.keys(full!).sort());
    }));
});
