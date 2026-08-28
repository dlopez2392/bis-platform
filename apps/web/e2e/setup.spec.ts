import { test, expect, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, setClientAccess, getOrCreateCalendar, updateCalendarSettings,
  listChecklistState,
} from "@bis/db";
import { SETUP_TICK_KEYS } from "../src/lib/setup/setup-status";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * Every unit test behind the setup wizard runs against `deriveSetupStatus`'s
 * plain inputs or a serviceDb-shaped fixture, and both are BLIND to column
 * grants and RLS — this project has shipped two defects behind exactly that
 * kind of green suite (migrations 0018 and 0020 are the corrections). The
 * setup page reads its six sources through `dbForRequest()`, i.e. as the
 * signed-in agency user, precisely so a grants problem shows up as a broken
 * card. This is the only layer that can see that happen.
 *
 * It runs against the CLIENT FIXTURE account (auth.setup.ts) rather than
 * `Test Client One`, for three reasons that all matter:
 *
 *  ① It is created fresh per run, so "this account has no calls / no number /
 *    no voice profile" is TRUE rather than assumed — which is what makes the
 *    go-live blocked list assertable in full.
 *  ② `Test Client One` carries four real voice calls made from a phone, so its
 *    test-call step is permanently green and its go-live gate could never be
 *    exercised here at all.
 *  ③ The client half of this file needs an account the CLIENT user actually
 *    owns; a client sent at any other account is redirected by
 *    `requireAccountAccess` long before `requireAgencyOnlyAccountAccess` — the
 *    redirect under test — is ever reached.
 */
test.describe.configure({ timeout: 120_000 });

type ClientFixture = { accountId: string; clerkUserId: string; companyName: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

/** The nine cards, in the order `deriveSetupStatus` returns them. */
const STEP_TITLES = [
  "Create the account",
  "Branding",
  "Business hours",
  "Voice profile",
  "Phone number",
  "Email identity",
  "Call forwarding",
  "Test call",
  "Go live",
];

/** Every state chip a card can wear (lib/messages.ts, `setup.state.*`). Listed
 *  in full so `expectStepState` can assert the OTHERS are absent: a card that
 *  says "Done" while also saying "To do" is a bug this would otherwise pass. */
const STATES = ["Done", "To do", "Skipped", "Couldn't check — reload to retry"] as const;
type StepState = (typeof STATES)[number];

/**
 * Asserted on the card's whole text rather than on the chip's own class list.
 * The chip is a `<span>` distinguished from the marker and the "Next up" badge
 * only by Tailwind utilities, and pinning those here would make a purely
 * visual refactor look like a functional regression. None of the four state
 * strings is a substring of any step's title or help copy, so a positive plus
 * three negatives is unambiguous.
 */
async function expectStepState(card: Locator, expected: StepState) {
  await expect(card).toContainText(expected);
  for (const other of STATES) {
    if (other !== expected) await expect(card).not.toContainText(other);
  }
}

test.describe("the setup wizard, as the agency", () => {
  /**
   * This spec's own precondition, established rather than assumed — the same
   * beforeAll client-branding.spec.ts needs, for the same reason.
   * client-access.spec.ts deliberately leaves the fixture's client access OFF,
   * and "setup" sorts after it. The agency half below does not care, but the
   * client half does: a disabled account is redirected to /no-access, which
   * would look exactly like the agency-only redirect this file is testing and
   * would pass for entirely the wrong reason.
   */
  test.beforeAll(async () => {
    const { accountId, clerkUserId } = fixture();
    await setClientAccess(serviceDb(), accountId, true, clerkUserId);
  });

  test("nine derived steps, hours that tell the truth, and a gated go-live", async ({ page }) => {
    const { accountId } = fixture();
    const db = serviceDb();
    const setupUrl = `/dashboard/accounts/${accountId}/setup`;

    try {
      // --- 1. All nine cards, in order ------------------------------------
      await page.goto(setupUrl);
      await expect(page.getByRole("heading", { name: "Client setup", level: 1 })).toBeVisible();

      // An exact, ORDERED set, not a count: the wizard's whole argument is
      // that it reads as one path from "nothing" to "live", so a card in the
      // wrong place is as wrong as a missing one — and two opposite errors
      // cancelling out is a shape this project has had to fix before.
      await expect(page.locator("ol > li h2")).toHaveText(STEP_TITLES);

      const card = (title: string) =>
        page.locator("ol > li").filter({
          has: page.getByRole("heading", { level: 2, name: title, exact: true }),
        });

      // --- 2. Go-live is gated, and says why ------------------------------
      // Stated as a precondition rather than assumed: `calls.spec.ts` seeds a
      // phone number onto this same fixture account and deletes it again, so a
      // leaked row from a killed run would change the blocked list below for a
      // reason that has nothing to do with the wizard. Failing here says that
      // out loud instead of failing on a confusing string diff.
      const { data: preNumbers, error: numbersErr } = await db
        .from("phone_numbers").select("id").eq("account_id", accountId);
      if (numbersErr) throw new Error(`setup spec: phone_numbers read failed: ${numbersErr.message}`);
      expect(
        preNumbers ?? [],
        "the fixture account must start with no phone number — a leaked row from calls.spec.ts " +
        "would change the go-live blocked list",
      ).toHaveLength(0);

      const goLive = card("Go live");
      await expect(page.getByRole("button", { name: "Go live" })).toBeDisabled();
      // Visible prose, not a `title` tooltip: a disabled button takes no
      // pointer events in several browsers and is out of the tab order, so an
      // operator staring at a dead button would have nothing to read.
      await expect(goLive).toContainText(
        "Finish these steps first: Business hours, Voice profile, Phone number, Test call",
      );

      // --- 3. THE HOURS REGRESSION GUARD ----------------------------------
      // Exit-gate call #1 greeted a real caller with "no availability" for
      // every day, from a calendar whose `open_hours` had been wiped while
      // everything upstream still said it was configured. `enabled` stayed
      // true throughout — which is exactly why "enabled means configured" is
      // the wrong question and this card asks a different one.
      const hours = card("Business hours");
      await expectStepState(hours, "To do");

      // Written through the service client, read back through the signed-in
      // agency user's own RLS-enforced session. That asymmetry is the point:
      // a grant the operator does not have makes this card go "Couldn't
      // check", and `expectStepState` fails rather than quietly passing.
      await getOrCreateCalendar(db, accountId, "e2e-setup-spec");
      await updateCalendarSettings(
        db, accountId,
        { enabled: true, openHours: { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]] } },
        "e2e-setup-spec",
      );
      await page.reload();
      await expectStepState(hours, "Done");

      // The wipe. `enabled` is untouched — only the windows go — so anything
      // reading the flag alone would still call this configured.
      await updateCalendarSettings(db, accountId, { openHours: {} }, "e2e-setup-spec");
      await page.reload();
      await expectStepState(hours, "To do");

      // And back, so the card is proven to track the rows in both directions
      // rather than merely having been red once.
      await updateCalendarSettings(
        db, accountId, { openHours: { mon: [["09:00", "17:00"]] } }, "e2e-setup-spec",
      );
      await page.reload();
      await expectStepState(hours, "Done");

      // --- 4. The email skip tick persists --------------------------------
      const email = card("Email identity");
      await expectStepState(email, "To do");
      await email.getByRole("button", { name: "Skip for now" }).click();

      // The database, not the button. A button that changed state proves a
      // render; this proves the row `setSetupTickAction` was supposed to write
      // actually landed — and it is the thing a reload can read back.
      await expect
        .poll(
          async () => {
            const rows = await listChecklistState(db, accountId);
            return rows.some(
              (r) => r.item_key === SETUP_TICK_KEYS.emailSkipped && r.done_at !== null,
            );
          },
          { message: "the email-skipped tick should reach checklist_items" },
        )
        .toBe(true);

      await page.reload();
      await expectStepState(email, "Skipped");
      await expect(email.getByRole("button", { name: "Un-skip" })).toBeVisible();

      // Skipping leaves the denominator rather than sitting in it forever —
      // the meter must be able to reach the end for an account that never
      // configures a sending identity.
      await expect(page.getByRole("progressbar", { name: "Setup progress" }))
        .toHaveAttribute("aria-valuetext", /of 8 steps done$/);
    } finally {
      // FK-child-first, and only rows this spec created. `checklist_items` and
      // `calendars` both reference `accounts`; the former has NO cascade
      // (migration 0007), so a leaked tick row would make auth.teardown's
      // account delete fail silently — a failure mode this suite has already
      // watched happen once.
      //
      // Logged rather than thrown: throwing from a `finally` REPLACES whatever
      // assertion failure the block above was already raising.
      for (const table of ["checklist_items", "calendars"]) {
        const { error } = await db.from(table).delete().eq("account_id", accountId);
        if (error) {
          console.error(`setup e2e cleanup: ${table} delete failed: ${error.message}`);
        }
      }
    }
  });
});

/**
 * The other half of the boundary. Navigation hides Setup from a client, but
 * hiding a link is not authorization — a client who knows the URL still
 * satisfies `requireAccountAccess` for their own account, and RLS along with
 * it. `requireAgencyOnlyAccountAccess` is the thing that actually says no, and
 * this is the only place it is exercised against a real client session.
 */
test.describe("a client cannot reach the setup wizard", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("the URL redirects to their own dashboard and the nav never offers it", async ({ page }) => {
    const { accountId } = fixture();

    await page.goto(`/dashboard/accounts/${accountId}/setup`);
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${accountId}/dashboard$`),
    );
    // Not a 403 and not a 404: the redirect must land somewhere real, with a
    // working nav. Without this, a redirect into an error page — or a sidebar
    // that failed to render at all — would satisfy every absence check below.
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("link", { name: "Calls", exact: true })).toBeVisible();

    // The absence checks, which only mean anything BECAUSE the positive one
    // above passed — an empty sidebar would satisfy them just as happily.
    await expect(sidebar.getByRole("link", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Voice", exact: true })).toHaveCount(0);
  });
});
