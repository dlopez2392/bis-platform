import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { assignPhoneNumber, getDisclosureResults } from "../voice";

type Row = {
  disclosed: boolean | null; setting: "trial" | "on" | null; outcome: string; ended: boolean; asked?: boolean;
};

async function seedCalls(db: SupabaseClient, accountId: string, rows: Row[]): Promise<void> {
  const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
  const { error } = await db.from("calls").insert(rows.map((r) => ({
    account_id: accountId, phone_number_id: num.id,
    disclosed: r.disclosed, disclosure_setting: r.setting, outcome: r.outcome,
    ended_at: r.ended ? "2026-10-20T15:00:00Z" : null,
    handoff_requested_at: r.asked ? "2026-10-20T14:59:00Z" : null,
  })));
  if (error) throw new Error(`seed calls failed: ${error.message}`);
}

const A: Row[] = [
  // Trial, said it: 5 counted — 2 booked, 1 hung up, 1 asked for a person (outcome abandoned: a handed-off
  // call classifies abandoned at socket close), 1 lead — plus 1 spam and 1 still in progress.
  { disclosed: true, setting: "trial", outcome: "booked", ended: true },
  { disclosed: true, setting: "trial", outcome: "booked", ended: true },
  { disclosed: true, setting: "trial", outcome: "abandoned", ended: true },
  { disclosed: true, setting: "trial", outcome: "abandoned", ended: true, asked: true },
  { disclosed: true, setting: "trial", outcome: "lead", ended: true },
  { disclosed: true, setting: "trial", outcome: "spam", ended: true },
  { disclosed: true, setting: "trial", outcome: "abandoned", ended: false },
  // Trial, didn't: 3 counted (3 hung up), plus 1 spam.
  { disclosed: false, setting: "trial", outcome: "abandoned", ended: true },
  { disclosed: false, setting: "trial", outcome: "abandoned", ended: true },
  { disclosed: false, setting: "trial", outcome: "abandoned", ended: true },
  { disclosed: false, setting: "trial", outcome: "spam", ended: true },
  // On (D5): outside the trial — never in a half, always in the footnote.
  { disclosed: true, setting: "on", outcome: "booked", ended: true },
  { disclosed: true, setting: "on", outcome: "abandoned", ended: true },
  // Before the trial / an Off account: 2 finished, 1 in progress (A7: never counted anywhere).
  { disclosed: null, setting: null, outcome: "booked", ended: true },
  { disclosed: null, setting: null, outcome: "message", ended: true },
  { disclosed: null, setting: null, outcome: "abandoned", ended: false },
];

describe("getDisclosureResults", () => {
  it("counts finished Trial-stamped non-spam calls per half; spam, On, unstamped and unfinished are excluded; asking for a person is not hanging up (D5, D6; mutations: drop .eq('disclosure_setting','trial') → FAILS; drop .neq('outcome','spam') → FAILS; drop the ended_at filter → FAILS; drop .is('handoff_requested_at', null) from abandoned → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId, A);
      expect(await getDisclosureResults(db, accountId)).toEqual({
        said: { counted: 5, booked: 2, abandoned: 1, askedPerson: 1 },
        didnt: { counted: 3, booked: 0, abandoned: 3, askedPerson: 0 },
        notCounted: 6, // 1 spam (said) + 1 spam (didn't) + 2 On + 2 finished unstamped
      });
    });
  });

  it("another account's stamped calls are never counted (mutation: drop .eq('account_id') → FAILS)", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        await seedCalls(db, accountA, [{ disclosed: true, setting: "trial", outcome: "booked", ended: true }]);
        await seedCalls(db, accountB, A);
        expect(await getDisclosureResults(db, accountA)).toEqual({
          said: { counted: 1, booked: 1, abandoned: 0, askedPerson: 0 },
          didnt: { counted: 0, booked: 0, abandoned: 0, askedPerson: 0 },
          notCounted: 0,
        });
      });
    });
  });

  it("an account with no calls reads all zeros", async () => {
    await withTestAccount(async (db, accountId) => {
      const zero = { counted: 0, booked: 0, abandoned: 0, askedPerson: 0 };
      expect(await getDisclosureResults(db, accountId)).toEqual({ said: zero, didnt: zero, notCounted: 0 });
    });
  });
});
