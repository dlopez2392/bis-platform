/**
 * Seeds the demo tenant. `pnpm --filter @bis/db db:seed-demo`.
 *
 * Deliberately NOT wired into CI, `pnpm check`, or any deploy. It writes to
 * whichever Supabase project `SUPABASE_SERVICE_ROLE_KEY` points at, which
 * today is the same project production runs on, so it is a thing a person
 * runs on purpose and never a thing that happens as a side effect.
 *
 * Re-running is safe and is the intended way to refresh the demo: the
 * previous demo account is dropped and rebuilt from the same seed, so the
 * board is identical apart from being anchored to a newer "now".
 */
import "dotenv/config";
import { serviceDb } from "../service";
import { seedDemoTenant } from "./seed";
import { DEMO_ORG_ID, DEMO_ACCOUNT_NAME } from "./fiction";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing — this needs a .env with service credentials");

  // Says which database, out loud, before touching it. There is one Supabase
  // project behind both the demo and production, so "which one is this" is
  // never a question the operator should have to infer from a prompt.
  console.log(`Seeding ${DEMO_ACCOUNT_NAME} (${DEMO_ORG_ID})`);
  console.log(`  into ${url}`);

  const result = await seedDemoTenant(serviceDb());

  console.log(result.replacedExisting
    ? `\n  replaced the previous demo account`
    : `\n  created a new demo account`);
  console.log(`  account id ${result.accountId}`);
  for (const [what, n] of Object.entries(result.counts)) {
    console.log(`  ${String(n).padStart(4)}  ${what}`);
  }
  console.log(`\n  outbound_suppressed = true — no pass will act on this account.`);
}

main().catch((e) => {
  console.error(`\ndemo seed FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
