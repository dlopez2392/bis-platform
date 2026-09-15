import { describe, it, expect } from "vitest";
import { testPhoneNumber, testProviderMessageId } from "./fixtures";

/**
 * The harness's own test — no database, no network. `fixtures.ts` imports
 * `serviceDb`, but nothing here calls it, so this file runs in milliseconds
 * beside the live suites.
 *
 * WHY THE HELPER EXISTS
 *
 * `phone_numbers.e164` is unique across EVERY account in the project
 * (`0019_voice_core.sql`: `e164 text not null unique`), so a fixed literal in
 * it is a test that passes only while it is the only run in the project. That
 * is not a hypothetical: running `work-queue.test.ts` twice at once, one run
 * passed and the other died on
 * `duplicate key value violates unique constraint "phone_numbers_e164_key"`,
 * and running `voice.test.ts` twice at once failed 15 tests between the two
 * processes on the same constraint.
 *
 * The complete set of unique indexes in this schema that do NOT include
 * `account_id`, read from `pg_index` on 2026-09-15, is: `accounts.clerk_org_id`,
 * `users.clerk_user_id`, `phone_numbers.e164`, `phone_numbers.telnyx_id`
 * (partial), `sites.vercel_project_id`, `calendars.public_id`,
 * `forms.public_id`, `bookings.cancel_token`, `messages.provider_message_id`
 * (partial), `blueprints (agency_id, name)`, and the primary keys. Of those a
 * db test writes by hand: `clerk_org_id` (randomised by `withTestAccount`),
 * `vercel_project_id` (derived per account in `sites.test.ts`), `e164` (this
 * helper), the blueprint name (PR 58) and `provider_message_id`
 * (`testProviderMessageId`, below — `messaging.test.ts` held about two dozen
 * fixed literals until it did). The public ids and the cancel token are random
 * defaults; `telnyx_id` is written by no test at all; the two partial indexes
 * ignore NULL.
 *
 * Re-read from `pg_index` on 2026-09-15 after the messaging fix, that list is
 * unchanged and no COMMITTED write of a project-wide unique value from a fixed
 * literal is left in this package. What remains is the weaker relative:
 * `rls.test.ts`, `sites-grants.test.ts`, `automations-grants.test.ts` and
 * `forms.test.ts` seed fixed `clerk_org_id` / `vercel_project_id` /
 * `forms.public_id` values (`org_A`, `prj_A`, `aaaaaaaaaaaa`, …) inside
 * `withRollback`, which never commits. Two runs there do not collide — the
 * second BLOCKS on the unique index until the first transaction rolls back,
 * so the cost is wall clock, not a duplicate key.
 */
describe("testPhoneNumber", () => {
  /** Read from the live database on 2026-09-15:
   *  `phone_numbers_e164_check` is `CHECK ((e164 ~ '^\+[0-9]{8,15}$'))`. */
  const E164_CHECK = /^\+[0-9]{8,15}$/;

  it("satisfies the check constraint the column actually carries", () => {
    for (let i = 0; i < 100; i++) expect(testPhoneNumber()).toMatch(E164_CHECK);
  });

  it("hands out a distinct number every time, so one run never collides with itself", () => {
    const issued = Array.from({ length: 2000 }, () => testPhoneNumber());
    expect(new Set(issued).size).toBe(issued.length);
  });

  it("draws at random, so two runs at once do not walk the same sequence", () => {
    // The distinctness test above passes for a plain counter — and a counter
    // is exactly the version that still collides, because two processes both
    // start it at zero. This is the assertion a counter fails.
    const issued = Array.from({ length: 50 }, () => testPhoneNumber());
    expect(issued).not.toEqual([...issued].sort());
    expect(new Set(issued.map((n) => n.slice(0, 8))).size).toBeGreaterThan(1);
  });

  it("stays outside every dialling plan, and outside the demo's reserved block", () => {
    const n = testPhoneNumber();
    // ITU-T E.164 assigns country code 999 to no country and no service, and
    // 15 digits is E.164's ceiling — so this is a KEY shaped like a number,
    // not a number anybody can dial, which is the property that matters for a
    // row living in the one project production also uses.
    expect(n.startsWith("+999")).toBe(true);
    expect(n).not.toMatch(/^\+1/);
    // "+" and 15 digits. A NANP number is "+" and 11, so this is not one.
    expect(n).toHaveLength(16);
    // And deliberately NOT the demo's +1 956 555 01xx: that block is 100
    // numbers, fully partitioned by `demo/fiction.ts` between the seeder's
    // ten business lines, forty contacts and fifty callers. `voice.test.ts`
    // alone needs a dozen `phone_numbers` rows at once, so borrowing from it
    // would mean widening the fiction rules, which is the one thing that must
    // not happen to keep real numbers out of demo data.
    expect(n).not.toMatch(/^\+195655501\d{2}$/);
  });
});

describe("testProviderMessageId", () => {
  it("hands out a distinct id every time, so one run never collides with itself", () => {
    const issued = Array.from({ length: 2000 }, () => testProviderMessageId());
    expect(new Set(issued).size).toBe(issued.length);
  });

  it("draws at random, so two runs at once do not walk the same sequence", () => {
    // Same reasoning as the phone helper's: distinctness alone is satisfied by
    // a per-process counter, and a counter is precisely the version that still
    // collides, because both processes start it at the same place. These are
    // the two assertions a counter fails.
    const issued = Array.from({ length: 50 }, () => testProviderMessageId());
    expect(issued).not.toEqual([...issued].sort());
    expect(new Set(issued.map((id) => id.slice(10, 14))).size).toBeGreaterThan(1);
  });

  it("is obviously test-shaped, so nobody reads a stranded row as a real provider id", () => {
    const id = testProviderMessageId();
    // These rows live, however briefly, in the one Supabase project production
    // also uses, and `updateMessageStatusByProviderId` looks messages up by
    // this column with NO tenant context at all. Anyone who meets one of these
    // values has to be able to see at a glance that a test wrote it.
    expect(id.startsWith("test_prov_")).toBe(true);
    // Telnyx and Resend both hand out UUIDs, so this deliberately is not one.
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    // "test_prov_" and twelve digits.
    expect(id).toHaveLength(22);
    expect(id.slice(10)).toMatch(/^[0-9]{12}$/);
  });
});
