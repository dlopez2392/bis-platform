import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { readClientFixture } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// directly from the Playwright runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-032 S3: "Call in to your business" (the setup card) end to end, on the PER-RUN FIXTURE account's own Owner —
 * never Test Client One (CLAUDE.md's hard rule: a spec that mutates account state belongs on the fixture, and the
 * owner line's switch and enrolment ARE account state). The real phone call cannot run here (no real call in CI
 * or locally), so the one DB write each test stands in for is exactly what the matching database function does on
 * a real call: `owner_line_attempt_verify` on a correct code (here: the test marks the row verified directly,
 * the same end state), the rest (PIN, switch) going entirely through the app's own actions and UI.
 *
 * Owner rulings this spec exercises or respects:
 *   - O-1 = F2 (2026-11-09): only Owner and Staff are offered the line today; a Technician gets no card at all.
 *     This file only ever signs in as the fixture's one Owner, so the Technician-refused case is not re-proven
 *     here (Task 10/11's own live scope test covers it).
 *   - Q-A: the client's Owner may turn the switch on or off; the agency (BIS) may turn it OFF only, never ON, and
 *     the ON control is never offered to the agency at all — the design-review case below proves both halves.
 *   - Q-D: a person may verify their cell and set a PIN while the switch is off; the second test below runs
 *     entirely in that state.
 *   - "Say BIS, keep names private" (2026-11-09): the switch's record names a KIND of person, never a name — "the
 *     Owner" or "BIS" — which is what the design-review case asserts in the rendered record line.
 *
 * `test.describe.serial`: each test depends on the one before it (the cell must be verified before a PIN can be
 * set; the PIN must be set before the switch matters; the switch must be ON before turning it OFF means anything),
 * so a failure early in the file skips the rest rather than asserting against whatever state it left behind.
 *
 * Cannot run yet (orchestrator note): migration 0115 is not in bis-ci's history until after 2026-11-11, and the
 * e2e job's own migration check (then `ci-migrations-applied.sh`, retired 2026-11-13) refuses the branch before any spec runs, local or CI
 * (`docs/runbooks/ci-supabase-project.md` section 9). This file is written and typechecked now; the orchestrator
 * runs `pnpm --filter web exec playwright test e2e/owner-line-setup.spec.ts` once 0115 is on bis-ci, after checking
 * for an in-progress `screenshots.yml` run (CLAUDE.md — a local run shares bis-ci's seeded account with it).
 */
test.describe.configure({ timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const CELL = "+19565550142";

let accountId = "";
let userId = "";

/** Read at RUN TIME, never at module scope (Playwright collects every spec file before "setup" has written this). */
function fixtureAccountId(): string {
  const fx = readClientFixture();
  if (!fx) {
    throw new Error(`client fixture missing at ${FIXTURE_FILE} — the "setup" project did not run. Run the full suite: pnpm --filter web test:e2e.`);
  }
  return fx.accountId;
}

test.describe.serial("owner line setup (F-032 S3)", () => {
  test.beforeAll(async () => {
    accountId = fixtureAccountId();
    const db = serviceDb();
    // Exactly one Owner membership on a per-run fixture account (places.spec.ts's own reasoning: the client
    // fixture user is the ONLY Clerk org:admin on its org).
    const owner = await db.from("memberships").select("user_id")
      .eq("scope", "account").eq("account_id", accountId).eq("role", "owner").limit(1).single();
    if (owner.error) throw new Error(`owner-line e2e: could not read the fixture Owner's membership: ${owner.error.message}`);
    userId = (owner.data as { user_id: string }).user_id;
    // Self-heal (assign.spec.ts's / groups.spec.ts's own reasoning): this file does not control run order against
    // client-access.spec.ts, which turns client_access_enabled OFF and relies on auth.teardown.ts to restore it
    // only at the very end of the whole run. The Team page (requireAccountOwner -> requireAccountAccess) refuses
    // a client Owner outright while it is off; the preferences page's own owner-line actions do not check it (they
    // authorise off a direct membership read), but the Team test below needs it on.
    await setClientAccess(db, accountId, true, userId);
    await reset();
  });

  test.afterAll(async () => { await reset(); });

  /** Every cleanup write is checked: a silent failure here would leave the NEXT run's first case reading old state. */
  async function reset() {
    const db = serviceDb();
    const del = await db.from("owner_line_enrollments").delete().eq("account_id", accountId).eq("user_id", userId);
    if (del.error) throw new Error(`owner-line e2e cleanup (enrollment) failed: ${del.error.message}`);
    // Two writes, because 0115's accounts_owner_line_switch_record trigger refuses an UPDATE that moves
    // owner_line_enabled_at without also moving owner_line_changed_at to a fresh, non-null value: first OFF with a
    // fresh record (a no-op for the trigger when it was already off, since old and new owner_line_enabled_at are
    // both null and the trigger's WHEN clause never fires), then clear the record with the switch left alone, so
    // the next run starts from "never changed" rather than carrying this run's own cleanup into its record line.
    const off = await db.from("accounts").update({
      owner_line_enabled_at: null, owner_line_changed_at: new Date().toISOString(), owner_line_changed_by_kind: "owner",
    }).eq("id", accountId);
    if (off.error) throw new Error(`owner-line e2e cleanup (switch) failed: ${off.error.message}`);
    const clear = await db.from("accounts").update({ owner_line_changed_at: null, owner_line_changed_by_kind: null }).eq("id", accountId);
    if (clear.error) throw new Error(`owner-line e2e cleanup (record) failed: ${clear.error.message}`);
  }

  test.describe("1. the Owner verifies a cell and sets a PIN", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("a cell gets a 6-digit call-in code with the business's number", async ({ page }) => {
      await page.goto("/dashboard/preferences");
      const card = page.locator(`[data-owner-line-card="${accountId}"]`);
      await expect(card).toBeVisible();
      await card.getByLabel("Your cell").fill("(956) 555-0142");
      await card.getByRole("button", { name: "Verify this cell" }).click();
      await expect(card.locator("[data-owner-line-code]")).toContainText(/[0-9]{6}/);
    });

    test("after the call-in, a trivial PIN is refused with its reason; a good one is saved; the switch is off so the card says so", async ({ page }) => {
      // Stands in for the real call: owner_line_attempt_verify's own end state on a matching code.
      const v = await serviceDb().from("owner_line_enrollments")
        .update({ verified_at: new Date().toISOString(), verify_code_hash: null, verify_expires_at: null })
        .eq("account_id", accountId).eq("user_id", userId).eq("e164", CELL).select("id");
      if (v.error || (v.data ?? []).length !== 1) throw new Error(`owner-line e2e: could not stand in for the call-in: ${v.error?.message ?? "no matching row"}`);

      await page.goto("/dashboard/preferences");
      const card = page.locator(`[data-owner-line-card="${accountId}"]`);
      await card.getByLabel("PIN (6 digits)").fill("123456");
      await card.getByRole("button", { name: "Save PIN" }).click();
      await expect(card.getByRole("alert")).toContainText("123456 is too easy");

      await card.getByLabel("PIN (6 digits)").fill("482913");
      await card.getByRole("button", { name: "Save PIN" }).click();
      await expect(card.locator("[data-owner-line-status]")).toContainText("turned off. Ask the Owner");
    });
  });

  test.describe("2. the Owner turns the switch on in Team", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("the switch reads Off, turning it on updates the card, and Preferences now reads Ready", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/team`);
      const sw = page.locator("[data-owner-line-switch]");
      await expect(sw).toContainText("Off");
      await sw.getByRole("button", { name: "Turn on" }).click();
      await expect(sw).toContainText("On");

      await page.goto("/dashboard/preferences");
      await expect(page.locator(`[data-owner-line-card="${accountId}"] [data-owner-line-status]`)).toContainText("Ready: call");
    });
  });

  /**
   * Design-review-friendly case (Q-A, "Say BIS, keep names private"): the agency may only ever turn the switch
   * OFF, is never offered an ON control at all (not merely a disabled one), and the record line names the KIND
   * of person, never a name. This runs as the shared agency session (the default storageState every other spec
   * uses), which auth.setup.ts's fifth setup test already gave a live visit to this account, so the Team page's
   * agency-visit gate (`requireAgencyVisit`) is already satisfied.
   */
  test.describe("3. the agency may only turn the switch off, never on", () => {
    test.use({ storageState: "e2e/.auth/state.json" });

    test("the agency sees only a Turn off button while it is on; turning it off records 'Turned off by BIS' and offers no On control", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/team`);
      const sw = page.locator("[data-owner-line-switch]");
      await expect(sw).toContainText("On");
      // While on, the agency's one affordance is Turn off — never a second, ON-shaped control sitting beside it.
      await expect(sw.getByRole("button", { name: "Turn on" })).toHaveCount(0);
      await sw.getByRole("button", { name: "Turn off" }).click();

      await expect(sw).toContainText("Off");
      await expect(sw.locator("[data-owner-line-switch-record]")).toContainText("Turned off by BIS");
      // Must #3 (Task 6 brief): the ON control is never offered to the agency at all, not merely disabled —
      // there is no button to find, only the explanatory sentence in its place.
      await expect(sw.getByRole("button", { name: "Turn on" })).toHaveCount(0);
      await expect(sw.getByText("Only the business's Owner can turn this on.")).toBeVisible();
    });
  });
});
