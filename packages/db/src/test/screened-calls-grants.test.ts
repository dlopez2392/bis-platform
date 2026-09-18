import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * 0039_screened_calls.sql — the proof that only the server touches this table.
 *
 * The design's audience decision ("agency-only") is enforced by GRANTS rather
 * than by a row policy, which is the stronger of the two: with no grant to
 * `authenticated`, a client gets permission denied instead of zero rows, and
 * no future query that forgets a filter can leak anything.
 */
describe("screened_calls grants", () => {
  it("a client cannot read the table at all — permission denied, not zero rows (mutation: grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query("select * from public.screened_calls"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("an AGENCY user cannot read it through the user client either (mutation: add an is_agency policy plus a select grant to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      // `app.is_agency()` is `app_role = 'agency_admin'` (0001), so this is
      // what an agency session actually looks like. NOT `actAsOwner`, which
      // does `reset role` — the table owner bypasses grants entirely and
      // would read the table happily, passing this test for a reason that has
      // nothing to do with the property being asserted.
      //
      // Deliberate and worth pinning: the agency reads this table through
      // serviceDb() behind requireAgency(), never through the user client. If
      // that ever changes, this is where the decision gets revisited rather
      // than silently widened.
      await actAs(c, { app_role: "agency_admin" });
      await expect(
        c.query("select * from public.screened_calls"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot insert either (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query(
          "insert into public.screened_calls (called_e164, reason) values ('+19565550100','repeat-spam')",
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("refuses a reason outside the six (mutation: drop screened_calls_reason_check -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(
        c.query(
          "insert into public.screened_calls (called_e164, reason) values ('+19565550100','made-up')",
        ),
      ).rejects.toThrow(/screened_calls_reason_check/);
    }));

  it("accepts a row with NO account and NO phone number — the wrong-number case (mutation: make account_id NOT NULL -> FAILS)", () =>
    withRollback(async (c) => {
      // The case `calls` structurally cannot hold, and the reason this table
      // exists in its own right rather than as a view over calls.
      const { rows } = await c.query(
        "insert into public.screened_calls (called_e164, caller_e164, reason) values ('+19565550100','+19565550111','unknown-number') returning id, account_id, phone_number_id",
      );
      expect(rows[0].account_id).toBeNull();
      expect(rows[0].phone_number_id).toBeNull();
    }));
});
