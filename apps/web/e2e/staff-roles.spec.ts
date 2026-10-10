import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, readAccountRole } from "@bis/db";
import { mintClientToken } from "./support";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every spec that talks to Supabase and Clerk
// from the runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Staff and roles (spec §6-§9): the per-run fixture's Owner (the client
 * fixture `auth.setup.ts` creates — a real Clerk org:admin) and its Staff
 * login (the SAME file's `staffClerkUserId`, a real Clerk org:member added
 * to the SAME org — see auth.setup.ts's "authenticate as staff user").
 *
 * Every test below runs on `E2E Client Co <stamp>`, never on
 * `Test Client One` (CLAUDE.md fixture discipline): #1 only reads roles,
 * and #2-#5 each read or change account-level membership state, exactly the
 * class of thing `booking.spec.ts` and `calendar-meeting-settings.spec.ts`
 * already keep off a real account.
 *
 * This file sorts alphabetically after `client-access.spec.ts`, which turns
 * the fixture's `client_access_enabled` off and does not restore it (that
 * file's own comment says why — `auth.teardown.ts` restores it
 * unconditionally at the end of the run). The `beforeAll` below is the same
 * self-healing every other spec that runs on this fixture after that point
 * already carries (`automations.spec.ts`, `client-branding.spec.ts`):
 * without it, `requireAccountAccess` would send both logins to `/no-access`
 * before any assertion below ever ran — not a 403, a redirect past
 * everything this file exists to check.
 */

type ClientFixture = {
  accountId: string;
  clerkOrgId: string;
  clerkUserId: string;
  staffClerkUserId?: string;
};

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Read at RUN TIME, never at module scope (setup.spec.ts's own doc comment
 * explains the collection-time trap: Playwright collects every spec file
 * before any setup project has run).
 */
function fixture(): ClientFixture & { staffClerkUserId: string } {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  const parsed = JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
  if (!parsed.staffClerkUserId) {
    throw new Error(
      `${FIXTURE_FILE} has no staffClerkUserId — "authenticate as staff user" (auth.setup.ts) ` +
      `did not run. Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return parsed as ClientFixture & { staffClerkUserId: string };
}

/** `{key}`-style holes, replicated here rather than importing the app's own
 *  `team-copy.ts` — this file only needs it for whole-string matches
 *  against rendered toasts, never for logic. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), template);
}

/** A sonner toast carrying this exact rendered sentence somewhere in its text. */
function toastWithText(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("the fallback settled both logins' roles", () => {
  // CI's ephemeral Supabase stack has no public URL for the Clerk webhook,
  // so this is the one place the fallback (lib/team/ensure-role.ts) is
  // proven end to end, against the REAL Clerk development instance: both
  // logins reached their first page load with no stored membership at all,
  // and each is read back here from the row the fallback itself wrote —
  // never a row this file seeds.
  //
  // Mutation: a fallback that defaulted everyone to "staff" (or never ran at
  // all, leaving both rows absent) fails this by name on the FIRST
  // assertion; one that always wrote "owner" fails on the second.
  test("the existing client is Owner, and the Staff login is Staff", async () => {
    const { accountId, clerkUserId, staffClerkUserId } = fixture();
    const db = serviceDb();
    expect(await readAccountRole(db, accountId, clerkUserId)).toBe("owner");
    expect(await readAccountRole(db, accountId, staffClerkUserId)).toBe("staff");
  });
});

test.describe("a Staff login sees no Billing, Team, Delete or Export", () => {
  test.use({ storageState: "e2e/.auth/staff-state.json" });

  // Positive control first (server-only-writes.spec.ts's own convention):
  // Contacts staying visible is what proves this is a real, working session
  // rather than a sidebar that rendered nothing at all, which would pass the
  // next two assertions for the wrong reason.
  test("the sidebar has no Billing link and no Team link", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    await expect(page.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
    // Mutation: dropping nav-groups.ts's `!isOwner` guard on Billing reds
    // this line; dropping app-sidebar.tsx's `isOwner` branch on the footer
    // (Team) reds the next one.
    await expect(page.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
  });

  test("the contacts page has no Export link, and the bulk bar has no Delete (Add tag stays)", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/contacts`);
    // Mutation: reverting contacts/page.tsx's `canManage` gate on the Export
    // link back to an unconditional render reds this line.
    await expect(page.getByRole("link", { name: m["contacts.export"], exact: true })).toHaveCount(0);

    const row = page.locator("tbody tr").first();
    await expect(row, "the fixture account's one seeded contact").toBeVisible();
    await row.getByRole("checkbox").click();
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar).toBeVisible();
    // DESIGN.md rule 4: a ticked checkbox always shows SOME bulk action.
    await expect(bar.getByRole("button", { name: m["bulk.addTag"] })).toBeVisible();
    // Mutation: dropping BulkActionBar's `canDelete` guard reds this line —
    // the Delete… button would render for Staff too.
    await expect(bar.getByRole("button", { name: m["bulk.delete"] })).toHaveCount(0);
  });

  test("/billing, /team and the contacts export URL redirect to the account dashboard, never 403", async ({ page }) => {
    const { accountId } = fixture();
    const dashboard = new RegExp(`/dashboard/accounts/${accountId}/dashboard$`);
    // Mutation: a route guarded by requireAccountAccess instead of
    // requireAccountOwner lets Staff through (page renders, URL unchanged) —
    // every assertion below reds. A guard that 403'd instead of redirecting
    // would also fail: `toHaveURL` never matches a 403 response's own URL
    // staying on the owner-only page.
    await page.goto(`/dashboard/accounts/${accountId}/billing`);
    await expect(page).toHaveURL(dashboard);
    await page.goto(`/dashboard/accounts/${accountId}/team`);
    await expect(page).toHaveURL(dashboard);
    await page.goto(`/dashboard/accounts/${accountId}/contacts/export`);
    await expect(page).toHaveURL(dashboard);
  });
});

test.describe("a direct delete through Staff's own token", () => {
  // The server-only-writes.spec.ts shape: a real Clerk session token for
  // this specific Staff login, called straight at PostgREST with the anon
  // key — the boundary under test is Clerk's claims meeting Postgres's RLS,
  // which a stubbed token or a mocked client would prove nothing about.
  test("is refused by Postgres (200, []) — never reaches the row", async () => {
    const { accountId, staffClerkUserId } = fixture();
    const db = serviceDb();
    const { data, error } = await db
      .from("contacts")
      .insert({ account_id: accountId, first_name: "Staff", last_name: `Delete Probe ${Date.now()}` })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`staff-roles: could not seed a probe contact: ${error?.message ?? "no row returned"}`);
    }
    const contactId = (data as { id: string }).id;
    try {
      const token = await mintClientToken(staffClerkUserId);
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/contacts?id=eq.${contactId}`, {
        method: "DELETE",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
      });
      const text = await res.text();
      const rows = text.trimStart().startsWith("[") ? (JSON.parse(text) as unknown[]) : [];
      // 0066's `contacts_owner_delete` is RESTRICTIVE: a non-owner's rows
      // simply never match, so PostgREST answers 200 with an empty array —
      // the same shape server-only-writes.spec.ts asserts for every
      // policy-hidden row. Mutation: dropping that restrictive policy (or
      // widening it to admit "staff") turns this into a 200 with the row —
      // `rows` would equal `[{ id: contactId }]` instead of `[]`.
      expect(res.status, text).toBe(200);
      expect(rows).toEqual([]);
      // Soft, and read back with the SERVICE client: a run that fails above
      // still reports whether the row actually survived.
      const after = await db.from("contacts").select("id").eq("id", contactId);
      expect.soft(after.data, "the contact after the refused delete").toEqual([{ id: contactId }]);
    } finally {
      await db.from("contacts").delete().eq("id", contactId);
    }
  });
});

test.describe("the Owner runs the team", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  // Independent of the test below it (the client is the sole Owner from the
  // moment the Staff login exists, never only after it invites or promotes
  // anyone) — ordered second only to match the brief's own numbering.
  test("demoting the only Owner is refused, and the role stays Owner", async ({ page }) => {
    const { accountId, clerkUserId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/team`);
    const ownerRow = page.locator("[data-team-row]").filter({ hasText: "E2E Client" });
    await expect(ownerRow).toBeVisible();
    const combobox = ownerRow.getByRole("combobox", { name: "Role for E2E Client" });
    await combobox.click();
    await page.getByRole("option", { name: m["team.role.staff"], exact: true }).click();
    // Mutation: dropping 0066_staff_and_roles.sql's last-owner check (or
    // setAccountMemberRole's "last_owner" branch in team.ts) lets this
    // succeed silently — no toast, and the combobox would read "Staff".
    await expect(toastWithText(page, m["team.lastOwner"])).toBeVisible();
    await expect(combobox).toContainText(m["team.role.owner"]);
    expect(await readAccountRole(serviceDb(), accountId, clerkUserId)).toBe("owner");
  });

  test("invite, promote with Undo, revoke with Undo, remove with Undo — the 5-seat cap counts exactly 3", async ({ page }) => {
    const { accountId, staffClerkUserId } = fixture();
    const db = serviceDb();
    await page.goto(`/dashboard/accounts/${accountId}/team`);

    const staffRow = page.locator("[data-team-row]").filter({ hasText: "E2E Staff" });
    await expect(staffRow).toBeVisible();
    const staffRoleBox = staffRow.getByRole("combobox", { name: "Role for E2E Staff" });

    // --- invite, as Staff (the dialog's own default role) --------------
    const stamp = Date.now();
    // +clerk_test on the reserved example.com domain, belt-and-suspenders:
    // example.com never resolves to a mailbox regardless, and +clerk_test is
    // Clerk's own documented test-mode convention — either one alone is
    // enough for no real email to go out.
    const inviteEmail = `e2e-invite-${stamp}+clerk_test@example.com`;
    await page.getByRole("button", { name: m["team.invite"] }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(m["team.invite.email"]).fill(inviteEmail);
    await dialog.getByRole("button", { name: m["team.invite.send"] }).click();
    // Mutation: a refused invite (a stale `full` read, a bad email guard
    // rejecting `+`) leaves the dialog open with its own Notice — the dialog
    // would still be present here instead of closed.
    await expect(dialog).toHaveCount(0);

    const inviteRow = page.locator("[data-team-invite]").filter({ hasText: inviteEmail });
    await expect(inviteRow).toBeVisible();
    await expect(inviteRow.getByText(m["team.status.invited"])).toBeVisible();
    await expect(inviteRow.getByText(m["team.role.staff"])).toBeVisible();

    // --- promote Staff to Owner, then Undo ------------------------------
    await staffRoleBox.click();
    await page.getByRole("option", { name: m["team.role.owner"], exact: true }).click();
    const promotedToast = toastWithText(
      page, fillTemplate(m["team.role.changed"], { name: "E2E Staff", role: m["team.role.owner"] }),
    );
    await expect(promotedToast).toBeVisible();
    await promotedToast.hover();
    await promotedToast.getByRole("button", { name: m["common.undo"] }).click();
    // Mutation: an Undo that calls setRole with the WRONG previous role (or
    // none at all) leaves the combobox reading "Owner" here, and the
    // read-back below would answer "owner" instead of "staff".
    await expect(staffRoleBox).toContainText(m["team.role.staff"]);
    expect(await readAccountRole(db, accountId, staffClerkUserId)).toBe("staff");

    // --- revoke the invitation, then Undo --------------------------------
    // Not matched by m["team.revoke"] ("Cancel invitation"): the row's own
    // aria-label is `team.revokeFor` ("Cancel the invitation for {email}"),
    // which overrides the accessible name and does not contain that literal
    // substring. The row holds exactly one button, so it needs no name.
    await inviteRow.getByRole("button").click();
    const revokedToast = toastWithText(
      page, fillTemplate(m["team.revoked"], { email: inviteEmail }),
    );
    await expect(revokedToast).toBeVisible();
    // Mutation: an action that revokes but never revalidates leaves this row
    // visible here instead of gone.
    await expect(page.locator("[data-team-invite]").filter({ hasText: inviteEmail })).toHaveCount(0);
    await revokedToast.hover();
    await revokedToast.getByRole("button", { name: m["common.undo"] }).click();
    await expect(toastWithText(
      page, fillTemplate(m["team.undone.revoke"], { email: inviteEmail }),
    )).toBeVisible();
    // Mutation: an undo that re-invites with the wrong role/language (or
    // fails silently) leaves the row absent here.
    await expect(page.locator("[data-team-invite]").filter({ hasText: inviteEmail })).toBeVisible();

    // --- remove the Staff person, then Undo ------------------------------
    await staffRow.getByRole("button", { name: m["team.remove"] }).click();
    const removedToast = toastWithText(page, fillTemplate(m["team.removed"], { name: "E2E Staff" }));
    await expect(removedToast).toBeVisible();
    // Mutation: a remove that only revokes Clerk membership but leaves the
    // BIS row (or the reverse) would still show SOME row here — this is the
    // state where neither should.
    await expect(page.locator("[data-team-row]").filter({ hasText: "E2E Staff" })).toHaveCount(0);
    expect(await readAccountRole(db, accountId, staffClerkUserId)).toBeNull();
    await removedToast.hover();
    await removedToast.getByRole("button", { name: m["common.undo"] }).click();
    await expect(toastWithText(page, fillTemplate(m["team.undone.remove"], { name: "E2E Staff" }))).toBeVisible();
    // Mutation: an undo that restores the WRONG role (removal-log.ts's
    // `recordRemoval` writing the post-promotion role instead of the one at
    // removal time) answers "owner" here instead of "staff".
    await expect(page.locator("[data-team-row]").filter({ hasText: "E2E Staff" })).toBeVisible();
    expect(await readAccountRole(db, accountId, staffClerkUserId)).toBe("staff");

    // --- the 5-seat cap: Owner + Staff + one invitation is 3 -------------
    // The agency setup user never joins this org at all (plan deviation 6:
    // the agency is never a client membership), so it can only show up here
    // as a THIRD stored team row — this is the only place that would be
    // visible if it ever did.
    await expect(page.locator("[data-team-row]")).toHaveCount(2);
    await expect(page.locator("[data-team-invite]")).toHaveCount(1);
    // Mutation: roomLeft() counting members OR pending but not both reads
    // "Room for 3 more people" (members only) or a cap-sized number
    // (pending only) instead of exactly 2 (5 - 2 - 1).
    await expect(page.getByText(fillTemplate(m["team.room.many"], { count: "2" }))).toBeVisible();
  });
});
