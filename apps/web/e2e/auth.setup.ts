import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb, createAccount, setClientAccess, createContact,
         setBranding, uploadBrandLogo, createForm, updateForm } from "@bis/db";
import { sweepStaleFixtures, formatSweepReport } from "./fixtures/sweep";

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

// A real 24x24 solid-blue PNG, built chunk by chunk with valid CRCs. Genuine
// bytes on purpose: the upload path identifies format by decoded magic bytes,
// so a renamed or hand-waved blob would be rejected exactly as an attacker's
// would be. Big enough to have a real bounding box, so "the logo renders" is
// an assertion a 1x1 pixel could not honestly support.
const E2E_LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGPQz39LFcQwatCoQaMGjRo0atCoQQNvEAA+eHju9d5YpgAAAABJRU5ErkJggg==",
  "base64",
);

// Runs once before the real specs. Signs in as the one real Clerk user on
// this dev instance (danlopez508@gmail.com) via a Backend-API-minted
// sign-in token — no password, no email code, and critically no user is
// created or modified. That user already carries
// public_metadata.app_role = "agency_admin" (set by hand in the Clerk
// Dashboard outside of this codebase), which is what requireAgency()
// checks for in the session claims.
setup("authenticate as agency_admin", async ({ page }) => {
  await clerkSetup();

  const email = process.env.E2E_ADMIN_EMAIL ?? "danlopez508@gmail.com";

  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/dashboard/accounts");

  // This Clerk dev instance now enforces organization selection as a
  // pending session task whenever the signed-in user belongs to one or more
  // organizations and this (fresh, cookie-less) browser context has no
  // active org yet — middleware redirects to a real, clickable
  // "Choose an organization" screen (Clerk's own <SignIn/> component,
  // mounted at the /sign-in catch-all) instead of the target route. The
  // redirect to /sign-in/tasks (and on from there to
  // /sign-in/tasks/choose-organization) happens client-side after the initial
  // goto's load event, so page.url() has to be waited on, not read
  // immediately. This dev user's only organization is "Test Client One", the
  // fixture account every other spec assumes exists.
  await page.waitForURL(
    (url) => url.pathname === "/dashboard/accounts" || url.pathname.startsWith("/sign-in/tasks"),
  );
  if (page.url().includes("/sign-in/tasks")) {
    await page.getByRole("button", { name: /Test Client One/ }).click();
  }

  await page.waitForURL(/\/dashboard\/accounts$/);

  await page.context().storageState({ path: AUTH_FILE });
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
      + report.clerkOrgs.length + report.orphanObjects.length + report.strandedForms.length;
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

  // Same ticket-based sign-in as the agency flow above: clerk.signIn looks
  // the user up by email via the Backend API and mints a real sign-in
  // token — no password, no email code, and no second user is created.
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });

  // force_organization_selection is now false (Task 3), so unlike the
  // agency flow above, no "Choose an organization" task screen interrupts
  // sign-in — but that also means nothing sets this session's active
  // organization automatically. Without an active org, the session token
  // carries no org_id claim, and every guard in lib/auth.ts that reads
  // claims.org_id would treat this user as unlinked rather than as this
  // account's client. Set it explicitly, the same call Clerk's own
  // <OrganizationSwitcher/> makes when a user picks an org.
  await page.evaluate(async (organizationId) => {
    const clerkGlobal = (
      window as unknown as {
        Clerk?: { setActive(params: { organization: string }): Promise<void> };
      }
    ).Clerk;
    if (!clerkGlobal) throw new Error("client fixture setup: window.Clerk did not load");
    await clerkGlobal.setActive({ organization: organizationId });
  }, org.id);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.context().storageState({ path: CLIENT_AUTH_FILE });
});
