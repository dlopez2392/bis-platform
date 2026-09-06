/**
 * Deletes e2e fixtures that a killed run left behind.
 *
 * The problem it solves: `auth.teardown.ts` is a Playwright teardown project,
 * so it runs only when a suite COMPLETES. Ctrl-C, a crashed dev server, or a
 * process-level timeout each strand a real Clerk user, a real Clerk org, real
 * Postgres rows, and a **public** object in Storage — in the shared dev
 * environment, permanently, because nothing else knows they exist. Two such
 * leftovers are on a human's to-do list right now, which is what makes this
 * worth building rather than remembering.
 *
 * Cleaning up BEFORE a run is what makes cleanup unconditional. Teardown stays
 * exactly as it is — it is still the fast path, and it deletes by known id
 * rather than by search.
 *
 * ⚠️ This runs against the SAME database, Clerk instance and bucket that hold
 * `Test Client One` and danlo's own identity. Every decision about what to
 * delete is delegated to `stale.ts`, which is pure and directly tested; this
 * module does no matching of its own. It also reports before it deletes, and
 * `dryRun` is the default at every entry point that a human can invoke.
 */
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb } from "@bis/db";
import {
  FIXTURE_ACCOUNT_RE, FIXTURE_EMAIL_RE, STALE_AFTER_MS,
  isStaleFixture, isUuid,
} from "./stale";

const BUCKET = "brand-logos";

// `@supabase/supabase-js` is a dependency of @bis/db, not of apps/web, so its
// types are not importable here — the client's type is taken from the factory
// that produces it instead.
type Db = ReturnType<typeof serviceDb>;

export type SweepReport = {
  accounts: Array<{ id: string; name: string }>;
  clerkUsers: Array<{ id: string; email: string }>;
  clerkOrgs: Array<{ id: string; name: string }>;
  orphanObjects: string[];
  errors: string[];
};

const empty = (): SweepReport =>
  ({ accounts: [], clerkUsers: [], clerkOrgs: [], orphanObjects: [], errors: [] });

/**
 * Child tables first, in the order teardown already proves works: `contacts`
 * and `events` have no ON DELETE behaviour on their `account_id` FK
 * (0003_crm_core.sql), and forms are the same shape. `checklist_items` is the
 * same shape again — no cascade on its `account_id` FK either (migration
 * 0007) — which is what stranded the account this entry exists to recover:
 * `setup.spec.ts` writes rows there, and a killed run (Ctrl-C, or a worker
 * process that dies before its own `afterAll` gets to run) can leave one
 * behind with nothing else in the suite able to clear it, making the account
 * PERMANENTLY undeletable by anything downstream of this FK. This project
 * has watched an unchecked delete fail SILENTLY and accumulate eleven
 * orphaned accounts, so every step reports its own error rather than letting
 * the caller assume.
 */
export async function deleteAccountCascade(
  db: Db, accountId: string, report: SweepReport,
): Promise<void> {
  // "bookings" then "calendars" FIRST (M13): migration 0017 made
  // bookings.account_id/calendar_id/contact_id and calendars.account_id all
  // `on delete restrict` — the same reason `withTestAccount`'s own cleanup
  // (packages/db/src/test/fixtures.ts) orders them first. Deleting contacts
  // before bookings, on a stale fixture account that ever booked anything,
  // would fail on the FK instead of sweeping the account.
  // "messages" then "conversations" before contacts, added when the booking
  // and calendar-settings journeys moved onto the fixture account
  // (2026-08-30): a web booking opens a conversation and appends messages,
  // and both sit FK-upstream of the contacts delete below. Exported so
  // auth.teardown.ts runs THIS list rather than a second copy that can
  // drift — the drift already happened once (teardown lacked these tables).
  for (const table of ["calls", "bookings", "messages", "conversations", "calendars",
                       "checklist_items", "form_submissions",
                       "forms", "contacts", "events", "voice_profiles", "phone_numbers",
                       "automations"]) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) report.errors.push(`${table} delete for ${accountId}: ${error.message}`);
  }
  const { error } = await db.from("accounts").delete().eq("id", accountId);
  if (error) report.errors.push(`accounts delete for ${accountId}: ${error.message}`);
}

/** Every object under one account's Storage prefix. */
async function removePrefix(
  db: Db, accountId: string, report: SweepReport, dryRun: boolean,
): Promise<string[]> {
  const { data, error } = await db.storage.from(BUCKET).list(accountId);
  if (error) {
    report.errors.push(`storage list ${accountId}: ${error.message}`);
    return [];
  }
  const paths = (data ?? []).map((o: { name: string }) => `${accountId}/${o.name}`);
  if (paths.length > 0 && !dryRun) {
    const { error: rmError } = await db.storage.from(BUCKET).remove(paths);
    // Postgres refuses `delete from storage.objects` ("Use the Storage API
    // instead"), which is why this goes through the Storage API and why SQL
    // could never clear the leftover that is on danlo's list.
    if (rmError) report.errors.push(`storage remove ${accountId}: ${rmError.message}`);
  }
  return paths;
}

/**
 * @param now         injected so the window is testable and so one sweep uses
 *                    a single clock for all four systems.
 * @param dryRun      true = report only. The default everywhere a human runs it.
 * @param maxAgeMs    how old a fixture must be before it is fair game.
 */
export async function sweepStaleFixtures({
  now = Date.now(), dryRun = true, maxAgeMs = STALE_AFTER_MS,
}: { now?: number; dryRun?: boolean; maxAgeMs?: number } = {}): Promise<SweepReport> {
  const report = empty();
  const db = serviceDb();

  // 1. Fixture accounts, matched by name and then by age.
  //
  // The `like` is a prefilter for the network, never the decision: `isStaleFixture`
  // is what admits a row, and it refuses "E2E Client Co-op 1786412389258",
  // which this pattern would happily return.
  const { data: accounts, error: accountsError } = await db
    .from("accounts").select("id, name, clerk_org_id").like("name", "E2E Client Co %");
  if (accountsError) {
    report.errors.push(`accounts select: ${accountsError.message}`);
  }
  const stale = (accounts ?? []).filter(
    (a: { name: string }) => isStaleFixture(a.name, FIXTURE_ACCOUNT_RE, now, maxAgeMs),
  ) as Array<{ id: string; name: string; clerk_org_id: string | null }>;

  for (const account of stale) {
    report.accounts.push({ id: account.id, name: account.name });
    const objects = await removePrefix(db, account.id, report, dryRun);
    report.orphanObjects.push(...objects);
    if (!dryRun) await deleteAccountCascade(db, account.id, report);
  }

  // 2. Clerk identities. Independent of step 1 on purpose: a run killed
  // between createUser and createAccount leaves a user with no account row,
  // so keying off accounts alone would never find it.
  const clerk = await clerkClient();
  try {
    const users = await clerk.users.getUserList({ query: "e2e-client-", limit: 100 });
    for (const user of users.data) {
      const email = user.emailAddresses[0]?.emailAddress ?? "";
      if (!isStaleFixture(email, FIXTURE_EMAIL_RE, now, maxAgeMs)) continue;
      report.clerkUsers.push({ id: user.id, email });
      if (!dryRun) await clerk.users.deleteUser(user.id);
    }
  } catch (e) {
    report.errors.push(`clerk users: ${String(e)}`);
  }

  try {
    const orgs = await clerk.organizations.getOrganizationList({ limit: 100 });
    for (const org of orgs.data) {
      if (!isStaleFixture(org.name, FIXTURE_ACCOUNT_RE, now, maxAgeMs)) continue;
      report.clerkOrgs.push({ id: org.id, name: org.name });
      if (!dryRun) await clerk.organizations.deleteOrganization(org.id);
    }
  } catch (e) {
    report.errors.push(`clerk orgs: ${String(e)}`);
  }

  // 3. Orphaned Storage objects — a prefix whose account row no longer
  // exists. Runs AFTER the deletes above so it also catches what they just
  // orphaned, and it is the only rule that can reach a leftover from an
  // account someone deleted by hand. Nothing in the product can render or
  // remove these, and the bucket is PUBLIC.
  const { data: prefixes, error: listError } = await db.storage.from(BUCKET).list();
  if (listError) {
    report.errors.push(`storage list root: ${listError.message}`);
  }
  for (const entry of prefixes ?? []) {
    // A folder entry, not a file: Supabase reports these with a null id.
    if (!isUuid(entry.name)) continue;
    const { data: account, error } = await db
      .from("accounts").select("id").eq("id", entry.name).maybeSingle();
    if (error) {
      report.errors.push(`accounts lookup ${entry.name}: ${error.message}`);
      continue;
    }
    // An account that still exists owns its logo, whatever its age. This is
    // the rule that keeps a real client's brand out of the sweep.
    if (account) continue;
    const objects = await removePrefix(db, entry.name, report, dryRun);
    report.orphanObjects.push(...objects);
  }

  return report;
}

export function formatSweepReport(report: SweepReport, dryRun: boolean): string {
  const verb = dryRun ? "would delete" : "deleted";
  const lines = [
    `e2e fixture sweep — ${verb}:`,
    `  accounts:        ${report.accounts.length}`,
    ...report.accounts.map((a) => `    ${a.name} (${a.id})`),
    `  clerk users:     ${report.clerkUsers.length}`,
    ...report.clerkUsers.map((u) => `    ${u.email} (${u.id})`),
    `  clerk orgs:      ${report.clerkOrgs.length}`,
    ...report.clerkOrgs.map((o) => `    ${o.name} (${o.id})`),
    `  storage objects: ${report.orphanObjects.length}`,
    ...report.orphanObjects.map((p) => `    ${p}`),
  ];
  if (report.errors.length > 0) {
    lines.push(`  errors: ${report.errors.length}`, ...report.errors.map((e) => `    ${e}`));
  }
  return lines.join("\n");
}
