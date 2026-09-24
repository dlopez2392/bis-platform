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
import { serviceDb, ACCOUNT_OWNED_TABLES } from "@bis/db";
import {
  FIXTURE_BLUEPRINT_PREFILTER, FIXTURE_EMAIL_RE, FIXTURE_NAME_PREFILTER, STALE_AFTER_MS,
  isStaleFixture, isStaleFixtureAccount, isStaleFixtureBlueprint, isStaleFixtureForm, isUuid,
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
  strandedForms: Array<{ id: string; name: string; accountId: string }>;
  strandedBlueprints: Array<{ id: string; name: string }>;
  orphanObjects: string[];
  errors: string[];
};

/** Exported so auth.teardown.ts builds its report from the same shape
 *  instead of a literal that has to learn every new leg by hand. */
export const emptySweepReport = (): SweepReport => ({
  accounts: [], clerkUsers: [], clerkOrgs: [], strandedForms: [], strandedBlueprints: [],
  orphanObjects: [], errors: [],
});

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
  // 0029: traffic restricts on sites, sites on accounts — these three first.
  // `concierge_conversations_form_id_fkey` is ON DELETE RESTRICT to `forms`
  // (migration 0042), same as `form_submissions.form_id` (0006) — both have
  // to go before `forms`.
  //
  // The list itself is packages/db's ACCOUNT_OWNED_TABLES — the schema's one
  // FK-ordered delete list, which the db suite's own fixtures prove on every
  // run — and no longer a second copy kept here. The copy that used to live
  // here had drifted by nine tables (no pipelines, pipeline_stages,
  // custom_fields, custom_values, tags, opportunities, notes, tasks or
  // contact_tags), which was harmless only while the sole account it swept
  // was the per-run fixture. The `E2E Co` company `blueprints.spec.ts`
  // creates has a blueprint APPLIED to it — pipelines, stages, custom
  // fields, tags — and `pipelines.account_id` has no ON DELETE behaviour
  // (0003), so the old list would have admitted that account and then
  // failed on its `accounts` delete, every sweep, forever.
  // Errors are still REPORTED per table rather than thrown (packages/db's
  // own deleteAccountCascade throws on the first one): a sweep that cleared
  // most of an account did more good than one that stopped at the first.
  for (const table of ACCOUNT_OWNED_TABLES) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) report.errors.push(`${table} delete for ${accountId}: ${error.message}`);
  }
  const { error } = await db.from("accounts").delete().eq("id", accountId);
  if (error) report.errors.push(`accounts delete for ${accountId}: ${error.message}`);
}

/**
 * Clerk paginates every list endpoint with `limit`/`offset` and reports how
 * many rows exist remotely as `totalCount` (both `getUserList` and
 * `getOrganizationList` share this shape — `ClerkPaginationRequest` /
 * `PaginatedResourceResponse` in `@clerk/backend`'s `UserApi.d.ts` /
 * `OrganizationApi.d.ts`, `dist/api/resources/Deserializer.d.ts` for
 * `totalCount`). A single `limit: 100` call therefore only ever sees the
 * newest 100 identities (Clerk's default order is newest-first) — anything
 * stale on page 2+ was never reachable and accumulates forever in the Clerk
 * instance production shares.
 *
 * This collects every page BEFORE the caller decides anything: the sweep
 * deletes some of what it finds, and deleting mid-page shifts every
 * remaining offset by the number removed so far, silently skipping whatever
 * lands in the gap. Collecting first means every decision is made against a
 * stable snapshot.
 *
 * Stops the instant a page comes back empty — a defensive floor against a
 * `totalCount` that never counts down, not an expected path.
 */
const CLERK_PAGE_SIZE = 100;

async function fetchAllPages<T>(
  fetchPage: (page: { limit: number; offset: number }) => Promise<{ data: T[]; totalCount: number }>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage({ limit: CLERK_PAGE_SIZE, offset });
    if (page.data.length === 0) break;
    all.push(...page.data);
    offset += page.data.length;
    if (offset >= page.totalCount) break;
  }
  return all;
}

/** The slice of the real Clerk client this module needs — narrow on purpose
 *  so a unit test can inject a fake without a real Clerk instance. The real
 *  client (`clerkClient()` from `@clerk/nextjs/server`) satisfies this
 *  structurally; nothing here imports its type. */
export type ClerkForSweep = {
  users: {
    getUserList: (
      params: { query?: string; limit?: number; offset?: number },
    ) => Promise<{ data: Array<{ id: string; emailAddresses: Array<{ emailAddress: string }> }>; totalCount: number }>;
    deleteUser: (userId: string) => Promise<unknown>;
  };
  organizations: {
    getOrganizationList: (
      params: { limit?: number; offset?: number },
    ) => Promise<{ data: Array<{ id: string; name: string }>; totalCount: number }>;
    deleteOrganization: (organizationId: string) => Promise<unknown>;
  };
};

/** Exported for `sweep.test.ts`, which injects a fake `ClerkForSweep` — real
 *  Clerk identities are exactly what this module must never touch in a unit
 *  test. */
export async function sweepClerkUsers(
  clerk: ClerkForSweep, report: SweepReport, now: number, maxAgeMs: number, dryRun: boolean,
): Promise<void> {
  try {
    const users = await fetchAllPages((page) =>
      clerk.users.getUserList({ query: "e2e-client-", ...page }));
    for (const user of users) {
      const email = user.emailAddresses[0]?.emailAddress ?? "";
      if (!isStaleFixture(email, FIXTURE_EMAIL_RE, now, maxAgeMs)) continue;
      report.clerkUsers.push({ id: user.id, email });
      if (!dryRun) await clerk.users.deleteUser(user.id);
    }
  } catch (e) {
    report.errors.push(`clerk users: ${String(e)}`);
  }
}

/** Exported for `sweep.test.ts`, same reason as `sweepClerkUsers`. */
export async function sweepClerkOrgs(
  clerk: ClerkForSweep, report: SweepReport, now: number, maxAgeMs: number, dryRun: boolean,
): Promise<void> {
  try {
    const orgs = await fetchAllPages((page) => clerk.organizations.getOrganizationList(page));
    for (const org of orgs) {
      // Same decision as the accounts leg: an org is named after its account
      // (auth.setup.ts by hand, blueprints.spec.ts through createClientAccount).
      if (!isStaleFixtureAccount(org.name, now, maxAgeMs)) continue;
      report.clerkOrgs.push({ id: org.id, name: org.name });
      if (!dryRun) await clerk.organizations.deleteOrganization(org.id);
    }
  } catch (e) {
    report.errors.push(`clerk orgs: ${String(e)}`);
  }
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
  const report = emptySweepReport();
  const db = serviceDb();

  // 1. Fixture accounts, matched by name and then by age.
  //
  // The `like` is a prefilter for the network, never the decision:
  // `isStaleFixtureAccount` is what admits a row, and it refuses
  // "E2E Client Co-op 1786412389258", which this pattern would happily
  // return. "E2E %" rather than one prefix per shape because the shapes are
  // now two (`E2E Client Co`, `E2E Co`) and one prefilter covering both is
  // the same one the forms leg below already uses.
  const { data: accounts, error: accountsError } = await db
    .from("accounts").select("id, name, clerk_org_id").like("name", FIXTURE_NAME_PREFILTER);
  if (accountsError) {
    report.errors.push(`accounts select: ${accountsError.message}`);
  }
  const stale = (accounts ?? []).filter(
    (a: { name: string }) => isStaleFixtureAccount(a.name, now, maxAgeMs),
  ) as Array<{ id: string; name: string; clerk_org_id: string | null }>;

  for (const account of stale) {
    report.accounts.push({ id: account.id, name: account.name });
    const objects = await removePrefix(db, account.id, report, dryRun);
    report.orphanObjects.push(...objects);
    if (!dryRun) await deleteAccountCascade(db, account.id, report);
  }

  // 2. Clerk identities. Independent of step 1 on purpose: a run killed
  // between createUser and createAccount leaves a user with no account row,
  // so keying off accounts alone would never find it. Both legs page through
  // every Clerk result rather than trusting a single `limit: 100` call — see
  // `fetchAllPages`'s own comment for why a single page silently strands
  // anything past the first 100.
  const clerk = await clerkClient();
  await sweepClerkUsers(clerk, report, now, maxAgeMs, dryRun);
  await sweepClerkOrgs(clerk, report, now, maxAgeMs, dryRun);

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

  // 4. Forms a killed `forms.spec.ts` run left behind. Unlike every leg
  // above, these live on the SEEDED account (`Test Client One`), not a
  // per-run fixture account — `forms.spec.ts` mints `E2E Form <stamp>` /
  // `E2E Spam <stamp>` there and deletes them in a `finally` that a killed
  // run (Ctrl-C, a crashed dev server, a memory kill) never reaches.
  //
  // The `like` is a prefilter for the network, never the decision, exactly
  // as the accounts leg above: without it every real client's every form
  // would be fetched on every run, forever. `isStaleFixtureForm` is what
  // actually admits a row.
  const { data: forms, error: formsError } = await db
    .from("forms").select("id, name, account_id").like("name", FIXTURE_NAME_PREFILTER);
  if (formsError) {
    report.errors.push(`forms select: ${formsError.message}`);
  }
  const staleForms = (forms ?? []).filter(
    (f: { name: string }) => isStaleFixtureForm(f.name, now),
  ) as Array<{ id: string; name: string; account_id: string }>;

  for (const form of staleForms) {
    report.strandedForms.push({ id: form.id, name: form.name, accountId: form.account_id });
    if (!dryRun) {
      // Child-first — the same order forms.spec.ts's own `finally` uses
      // (form_submissions before forms). Contacts and conversations are
      // deliberately left alone: a stranded form's contact cannot be told
      // apart from a real one on the seeded account by name alone, and the
      // forms this leg has found so far all have zero submissions anyway.
      const { error: subsError } = await db
        .from("form_submissions").delete().eq("form_id", form.id);
      if (subsError) {
        report.errors.push(`form_submissions delete for ${form.id}: ${subsError.message}`);
      }
      const { error: formError } = await db.from("forms").delete().eq("id", form.id);
      if (formError) report.errors.push(`forms delete for ${form.id}: ${formError.message}`);
    }
  }

  // 5. Blueprints a killed `blueprints.spec.ts` run left behind. Agency-
  // scoped rows with no `account_id` (migration 0007), and
  // `source_account_id` is `on delete set null` — so neither the account leg
  // above nor any account delete anywhere ever removes one. Stranded ones
  // have already broken unrelated tests that counted blueprints (that spec's
  // own comment). The `like` is a prefilter; `isStaleFixtureBlueprint`
  // decides. Nothing references `blueprints`, so the row goes on its own.
  const { data: blueprints, error: blueprintsError } = await db
    .from("blueprints").select("id, name").like("name", FIXTURE_BLUEPRINT_PREFILTER);
  if (blueprintsError) {
    report.errors.push(`blueprints select: ${blueprintsError.message}`);
  }
  const staleBlueprints = (blueprints ?? []).filter(
    (b: { name: string }) => isStaleFixtureBlueprint(b.name, now, maxAgeMs),
  ) as Array<{ id: string; name: string }>;

  for (const blueprint of staleBlueprints) {
    report.strandedBlueprints.push({ id: blueprint.id, name: blueprint.name });
    if (!dryRun) {
      const { error } = await db.from("blueprints").delete().eq("id", blueprint.id);
      if (error) report.errors.push(`blueprints delete for ${blueprint.id}: ${error.message}`);
    }
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
    `  stranded forms:  ${report.strandedForms.length}`,
    ...report.strandedForms.map((f) => `    ${f.name} (${f.id}, account ${f.accountId})`),
    `  blueprints:      ${report.strandedBlueprints.length}`,
    ...report.strandedBlueprints.map((b) => `    ${b.name} (${b.id})`),
    `  storage objects: ${report.orphanObjects.length}`,
    ...report.orphanObjects.map((p) => `    ${p}`),
  ];
  if (report.errors.length > 0) {
    lines.push(`  errors: ${report.errors.length}`, ...report.errors.map((e) => `    ${e}`));
  }
  return lines.join("\n");
}
