import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { recordWebSession, countWebSessionsByIp, countWebSessionsForAccount } from "../voice-web-sessions";
import { serviceDb } from "../service";
import { createAccount } from "../accounts";
import { deleteAccountCascade } from "../account-teardown";
import { withTestAccount } from "./fixtures";

/**
 * `voice-web-sessions-grants.test.ts` proves the TABLE (grants, RLS, the
 * unique-index constraint) — every assertion there reaches
 * `public.voice_web_sessions` directly, via `db.from(...)` or raw
 * `c.query(...)`. None of it calls `recordWebSession`,
 * `countWebSessionsByIp` or `countWebSessionsForAccount`, so those three
 * functions were typecheck-verified only: swapping the two counters' `.eq()`
 * filter columns, or inverting `recordWebSession`'s `error.code === "23505"`
 * branch, type-checks cleanly and leaves that file's 10 tests green. This
 * file closes that gap by calling the real functions.
 */

/** A ticket nonce unique to this call — `Date.now()` alone collides within
 *  the same millisecond across the multiple calls several tests here make. */
const freshNonce = (label: string) => `n_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** A 32-hex-char ip_hash, matching the migration's own comment on the
 *  column's shape (`forms/guards.ts`'s `hashIp`). Randomized, not a fixed
 *  literal: this suite shares ONE Supabase project with production, and
 *  `countWebSessionsByIp`'s own test below asserts an EXACT count for a
 *  given hash — a fixed literal would let a concurrent run of this same
 *  file inflate that count, the exact class of flake `fixtures.ts`'s
 *  `testPhoneNumber` doc-block already catalogues for this project. */
const randomIpHash = () => randomBytes(16).toString("hex");

describe("recordWebSession", () => {
  it("a fresh nonce records; the same nonce again is a refused replay, not a write (mutation: invert the 23505 branch to `!==` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const nonce = freshNonce("replay");
      const ipHash = randomIpHash();
      const first = await recordWebSession(db, {
        accountId, ticketNonce: nonce, ipHash, origin: null,
      });
      expect(first).toBe(true);
      const second = await recordWebSession(db, {
        accountId, ticketNonce: nonce, ipHash, origin: null,
      });
      expect(second).toBe(false);
    });
  });

  // The nil UUID is not a real `accounts.id` — `gen_random_uuid()` never
  // produces it, and nothing in this schema inserts an account with it — so
  // this insert fails on the `account_id` foreign key (23503), a DIFFERENT
  // error than the unique-nonce violation (23505) the test above exercises.
  it("a non-duplicate failure throws — it does not come back as `false` (mutation: return false for any error -> FAILS)", async () => {
    const db = serviceDb();
    const bogusAccountId = "00000000-0000-0000-0000-000000000000";
    await expect(
      recordWebSession(db, {
        accountId: bogusAccountId, ticketNonce: freshNonce("fk"), ipHash: randomIpHash(), origin: null,
      }),
    ).rejects.toThrow();
  });
});

describe("countWebSessionsByIp / countWebSessionsForAccount", () => {
  // The mutation the reviewer named: swapping the two functions' `.eq()`
  // column names. A fixture where each counter's own rows are the ONLY rows
  // in the table cannot catch that — the swap would still return a number
  // that happens to be right, for the wrong column. So this seeds rows on
  // BOTH sides of BOTH filters: two accounts, two ip_hashes, and one row
  // that shares neither account nor ip_hash with the read each assertion is
  // about to make.
  it("each counter counts only its own key — rows on both sides of both filters (mutation: swap the two `.eq()` filter columns -> FAILS)", async () => {
    const db = serviceDb();
    const orgA = `org_WS_TWOKEY_A_${Math.random().toString(36).slice(2, 10)}`;
    const orgB = `org_WS_TWOKEY_B_${Math.random().toString(36).slice(2, 10)}`;
    const { id: accountIdA } = await createAccount(db, { clerkOrgId: orgA, name: "Fixture WS Two A", actorId: "user_test" });
    const { id: accountIdB } = await createAccount(db, { clerkOrgId: orgB, name: "Fixture WS Two B", actorId: "user_test" });
    try {
      const ipHashX = randomIpHash();
      const ipHashY = randomIpHash();
      const since = new Date(Date.now() - 3600_000).toISOString();

      // A/X, A/Y, B/X — every account has a row with EACH ip_hash except
      // where it deliberately doesn't, and every ip_hash has a row under
      // EACH account except where it deliberately doesn't.
      expect(await recordWebSession(db, { accountId: accountIdA, ticketNonce: freshNonce("ax"), ipHash: ipHashX, origin: null })).toBe(true);
      expect(await recordWebSession(db, { accountId: accountIdA, ticketNonce: freshNonce("ay"), ipHash: ipHashY, origin: null })).toBe(true);
      expect(await recordWebSession(db, { accountId: accountIdB, ticketNonce: freshNonce("bx"), ipHash: ipHashX, origin: null })).toBe(true);

      // accountIdA: 2 rows (X and Y) — a swap that reads ip_hash here would
      // find 0 or error, since accountIdA is a uuid and neither ip_hash
      // string equals it.
      expect(await countWebSessionsForAccount(db, accountIdA, since)).toBe(2);
      // accountIdB: 1 row (X only).
      expect(await countWebSessionsForAccount(db, accountIdB, since)).toBe(1);
      // ipHashX: 2 rows (A and B) — a swap that reads account_id here would
      // find 0 or error, since ipHashX is not a uuid.
      expect(await countWebSessionsByIp(db, ipHashX, since)).toBe(2);
      // ipHashY: 1 row (A only).
      expect(await countWebSessionsByIp(db, ipHashY, since)).toBe(1);
    } finally {
      await deleteAccountCascade(db, accountIdA, "voice-web-sessions.test.ts");
      await deleteAccountCascade(db, accountIdB, "voice-web-sessions.test.ts");
    }
  });

  it("sinceIso bounds the window — a row older than the cutoff is not counted (mutation: drop `.gte(\"created_at\", sinceIso)` -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date().toISOString();

      // OLD: written directly with an explicit past `created_at`.
      // `recordWebSession` always stamps `now()` (the column's own default,
      // matching what the real route does), so reaching a row on the wrong
      // side of the window requires setting the column explicitly — this
      // bypasses the function under test for this one fixture row only, the
      // same way `screened-calls.test.ts`'s null-account fixtures write
      // directly where the accessor's own shape cannot reach the case.
      const oldCreatedAt = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { error: oldErr } = await db.from("voice_web_sessions").insert({
        account_id: accountId, ticket_nonce: freshNonce("old"), ip_hash: randomIpHash(),
        created_at: oldCreatedAt,
      });
      expect(oldErr, `old-row insert failed: ${oldErr?.message}`).toBeNull();

      // NEW: recorded through the real function, after `since` was captured.
      const recorded = await recordWebSession(db, {
        accountId, ticketNonce: freshNonce("new"), ipHash: randomIpHash(), origin: null,
      });
      expect(recorded).toBe(true);

      // One row on each side of the cutoff; only the new one should count.
      expect(await countWebSessionsForAccount(db, accountId, since)).toBe(1);
    });
  });
});
