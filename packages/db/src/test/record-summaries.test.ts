import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getRecordSummary, claimRecordSummary, saveRecordSummary, releaseRecordSummaryLease } from "../record-summaries";

/** Item 8a-2 (spec 4.5): the wrappers over 0087, through PostgREST, on the service client. */
const D1 = "1".repeat(64);
const D2 = "2".repeat(64);
const AT = "2026-10-18T14:42:00.000Z";
const person = async (db: SupabaseClient, accountId: string) => (await createContact(db, accountId, { firstName: "Ana" }, "user_test")).id;

describe("record summaries", () => {
  it("claim, save, read back, then fresh; a forced claim wins (mutations: save without .eq('lease_id') AND a wrong lease writes -> FAILS; read without .eq('language') -> the es read answers the en row -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const contactId = await person(db, accountId);
      const k = { accountId, contactId, language: "en" as const };
      expect(await getRecordSummary(db, k)).toBeNull();
      const won = await claimRecordSummary(db, { ...k, digest: D1, force: false });
      expect(won.status).toBe("won");
      const leaseId = (won as { leaseId: string }).leaseId;
      expect(await claimRecordSummary(db, { ...k, digest: D1, force: false })).toEqual({ status: "busy" });
      expect(await saveRecordSummary(db, { ...k, leaseId: "00000000-0000-4000-8000-000000000000", body: "Wrong lease.", digest: D1, model: "gpt-4o-mini", generatedAt: AT })).toBe(false);
      expect(await saveRecordSummary(db, { ...k, leaseId, body: "Booked for Tuesday.", digest: D1, model: "gpt-4o-mini", generatedAt: AT })).toBe(true);
      expect(await getRecordSummary(db, k)).toEqual({ body: "Booked for Tuesday.", inputDigest: D1, model: "gpt-4o-mini", generatedAt: "2026-10-18T14:42:00+00:00" });
      expect(await getRecordSummary(db, { ...k, language: "es" })).toBeNull();
      expect(await claimRecordSummary(db, { ...k, digest: D1, force: false })).toEqual({ status: "fresh" });
      expect((await claimRecordSummary(db, { ...k, digest: D1, force: true })).status).toBe("won");
    }));

  it("release clears only its own lease, so the next claim wins at once (mutation: release without .eq('lease_id') -> the wrong-lease release clears the live one -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const contactId = await person(db, accountId);
      const k = { accountId, contactId, language: "es" as const };
      const won = await claimRecordSummary(db, { ...k, digest: D2, force: false }) as { status: "won"; leaseId: string };
      await releaseRecordSummaryLease(db, { ...k, leaseId: "00000000-0000-4000-8000-000000000000" });
      expect(await claimRecordSummary(db, { ...k, digest: D2, force: false })).toEqual({ status: "busy" });
      await releaseRecordSummaryLease(db, { ...k, leaseId: won.leaseId });
      expect((await claimRecordSummary(db, { ...k, digest: D2, force: false })).status).toBe("won");
    }));

  it("another account's id never reads this account's row (second-account case; mutation: drop getRecordSummary's .eq('account_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (_db2, otherId) => {
        const contactId = await person(db, accountId);
        const won = await claimRecordSummary(db, { accountId, contactId, language: "en", digest: D1, force: false }) as { status: "won"; leaseId: string };
        await saveRecordSummary(db, { accountId, contactId, language: "en", leaseId: won.leaseId, body: "Ours.", digest: D1, model: "gpt-4o-mini", generatedAt: AT });
        expect(await getRecordSummary(db, { accountId: otherId, contactId, language: "en" })).toBeNull();
      })));

  it("another account's id with this account's real contact and live lease neither saves nor releases it (second-account case; mutations: drop saveRecordSummary's .eq('account_id') -> the save returns true -> FAILS; drop releaseRecordSummaryLease's .eq('account_id') -> the next claim wins -> FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (_db2, otherId) => {
        const contactId = await person(db, accountId);
        const k = { accountId, contactId, language: "en" as const };
        const won = await claimRecordSummary(db, { ...k, digest: D1, force: false }) as { status: "won"; leaseId: string };
        const wrong = { ...k, accountId: otherId, leaseId: won.leaseId };
        expect(await saveRecordSummary(db, { ...wrong, body: "Not ours.", digest: D1, model: "gpt-4o-mini", generatedAt: AT })).toBe(false);
        await releaseRecordSummaryLease(db, wrong);
        expect(await claimRecordSummary(db, { ...k, digest: D1, force: false })).toEqual({ status: "busy" });
        expect(await getRecordSummary(db, k)).toEqual({ body: null, inputDigest: null, model: null, generatedAt: null });
      })));

  it("an answer of the wrong shape throws, never reads as won (mutation: accept any status -> FAILS)", async () => {
    const rpcAnswering = (data: unknown) => ({ rpc: () => Promise.resolve({ data, error: null }) }) as unknown as SupabaseClient;
    const k = { accountId: "a", contactId: "c", language: "en" as const, digest: D1, force: false };
    await expect(claimRecordSummary(rpcAnswering({ status: "won" }), k)).rejects.toThrow("claimRecordSummary: unexpected answer");
    await expect(claimRecordSummary(rpcAnswering({ status: "won", lease_id: "not-a-uuid" }), k)).rejects.toThrow("claimRecordSummary: unexpected answer");
    await expect(claimRecordSummary(rpcAnswering({ status: "maybe" }), k)).rejects.toThrow("claimRecordSummary: unexpected answer");
    await expect(claimRecordSummary(rpcAnswering(null), k)).rejects.toThrow("claimRecordSummary: unexpected answer");
    expect(await claimRecordSummary(rpcAnswering({ status: "too_soon" }), k)).toEqual({ status: "too_soon" });
  });
});
