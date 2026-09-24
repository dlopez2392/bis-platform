import { describe, it, expect, beforeAll } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { deleteAccountCascade } from "../account-teardown";
import { assertCiTarget } from "../ci/target";
import { testPhoneNumber } from "../test/fixtures";
import { ensureCiBaseline, readBaselineSnapshot, baselineGaps } from "./seed";
import type { CiBaselineSpec } from "./config";

/**
 * `ensureCiBaseline` run twice against a LIVE project: the first run creates
 * the baseline, the second finds it and writes nothing — not one row, not one
 * event — and both leave `baselineGaps` empty.
 *
 * GATED OUT OF `pnpm check` BY ITS NAME. `*.integration.test.ts` is excluded
 * by vitest.config.ts (the config `pnpm check` runs) and included only by
 * vitest.integration.config.ts (`pnpm --filter @bis/db test:integration`),
 * which no workflow and no root script invokes. It is the repo's existing
 * convention for suites that need a real project, not a new env switch.
 *
 * CI PROJECT ONLY, enforced: `beforeAll` runs the same guard as `ci:seed`, so
 * with production's env (every developer's today, until the local switch) it
 * FAILS rather than seeding production. It does not skip there: a skip reads
 * as "fine" in a summary, and running this against production is a mistake
 * worth a red line. It skips only when there are no credentials at all, and
 * says so loudly, like user-client.integration.test.ts.
 *
 * Never the real seeded account: a random name, an `org_test_ciseed_` org the
 * fixture sweep reclaims an hour later if this run is killed, and a `+999`
 * key-shaped number (test/fixtures.ts testPhoneNumber).
 */
const hasCredentials =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!hasCredentials) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[ci-seed/seed.integration.test.ts] SKIPPED: missing NEXT_PUBLIC_SUPABASE_URL and/or " +
      "SUPABASE_SERVICE_ROLE_KEY. This suite proves ci:seed is idempotent against the CI project " +
      "and cannot run hermetically -- a skip here is NOT a pass.\n",
  );
}

/** Rows the baseline writes, per table, plus its events: a second run must change none of them. */
async function counts(db: SupabaseClient, accountId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ["contacts", "pipelines", "pipeline_stages", "custom_fields", "opportunities", "phone_numbers", "events"]) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("account_id", accountId);
    if (error) throw new Error(`count ${table} failed: ${error.message}`);
    out[table] = count ?? 0;
  }
  return out;
}

describe.skipIf(!hasCredentials)("ensureCiBaseline (live, CI project only)", () => {
  beforeAll(() => {
    // Throws, naming why, unless this env is the CI project.
    assertCiTarget({
      ref: process.env.BIS_CI_SUPABASE_REF,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      dbUrl: process.env.SUPABASE_DB_URL,
    });
  });

  it("creates the baseline once, then finds it and writes nothing", async () => {
    const db = serviceDb();
    const tag = Math.random().toString(36).slice(2, 10);
    const spec: CiBaselineSpec = {
      name: `CI Seed Test ${tag}`,
      clerkOrgId: `org_test_ciseed_${tag}`,
      phoneE164: testPhoneNumber(),
    };
    try {
      const first = await ensureCiBaseline(db, spec);
      expect(first.created).toEqual(["account", "pipeline", "contact", "custom field", "opportunity", "phone number"]);
      expect(baselineGaps(await readBaselineSnapshot(db, spec), spec)).toEqual([]);
      const afterFirst = await counts(db, first.accountId);

      const second = await ensureCiBaseline(db, spec);
      expect(second.accountId).toBe(first.accountId);
      expect(second.created).toEqual([]);
      expect(await counts(db, first.accountId)).toEqual(afterFirst);
      expect(baselineGaps(await readBaselineSnapshot(db, spec), spec)).toEqual([]);
    } finally {
      // By org id, not by the first run's return value: if the first run threw
      // after creating the account, the id never came back.
      const { data } = await db.from("accounts").select("id").eq("clerk_org_id", spec.clerkOrgId).maybeSingle();
      if (data) await deleteAccountCascade(db, data.id as string, "ci-seed idempotence");
    }
  }, 60_000);
});
