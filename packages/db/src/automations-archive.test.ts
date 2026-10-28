import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDueReviewRequestById, getDueNoShowNudgeById, getDueReferralAskById, getDueQuoteFollowupById,
  getDueReactivationById, getDueSmsReminderById, getDueAppointmentConfirmById,
} from "./automations";
import { getDueFollowupById, getDueReminderById } from "./booking";

/** Same shape as T4's `recordingDb` (contacts-archive.test.ts), with one fix:
 *  a chain that called `.maybeSingle()` defaults to `null` (real PostgREST's
 *  "Accept: application/vnd.pgrst.object+json" answers null on no match, not
 *  `[]`), so a by-id read's `if (!data)` branch is reachable without a seeded
 *  answer. T4's by-table-only version never calls `.maybeSingle()` in its own
 *  tests, so this never showed there; every by-id read here does, and without
 *  this fix the first probed assertion passed for the wrong reason (the real
 *  `.is(...)` filter call was still asserted correctly, but the second
 *  assertion compared against an array, not null, and got `why: "off"` from
 *  `enabledRecipeFor`'s `[] ?? null` instead of `why: "gone"` from the
 *  `if (!data)` branch the plan names). */
function recordingDb(answers: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const chainFor = (table: string): unknown => {
    let single = false;
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const seeded = Object.prototype.hasOwnProperty.call(answers, table);
            const data = seeded ? answers[table] : (single ? null : []);
            return Promise.resolve({ data, error: null, count: 0 }).then(res, rej);
          };
        }
        if (method === "maybeSingle") single = true;
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const rpcAnswers: Record<string, unknown> = { ...rpc };
  const db = {
    from: (table: string) => chainFor(table),
    rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { data: rpcAnswers[fn] ?? null, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls, rpcs, rpcAnswers };
}
const has = (calls: { method: string; args: unknown[] }[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

const STARTS_A_CONVERSATION = [
  ["getDueReviewRequestById", getDueReviewRequestById, "contacts.archived_at"],
  ["getDueNoShowNudgeById", getDueNoShowNudgeById, "contacts.archived_at"],
  ["getDueReferralAskById", getDueReferralAskById, "contacts.archived_at"],
  ["getDueQuoteFollowupById", getDueQuoteFollowupById, "contacts.archived_at"],
  ["getDueFollowupById", getDueFollowupById, "contacts.archived_at"],
  ["getDueReactivationById", getDueReactivationById, "archived_at"],
] as const;
const KEEPS_A_PROMISE = [
  ["getDueSmsReminderById", getDueSmsReminderById],
  ["getDueAppointmentConfirmById", getDueAppointmentConfirmById],
  ["getDueReminderById", getDueReminderById],
] as const;

describe("ruling Q2: archived means no new conversation, and promises already made are kept", () => {
  it.each(STARTS_A_CONVERSATION)("%s reads only contacts that are not archived (mutation: drop its .is filter -> FAILS)", async (_n, fn, col) => {
    const { db, calls } = recordingDb();
    const r = await fn(db, "id-1");
    expect(has(calls, "is", col, null)).toBe(true);
    expect(r).toEqual({ due: null, why: "gone" });
  });
  it.each(KEEPS_A_PROMISE)("%s still reads an archived contact's appointment (mutation: add the filter here -> FAILS)", async (_n, fn) => {
    const { db, calls } = recordingDb();
    await fn(db, "id-1");
    expect(calls.some((c) => JSON.stringify(c.args).includes("archived_at"))).toBe(false);
  });
});
