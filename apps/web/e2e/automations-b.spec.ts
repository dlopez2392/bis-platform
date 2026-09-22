import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, setClientAccess, recordAutomationLog,
  ensureDefaultPipeline, listPipelinesWithStages,
  type RecipeKey,
} from "@bis/db";

// Same two paths, same reason, as every spec that talks to Supabase from the
// runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ timeout: 90_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
/** Read at RUN TIME, never at module scope (setup.spec.ts:70-84 explains the collection-time trap). */
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};
/** A per-run stamp on every string this file writes, so a killed run's row
 *  can never satisfy a later run's assertion. */
const STAMP = Date.now().toString();

/**
 * THE PRECONDITION NO FIXTURE OWNS. `client-access.spec.ts` switches the
 * fixture account's client access OFF and does not restore it, so the second
 * describe below — which signs in as the client — passes or fails on FILENAME
 * ORDER unless this runs. `automations-b` happens to sort before
 * `client-access` today; that is luck, not a guarantee, and both existing
 * specs that use `client-state.json` carry exactly this block for exactly this
 * reason (`automations.spec.ts:40-51`, `activity.spec.ts:23-27`). File-level,
 * not inside a describe, so it covers both.
 */
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

/**
 * The pipeline the stage-menu case creates, remembered so `afterAll` can
 * delete it. THIS IS NOT TIDINESS. `pipelines`/`pipeline_stages` carry a
 * plain (NO ACTION) `account_id` reference to `accounts` (0003_crm_core.sql)
 * and `deleteAccountCascade` (fixtures/sweep.ts, which auth.teardown.ts runs
 * unconditionally) does not touch those tables — so a pipeline left behind
 * makes the FINAL `accounts` delete fail outright and strands the real Clerk
 * user, org and account this run created in the shared production project.
 * `contacts-drawer.spec.ts:46-56` records the same hazard for the same tables
 * and cleans up the same way (an afterAll, in FK order; this file creates no
 * opportunities, so the pipeline is the whole list and its stages cascade).
 */
let createdPipelineId = "";

/**
 * DELETE the row, do not merely switch it off. The plan prescribed
 * `upsertAutomation(..., { enabled: false, ... })` here, and that is not a
 * restore: it leaves a real `automations` row behind on the fixture account,
 * and `automations.spec.ts:80` asserts the client's own PostgREST read
 * returns EXACTLY the one `review_request` row it seeded. Measured — the
 * first run of this file turned that spec red with four rows where it
 * expected one. The fix belongs here (this file is the one that added state),
 * never there: that exact-array assertion is what proves a client reads its
 * own row AND ONLY its own, and widening it to `toContainEqual` would delete
 * the second half of the proof.
 *
 * No row also means not enabled, so the original reason for the cleanup — a
 * recipe left on would text the fixture's contacts on the next real cron
 * tick — is honoured more strongly, not less.
 */
async function forgetRecipe(accountId: string, recipeKey: RecipeKey) {
  const { error } = await serviceDb().from("automations")
    .delete().eq("account_id", accountId).eq("recipe_key", recipeKey);
  if (error) throw new Error(`automations-b e2e: could not clean up ${recipeKey}: ${error.message}`);
}

test.afterAll(async () => {
  if (!createdPipelineId) return;
  const { error } = await serviceDb().from("pipelines").delete().eq("id", createdPipelineId);
  // Logged, not thrown: a throw here would mask whatever the tests reported,
  // and the message is what tells a human the account needs sweeping.
  if (error) console.error(`automations-b e2e: pipeline cleanup failed for ${createdPipelineId}: ${error.message}`);
});

test.describe("part B's recipes on the Automations page (agency)", () => {
  test("all four cards render, and each one says what it does before it is turned on", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    for (const id of ["appointment-confirm-card", "referral-ask-card", "reactivation-card", "quote-followup-card"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // The pipeline caveat is on the card, in the operator's language, because
    // this recipe only fires for a client who works the board. Quoted from
    // `automations.quoteFollowup.body` as it actually reads (messages.ts:1317)
    // rather than from the plan's paraphrase, which no card ever emitted.
    await expect(page.getByTestId("quote-followup-card"))
      .toContainText("Deals only get there when you or your team put them there, so nothing happens on its own.");
    // No recipe KEY ever reaches a screen.
    await expect(page.locator("body")).not.toContainText("appointment_confirm");
    await expect(page.locator("body")).not.toContainText("quote_followup");
  });

  test("saving the confirmation ask round-trips a closing line that is NOT a default", async ({ page }) => {
    const { accountId } = fixture();
    const line = `Park on the street ${STAMP}.`;
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("appointment-confirm-card");
      await card.getByRole("checkbox").check();
      await card.getByLabel("Closing line").fill(line);
      // The preview is computed through the SAME composer the pass uses, so
      // this is also the proof the operator's count is the billed count.
      const preview = card.getByTestId("appointment-confirm-preview");
      await expect(preview).toContainText(line);
      // The fixed reassurance decision 6 buys, asserted with the case the
      // catalogue actually carries: `toContainText` is substring-exact, and
      // the plan's lower-case "either way we'll see it" matches nothing.
      await expect(preview).toContainText("Either way we'll see it.");
      // The card counts and SHOWS the disclosed body, because that is what
      // the carrier bills and what the customer receives (send-sms.ts:82).
      await expect(preview).toContainText("Reply STOP to opt out.");
      await card.getByRole("button", { name: "Save appointment confirmations" }).click();
      // The toast is the thing that SETTLES — it is raised after the server
      // action resolves — so the reload below cannot race the write.
      await expect(page.getByText("Appointment confirmations saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("appointment-confirm-card");
      await expect(after.getByLabel("Closing line")).toHaveValue(line);
      await expect(after.getByRole("checkbox")).toBeChecked();
    } finally {
      await forgetRecipe(accountId, "appointment_confirm");
    }
  });

  /**
   * WHAT THIS CASE CANNOT BE. It was written as "fill 24, expect the server's
   * 'Choose a number of months between 6 and 18.'" — and that can never pass.
   * The field is `<Input type="number" min={6} max={18}>` inside a plain
   * `<form onSubmit>` handled by `useFormSubmit` (`lib/forms/use-form-submit.ts`,
   * a handler that only ever runs on a `submit` event the browser chose to fire),
   * with no `noValidate`: the browser refuses to dispatch `submit` at all when
   * constraint validation fails, so 24 is refused exactly as 999 would be, the
   * server action never runs, and the assertion times out. The parser's
   * refusal is real and is proved where it can be — `actions.test.ts`, Task 8.
   * So this asserts the two things only a browser can show: that the refusal
   * happens at all, and that a VALID non-default value round-trips.
   */
  test("the reactivation card refuses an out-of-range month count in the browser, and round-trips a valid one", async ({ page }) => {
    const { accountId } = fixture();
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("reactivation-card");
      await card.getByRole("checkbox").check();
      const months = card.getByLabel("Quiet for at least");

      // The browser's own refusal, asserted as what it is. Mutation: drop
      // `max={REACTIVATION_MAX_MONTHS}` from the card → `rangeOverflow` is
      // false and this reds.
      await months.fill("24");
      expect(await months.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(true);

      // 12: inside the range, and NOT the 9 the card defaults to
      // (REACTIVATION_DEFAULT_MONTHS, automations.ts:1037), so a page that
      // re-rendered the default after saving could not pass this.
      await months.fill("12");
      await card.getByRole("button", { name: "Save check-ins" }).click();
      await expect(page.getByText("Check-ins saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("reactivation-card");
      await expect(after.getByLabel("Quiet for at least")).toHaveValue("12");
      // It is a cap, so it ships with its context (DESIGN.md rule 1).
      await expect(after).toContainText("At most five a day");
    } finally {
      await forgetRecipe(accountId, "reactivation");
    }
  });

  /**
   * THE ONE ASSERTION NO UNIT TEST IN THIS REPO CAN MAKE. Radix mounts
   * `SelectContent` in a portal only while the menu is OPEN, so
   * `renderToStaticMarkup` emits `<select aria-hidden="true" name="stage_id">`
   * with no options at all and Task 10 measured a `toContain("Quoted")`
   * assertion FAILING against a correct card. A real browser is the only
   * place the option list exists, which is why this case is here and not
   * beside the card.
   *
   * The expected labels are READ BACK from the pipeline rather than typed in:
   * `DEFAULT_STAGES` (crm-config.ts:54) is not this spec's to pin, and a
   * hand-copied list would rot the day someone renames a stage.
   */
  test("the quote follow-up stage menu lists the account's real stages, and the one the operator picks round-trips", async ({ page }) => {
    const { accountId } = fixture();
    // The fixture account is created with a contact, branding and a form, and
    // NO pipeline (auth.setup.ts) — so the card's honest state there is
    // "no pipeline stages yet". Give it the pipeline every real account gets
    // the first time someone opens the board; `afterAll` takes it away again.
    const { pipelineId } = await ensureDefaultPipeline(serviceDb(), accountId);
    createdPipelineId = pipelineId;
    const pipelines = await listPipelinesWithStages(serviceDb(), accountId);
    const labels = pipelines.flatMap((p) => p.stages.map((s) => s.name));
    // Not a pinned count: a pipeline that came back with one stage (or none)
    // would make the "picked the second one" proof below meaningless, and the
    // failure should name that rather than time out on a missing option.
    expect(labels.length, `the default pipeline should seed several stages, got ${JSON.stringify(labels)}`)
      .toBeGreaterThan(1);
    // The SECOND stage, never the first: a menu that always yields its first
    // item would pass a first-stage pick.
    const chosen = labels[1]!;

    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("quote-followup-card");
      await expect(card.getByTestId("quote-followup-no-stages")).toHaveCount(0);
      await card.getByRole("checkbox").check();

      await card.getByLabel("Pipeline stage to watch").click();
      // Portal: the options are attached to the body, not inside the card.
      const options = page.getByRole("option");
      await expect(options).toHaveCount(labels.length);
      for (const label of labels) {
        await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
      }

      await page.getByRole("option", { name: chosen, exact: true }).click();
      await card.getByRole("button", { name: "Save quote follow-ups" }).click();
      await expect(page.getByText("Quote follow-ups saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("quote-followup-card");
      await expect(after.getByLabel("Pipeline stage to watch")).toContainText(chosen);
      // The stage is stored by ID, so a card that had lost the mapping would
      // render its own "the stage this automation watches is gone" state.
      await expect(after.getByTestId("quote-followup-stage-missing")).toHaveCount(0);
    } finally {
      // Gone, not merely off: the pipeline is about to be deleted and a
      // surviving row must not be left naming a dead stage.
      await forgetRecipe(accountId, "quote_followup");
    }
  });
});

test.describe("part B on the Activity page (client)", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a part B row renders with the recipe's TITLE and a reason the code could not produce by default", async ({ page }) => {
    const { accountId } = fixture();
    const subjectKey = `booking:e2e-${STAMP}`;
    const reason = `E2E reason ${STAMP}`;
    try {
      await recordAutomationLog(serviceDb(), {
        accountId, source: "appointment_confirm", channel: "sms", contactId: null,
        subjectKey, status: "skipped", reason,
      });
      // Address the row BY ID, not `.first()`. `.first()` asserts against
      // whatever the page happens to sort to the top, which is state no
      // fixture in this file owns — the shape `contacts-drawer.spec.ts:371`
      // has been caught by six times on this shared project.
      const { data: written, error } = await serviceDb().from("automation_log")
        .select("id").eq("account_id", accountId).eq("source", "appointment_confirm")
        .eq("subject_key", subjectKey).single();
      if (error || !written) throw new Error(`could not read back the log row: ${error?.message}`);

      await page.goto(`/dashboard/accounts/${accountId}/activity`);
      const row = page.locator(`[data-log-row="${written.id}"]`);
      await expect(row).toContainText("Appointment confirmations");
      await expect(row).not.toContainText("appointment_confirm");
      await expect(row).toContainText("Skipped");
      await expect(row).toContainText(reason);
      // Mutation: render `row.source` instead of SOURCE_TITLES[row.source] →
      // both the positive and the negative assertion red.
    } finally {
      const { error } = await serviceDb().from("automation_log")
        .delete().eq("account_id", accountId).eq("subject_key", subjectKey);
      // READ, not ignored: this is the shared production project, and a
      // silently failed delete leaves a stamped `automation_log` row on the
      // fixture account for ever. LOGGED and not thrown, matching `afterAll`
      // above and for the same reason — a throw in a `finally` replaces
      // whatever the test actually reported with the cleanup's own failure.
      // (`forgetRecipe` does throw, and that difference is deliberate: a
      // surviving `automations` row would TEXT somebody on the next real
      // cron tick, where a surviving log row is only litter.)
      if (error) {
        console.error(`automations-b e2e: automation_log cleanup failed for ${subjectKey}: ${error.message}`);
      }
    }
  });
});
