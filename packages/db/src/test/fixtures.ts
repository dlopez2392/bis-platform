import "dotenv/config";
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { createAccount } from "../accounts";
import { deleteAccountCascade } from "../account-teardown";

/** Every number this process has already handed out. Two calls in one run can
 *  therefore never match, independently of how the draw goes. */
const issuedPhoneNumbers = new Set<string>();

/**
 * A phone number no other run in this project is holding.
 *
 * `phone_numbers.e164` is unique across EVERY account (`0019_voice_core.sql`:
 * `e164 text not null unique`), not per account — the same number cannot route
 * to two tenants, so that constraint is right and stays. What is wrong is a
 * test writing a FIXED literal into it: it passes only while it is the only
 * run in the project, and the second run loses on
 * `phone_numbers_e164_key` — or, where the insert's error goes unchecked, on a
 * null dereference three lines later that names nothing at all.
 *
 * Shape: `+999` and twelve random digits, fifteen in total, which is E.164's
 * ceiling and the `phone_numbers_e164_check` ceiling with it. Country code 999
 * is assigned to no country and no service, so this is a KEY shaped like a
 * number rather than a number anybody can dial — the property that matters for
 * a row that lives, however briefly, in the one Supabase project production
 * also uses.
 *
 * It deliberately does not borrow from the demo's `+1 956 555 01xx`. That
 * block is a hundred numbers and `demo/fiction.ts` already partitions all of
 * them — ten business lines, forty contacts, fifty callers — while
 * `voice.test.ts` alone needs a dozen `phone_numbers` rows standing at once.
 * Taking from it would mean widening the fiction rules, and those rules are
 * what keep a real person's number out of the demo.
 *
 * A trillion draws, plus the set above, is why "unique per run" is a claim
 * rather than a hope: two runs of a suite that writes fifteen numbers each
 * meet with probability about 2 in 10^10.
 */
export function testPhoneNumber(): string {
  for (let attempt = 0; attempt < 16; attempt++) {
    const n = `+999${String(randomInt(0, 1_000_000_000_000)).padStart(12, "0")}`;
    if (!issuedPhoneNumbers.has(n)) {
      issuedPhoneNumbers.add(n);
      return n;
    }
  }
  throw new Error("testPhoneNumber: 16 draws in a row were already issued");
}

/** Creates a throwaway account, runs fn, then deletes everything it owns (FK order).
 *
 *  The FK order itself lives in `../account-teardown`, shared with the demo
 *  tenant's re-seed, which needs the identical list for the identical reason.
 *  It was inlined here until there was a second caller. */
export async function withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Fixture Co", actorId: "user_test" });
  try {
    await fn(db, id);
  } finally {
    await deleteAccountCascade(db, id, "withTestAccount");
  }
}
