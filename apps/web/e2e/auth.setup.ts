import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb, createAccount, setClientAccess, createContact,
         setBranding, uploadBrandLogo, createForm, updateForm } from "@bis/db";
import { sweepStaleFixtures, formatSweepReport } from "./fixtures/sweep";
import { refuseProduction } from "./fixtures/production-guard";
import { saveSignedInState } from "./fixtures/session-state";
import { SEEDED_ACCOUNT_NAME } from "./support";
import { createAgencyUser, setActiveOrganization, signInWithTicket } from "./fixtures/clerk-identities";

// Needed for the client-fixture setup below, which calls serviceDb() and
// clerkClient() directly from the Playwright test runner process (not
// through a Next.js request), so nothing auto-loads apps/web/.env.local for
// it the way `next dev` does for the app itself. Matches blueprints.spec.ts's
// own loadEnv calls, including the same two paths for the same reason: this
// file runs with apps/web as cwd (`pnpm --filter web test:e2e`), so the
// first path is a defensive no-op for a repo-root invocation and the second
// is the one that actually resolves.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Before any setup test is even registered: everything below creates real
// rows, Clerk users and Storage objects, and the sweep deletes. Where the env
// still names production (docs/runbooks/ci-supabase-project.md, section 9),
// nothing here runs. playwright.config.ts refuses first; this is the check on
// the values this process actually loaded. See fixtures/production-guard.ts.
refuseProduction(process.env, "The e2e setup");

const AUTH_FILE = "e2e/.auth/state.json";
const CLIENT_AUTH_FILE = "e2e/.auth/client-state.json";
// Sidecar record of what the client-fixture setup below created. Read by
// client-access.spec.ts to know which account to assert against, and by
// auth.teardown.ts (the "setup" project's `teardown` project — see
// playwright.config.ts) to know what to delete. Deletion lives in the
// teardown project rather than the spec's own `finally` specifically so it
// still runs when the spec that consumes the fixture isn't part of the run
// at all (e.g. `test:e2e blueprints.spec.ts`, or any --grep): the "setup"
// project has no test filter, so this fixture is created on every
// invocation regardless, and a filtered run used to leak it.
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";
// The same sidecar idea for the per-run agency user below: auth.teardown.ts
// reads it to delete that user, whether or not any spec ran.
const AGENCY_FIXTURE_FILE = "e2e/.auth/agency-fixture.json";

// A real 24x24 solid-blue PNG, built chunk by chunk with valid CRCs. Genuine
// bytes on purpose: the upload path identifies format by decoded magic bytes,
// so a renamed or hand-waved blob would be rejected exactly as an attacker's
// would be. Big enough to have a real bounding box, so "the logo renders" is
// an assertion a 1x1 pixel could not honestly support.
const E2E_LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGPQz39LFcQwatCoQaMGjRo0atCoQQNvEAA+eHju9d5YpgAAAABJRU5ErkJggg==",
  "base64",
);

// Runs once before the real specs: mints a throwaway agency user for THIS
// run and signs it in (fixtures/clerk-identities.ts says why it is never a
// person). A per-run user shares no session with a person or with a
// concurrent run. No org is needed for agency access. The user still joins
// the seeded org and makes it active, exactly
// as the real person's session did: <ActivateSoleOrganization/> switches a
// session with no active org and exactly ONE membership and reloads to "/",
// and blueprints.spec.ts creates an org mid-spec ("Add company" makes the
// creator a member), which would hand a member-of-nothing user exactly one.
// Deleted by auth.teardown.ts; a leaked one is swept by its email stamp.
setup("authenticate as agency_admin", async ({ page }) => {
  await clerkSetup();
  const clerk_ = await clerkClient();

  const { userId, email } = await createAgencyUser(clerk_, { firstName: "E2E", lastName: "Agency" });
  // Recorded before anything else can fail, so teardown always has the id.
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(AGENCY_FIXTURE_FILE, JSON.stringify({ clerkUserId: userId, email }));

  // The seeded account's org, read from the account row rather than pinned
  // here: one source (the CI seed), no second copy of the id to drift.
  const { data: seeded, error } = await serviceDb()
    .from("accounts").select("clerk_org_id").eq("name", SEEDED_ACCOUNT_NAME).limit(2);
  if (error) throw new Error(`agency setup: reading ${SEEDED_ACCOUNT_NAME} failed: ${error.message}`);
  const organizationId = seeded?.length === 1 ? seeded[0]?.clerk_org_id : undefined;
  if (!organizationId) {
    throw new Error(`agency setup: expected exactly one ${SEEDED_ACCOUNT_NAME} with a Clerk org, found ${seeded?.length ?? 0}`);
  }
  await clerk_.organizations.createOrganizationMembership({
    organizationId, userId, role: "org:member",
  });

  await signInWithTicket(page, clerk_, userId);
  await setActiveOrganization(page, organizationId);
  await page.goto("/dashboard/accounts");
  await page.waitForURL(/\/dashboard\/accounts$/);

  // Without the 60-second session token: every spec's first page load then
  // mints its own. See fixtures/session-state.ts for the CI trace behind it.
  await saveSignedInState(page.context(), AUTH_FILE);
});

// A second, isolated identity for client-access.spec.ts: a Clerk user with
// NO app_role in public_metadata (absent means client — the design's
// fail-closed rule, see docs/superpowers/specs/2026-08-02-m2-client-access-design.md
// section 2), a member of a fresh, throwaway org, backed by a fresh
// accounts row with client_access_enabled = true and one seeded contact.
// Everything created here — the Clerk user, the Clerk org, the Postgres
// account row, and the seeded contact — is deleted by auth.teardown.ts, not
// by this file. This setup test only arranges the fixture and signs in; see
// CLIENT_FIXTURE_FILE above for why cleanup lives in the teardown project
// instead.
setup("authenticate as client user (no app_role)", async ({ page }) => {
  await clerkSetup();

  // Clean up before creating, because cleaning up after is optional.
  // auth.teardown only runs when a suite COMPLETES, so every Ctrl-C, crashed
  // dev server or process-level timeout strands a real Clerk user, a real
  // Clerk org, real rows and a PUBLIC Storage object in the shared dev
  // environment — permanently, since nothing afterwards knows they existed.
  // This is the pass that makes those bounded: it deletes only names this
  // suite mints and only after 30 minutes, so a concurrently-running suite's
  // fixture is never touched (see fixtures/stale.ts, which owns that
  // decision and is unit-tested).
  //
  // Wrapped so a sweep failure can never fail a run that would otherwise
  // pass. Housekeeping must not become a new way for the suite to go red.
  try {
    const report = await sweepStaleFixtures({ dryRun: false });
    const swept = report.accounts.length + report.clerkUsers.length
      + report.clerkOrgs.length + report.orphanObjects.length + report.strandedForms.length
      + report.strandedBlueprints.length;
    if (swept > 0) console.log(formatSweepReport(report, false));
  } catch (e) {
    console.error(`e2e setup: fixture sweep failed (continuing): ${String(e)}`);
  }

  const stamp = Date.now();
  // example.com is IANA-reserved for documentation/testing and never
  // resolves to a real mailbox. (A first attempt used the also-reserved
  // .test TLD, but Clerk's own email-format validator rejected it outright
  // — "form_param_format_invalid" — before any account was ever created, so
  // this is the corrected choice.) Backend-API-created users have their
  // email auto-verified (no verification mail sent), and nothing here ever
  // calls the invitation endpoint, so no mail goes out to anyone regardless.
  const email = `e2e-client-${stamp}@example.com`;
  const companyName = `E2E Client Co ${stamp}`;

  const clerk_ = await clerkClient();

  const user = await clerk_.users.createUser({
    emailAddress: [email],
    firstName: "E2E",
    lastName: "Client",
    skipPasswordRequirement: true,
    skipLegalChecks: true,
  });
  // Belt-and-suspenders on the fixture's one load-bearing property: nothing
  // above ever set publicMetadata, so this should always be empty, but the
  // whole spec's meaning depends on this user actually being an
  // absent-app_role client — worth failing loudly here rather than
  // discovering it as a mysteriously-agency-scoped test later.
  if (user.publicMetadata && "app_role" in user.publicMetadata) {
    throw new Error(
      `client fixture setup: newly created user ${user.id} unexpectedly carries app_role ` +
      `(${JSON.stringify(user.publicMetadata)}) — the spec needs an absent claim, not just a falsy one`,
    );
  }

  // createdBy makes the new user an org:admin member automatically — no
  // separate createOrganizationMembership call needed.
  const org = await clerk_.organizations.createOrganization({
    name: companyName,
    createdBy: user.id,
  });

  const db = serviceDb();
  const { id: accountId } = await createAccount(db, {
    clerkOrgId: org.id,
    name: companyName,
    actorId: user.id,
  });
  await setClientAccess(db, accountId, true, user.id);

  // One real row in the client's own account. Without this,
  // client-access.spec.ts had no positive assertion that a client can see
  // ANY of their own data — every check in it was an absence check (no
  // canary name, no agency chrome, a redirect on the "off" case), all of
  // which pass trivially if userDb()/RLS quietly stopped returning rows for
  // this account too (e.g. a 404 from [accountId]/layout.tsx's notFound()).
  // A visible full name (see contactDisplayName in lib/format.ts) makes the
  // new assertion in the spec a straightforward getByText check.
  const contactFirstName = "E2E";
  const contactLastName = `Fixture ${stamp}`;
  const contactName = `${contactFirstName} ${contactLastName}`;
  await createContact(
    db, accountId, { firstName: contactFirstName, lastName: contactLastName }, user.id,
  );

  // Branding for M3. brandName is deliberately NOT derived from companyName:
  // the whole point of the column is that what a client's customers see is a
  // different string from the agency's internal label, and an assertion that
  // cannot tell the two apart would pass even if the sidebar were still
  // reading accounts.name.
  const brandName = `Rio Roofing ${stamp}`;
  const brandLogoPath = await uploadBrandLogo(db, accountId, E2E_LOGO_PNG, "image/png");
  // Chosen deliberately: it renders differently on the two surfaces — as
  // itself on the public form, lightened to #3a62d4 on the dark sidebar
  // (it scores only 1.62:1 there unlightened) — so this one fixture proves
  // both the public form's CTA resolver and resolveSidebarAccent. Since M4b
  // this account is also THEMED (below), so the form lifts it too rather than
  // painting it raw — public-form-theme.spec.ts covers the raw value on the
  // unthemed path. See client-access.spec.ts.
  const brandColor = "#1e3a8a";
  await setBranding(db, accountId, {
    brandName, brandLogoPath, brandColor,
    // One fixture, both halves: a dark default proves the mode path, and
    // #1e3a8a (already the fixture's colour, at 1.62:1 on a dark sidebar)
    // proves the lift ran, exactly as it does for the sidebar accent today.
    // brandType is set on purpose. It was the one input left unset here, and
    // that is exactly why a final review — not a test — caught that the
    // typeface never applied at all: globals.css declares font-family on
    // `body`, and the tokens used to be emitted on a div inside it, so
    // overriding --font-sans below body changed nothing. A fixture that
    // exercises four of five inputs proves four of five inputs.
    brandNeutral: "warm", brandCorners: "round", brandMode: "dark", brandType: "serif",
  }, user.id);

  // A published form on that account, so the public /f/<publicId> page has
  // something to render the brand above. Published, not draft: the route 404s
  // on anything else.
  const { id: formId, publicId: formPublicId } = await createForm(
    db, accountId,
    {
      name: `E2E Brand Form ${stamp}`,
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
    },
    user.id,
  );
  await updateForm(db, accountId, formId, { status: "published" }, user.id);

  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(
    CLIENT_FIXTURE_FILE,
    JSON.stringify({ accountId, clerkOrgId: org.id, clerkUserId: user.id, email, companyName,
                    contactName, brandName, brandLogoPath, brandColor, formPublicId }),
  );

  // By ticket, for the id already in hand: see signInWithTicket.
  await signInWithTicket(page, clerk_, user.id);

  // Nothing sets this session's active organization automatically (see
  // setActiveOrganization). Without one, the session token carries no
  // org_id claim, and every guard in lib/auth.ts that reads claims.org_id
  // would treat this user as unlinked rather than as this account's client.
  await setActiveOrganization(page, org.id);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Same as the agency state above: no session token. The active organization
  // set above lives on the Clerk session, not in the token, so the token the
  // first page load mints carries it. (Assumption from Clerk's session model;
  // the evidence is that every client spec already starts this way once the
  // saved token is more than 65 s old, and passes.)
  await saveSignedInState(page.context(), CLIENT_AUTH_FILE);
});
