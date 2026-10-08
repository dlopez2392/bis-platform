import { randomInt } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../e2e/fixtures/production-guard";

// Same discipline as the file's two siblings (actions.test.ts,
// actions.returning-lead.test.ts): apps/web's test script runs with this
// directory as cwd, and its credentials live in `.env.local`.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/reports/weekly-metrics.live.test.ts");

import {
  serviceDb, createAccount, deleteAccountCascade,
  createForm, assignPhoneNumber,
} from "@bis/db";
import { listLeadInstantsBetween } from "./weekly-metrics";

/**
 * I2 (review of 5c5e20e5): two mutations to the call half survived every
 * MOCKED test — `started_at` swapped for `created_at`, and dropping
 * `.eq("account_id", …)` — because a mock never proves what the real
 * database actually returns for a real filter. This is the one LIVE test:
 * a real submission, a spam submission (excluded), a lead call, a
 * non-lead call (excluded), a lead call whose `created_at` sits INSIDE the
 * window but whose `started_at` sits OUTSIDE it (excluded — proves the
 * filter column), both `[from, to)` edges, and a second account's rows
 * (excluded — proves the account scope an agency viewer's dashboard
 * depends on). Same shape as `booking.test.ts`'s `listBookingCreationsBetween`
 * suite (packages/db), just run from apps/web since `listLeadInstantsBetween`
 * lives here — `@bis/db`'s own test fixtures are not a public subpath
 * (`f/[publicId]/actions.returning-lead.test.ts`'s own comment), so this
 * file defines its own throwaway-account helper the same way that one does.
 */
async function withTestAccount(fn: (accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id: accountId } = await createAccount(
    db, { clerkOrgId: orgId, name: "Fixture Co (weekly-metrics live)", actorId: "user_test" });
  try {
    await fn(accountId);
  } finally {
    await deleteAccountCascade(db, accountId, "lib/reports/weekly-metrics.live.test.ts");
  }
}

/** A fake E.164 — the same `+999` + twelve random digits `testPhoneNumber()`
 *  (packages/db's own fixtures, not importable here) uses, so this can never
 *  collide with a real number. It used to be `+999${Date.now()}${random}`
 *  cut to 15 characters, which cut the random part off entirely: what was
 *  left was the clock in tenths of a second, so numA and numB, assigned one
 *  round trip apart, matched whenever that trip took under 100 ms, and
 *  `phone_numbers_e164_key` failed `verify` on main (run 37810478057). */
function fakePhoneNumber(): string {
  return `+999${String(randomInt(0, 1_000_000_000_000)).padStart(12, "0")}`;
}

beforeAll(() => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing — this suite needs apps/web/.env.local");
  }
});

describe("listLeadInstantsBetween (live DB) — the one function both the weekly report and the dashboard hero read", () => {
  it("real submission in; spam out; lead call in; non-lead call out; started_at (not created_at) is the filtered column; both [from, to) edges; a second account's rows never leak in", async () => {
    const db = serviceDb();
    const FROM = "2027-04-01T00:00:00.000Z";
    const TO = "2027-04-08T00:00:00.000Z";

    await withTestAccount(async (accountA) =>
      withTestAccount(async (accountB) => {
        const { id: formA } = await createForm(db, accountA, { name: "Weekly", fields: [] }, "user_test");
        const { id: formB } = await createForm(db, accountB, { name: "Weekly", fields: [] }, "user_test");
        const numA = await assignPhoneNumber(db, accountA, { e164: fakePhoneNumber() }, "user_test");
        const numB = await assignPhoneNumber(db, accountB, { e164: fakePhoneNumber() }, "user_test");

        const seedSubmission = async (
          accountId: string, formId: string, createdAt: string, spamReason: string | null,
        ) => {
          const { error } = await db.from("form_submissions").insert({
            account_id: accountId, form_id: formId, answers: [], attribution: {},
            spam_reason: spamReason, created_at: createdAt,
          });
          if (error) throw new Error(`seed submission failed: ${error.message}`);
        };
        const seedCall = async (
          accountId: string, phoneNumberId: string, outcome: string, startedAt: string, createdAt?: string,
        ) => {
          const { error } = await db.from("calls").insert({
            account_id: accountId, phone_number_id: phoneNumberId,
            outcome, started_at: startedAt, created_at: createdAt ?? startedAt, caller_e164: null,
          });
          if (error) throw new Error(`seed call failed: ${error.message}`);
        };

        // Account A — the window under test.
        await seedSubmission(accountA, formA, FROM, null);                      // IN: inclusive `from` edge
        await seedSubmission(accountA, formA, "2027-04-03T12:00:00.000Z", null); // IN: mid-window, real
        await seedSubmission(accountA, formA, "2027-04-04T12:00:00.000Z", "honeypot"); // OUT: spam
        await seedSubmission(accountA, formA, TO, null);                        // OUT: exclusive `to` edge
        await seedCall(accountA, numA.id, "lead", "2027-04-05T12:00:00.000Z");  // IN: mid-window lead call
        await seedCall(accountA, numA.id, "booked", "2027-04-05T13:00:00.000Z"); // OUT: not a lead outcome
        // started_at OUTSIDE the window, created_at INSIDE it — must be
        // excluded, proving the filter is on started_at, not created_at.
        await seedCall(accountA, numA.id, "lead", "2027-03-25T00:00:00.000Z", "2027-04-02T00:00:00.000Z");
        await seedCall(accountA, numA.id, "lead", TO);                         // OUT: exclusive `to` edge

        // Account B — same window, must never leak into A's result.
        await seedSubmission(accountB, formB, "2027-04-03T12:00:00.000Z", null);
        await seedCall(accountB, numB.id, "lead", "2027-04-05T12:00:00.000Z");

        const result = await listLeadInstantsBetween(db, accountA, FROM, TO);

        expect(result).toHaveLength(3);
        const times = result.map((s) => new Date(s).getTime()).sort((a, b) => a - b);
        expect(times).toEqual([
          new Date(FROM).getTime(),
          new Date("2027-04-03T12:00:00.000Z").getTime(),
          new Date("2027-04-05T12:00:00.000Z").getTime(),
        ].sort((a, b) => a - b));
      }),
    );
  }, 60_000); // two real fixture accounts + inserts against the CI project: well past the 5 s default
});
