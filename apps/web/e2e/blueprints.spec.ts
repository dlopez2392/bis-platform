import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { clerkClient } from "@clerk/nextjs/server";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const ACCOUNT_NAME = "Test Client One";

// This test's happy path drives ~8 page loads under [accountId]/ (settings
// x2, blueprints list, checklist x3, dashboard) plus a real Clerk
// organizations.createOrganization call and a five-asset-kind applyBlueprint
// pass — comfortably over Playwright's default 30s total budget even before
// counting that every converted page now pays dbForRequest()'s per-request
// Clerk-token-plus-RLS cost on top of Turbopack's dev-mode compile cost.
// Measured directly (10 hard navigations per route, median of
// application-code time from the Next.js dev server's own request log,
// dev server restarted between runs to isolate from in-process warm-up
// effects): settings ~1.0s, checklist ~0.7s, dashboard ~0.7s pre-RLS-conversion,
// vs ~1.3s / ~0.8s / ~0.8s after — a few hundred ms per page, the same
// order of magnitude as the run-to-run noise measured on
// /dashboard/blueprints, a route this task did NOT touch. Same class of
// problem forms.spec.ts already hit and fixed the same way (see its own
// comment): a borderline default budget tipped over by legitimate cost, not
// a functional regression.
test.describe.configure({ timeout: 60_000 });

test("a blueprint captured from one company applies to a new one", async ({ page }) => {
  const stamp = Date.now();
  const blueprintName = `E2E Blueprint ${stamp}`;
  const companyName = `E2E Co ${stamp}`;
  const db = serviceDb();

  // Wrapped so cleanup below still runs on an assertion failure. Before this,
  // a failed assertion anywhere above the cleanup block skipped it entirely,
  // leaving real "E2E Blueprint <stamp>" / "E2E Co <stamp>" rows behind in
  // the shared dev database — this cost real time three times during this
  // task's own gate runs and required a manual throwaway cleanup script each
  // time. blueprints is agency-scoped and not cleaned up by any test
  // fixture, so a leaked blueprint row persists and has previously broken
  // unrelated tests that counted them.
  try {
    await page.goto("/dashboard/accounts");
    await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
    await page.getByRole("link", { name: "Settings" }).click();

    // The positive counterpart to client-branding.spec.ts's absence check —
    // that spec proves a CLIENT never sees this field on their own /branding
    // page, but nothing anywhere proved an AGENCY admin does on Settings.
    // Without this, renaming settings.sendingAddress (say to "Sending
    // email") would leave that absence assertion passing forever: it would
    // no longer be checking for a field that exists under any name. Locked
    // to the identical getByLabel string on purpose, so a rename breaks
    // THIS assertion first — which is what keeps the other one honest.
    await expect(page.getByLabel("Sending address")).toBeVisible();

    await page.getByRole("button", { name: "Save as blueprint" }).click();
    await page.getByLabel("Blueprint name").fill(blueprintName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // captureBlueprintAction is an awaited Server Action fired from a client
    // onClick; page.click() only waits for the event dispatch, not for that
    // async chain (await action(formData) -> toast.success -> setOpen(false)).
    // Without this wait, navigating straight to /dashboard/blueprints below
    // races the mutation and reliably loses: the capture hasn't reached the
    // database yet, so the list still shows only pre-existing rows. The
    // "Blueprint saved" toast only renders after the awaited action resolves,
    // so waiting for it proves the write has landed.
    await expect(page.getByText("Blueprint saved")).toBeVisible({ timeout: 20_000 });

    // GAP 1: the overwrite warning is the only thing standing between an
    // operator and permanently destroying a previous capture's bundle — a
    // recapture under the same name replaces it with no version history and
    // no undo. `existing` (name/version pairs) is fetched once per page load
    // by the settings Server Component, so reload first to pick up the
    // blueprint just captured, then reopen the dialog and retype its exact
    // name. Matched on its exact rendered text rather than role="alert" —
    // Next.js's own App Router route announcer (#__next-route-announcer__,
    // present on every page once a client-side navigation has occurred) also
    // carries role="alert", so that role alone is ambiguous here.
    const overwriteWarningText = `"${blueprintName}" already exists (version 1)`;
    await page.reload();
    await page.getByRole("button", { name: "Save as blueprint" }).click();
    await page.getByLabel("Blueprint name").fill(blueprintName);
    await expect(page.getByText(overwriteWarningText)).toBeVisible();

    // A name that was never captured must not trigger it — a warning that
    // always shows is as useless as one that never does.
    await page.getByLabel("Blueprint name").fill(`${blueprintName} v2`);
    await expect(page.getByText(overwriteWarningText)).toHaveCount(0);

    await page.goto("/dashboard/blueprints");
    await expect(page.getByText(blueprintName)).toBeVisible();

    await page.goto("/dashboard/accounts");
    await page.getByRole("button", { name: /add company/i }).click();
    await page.getByLabel("Business name").fill(companyName);
    await page.getByRole("combobox", { name: "Apply a blueprint" }).click();
    await page.getByRole("option", { name: blueprintName }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // The onboarding path ends on the SETUP wizard, not on a blank dashboard
    // and no longer on the checklist — a brand-new account has nothing on it,
    // and the wizard is the screen that says what is missing and where to go
    // and do it (see createClientAccount's redirect).
    // createClientAccount does a real Clerk organizations.createOrganization
    // API call, then createAccount, then a full applyBlueprint pass (five
    // asset kinds, each a sequential upsert-lookup-then-insert round trip) —
    // comfortably longer than the suite's default 10s expect timeout, so this
    // one wait gets an explicit allowance instead.
    await expect(page).toHaveURL(/\/setup$/, { timeout: 30_000 });
    // Reused below (GAP 2 / GAP 3) so those checks don't need their own DB
    // round trip — this is the fresh account's own id.
    const accountId = new URL(page.url()).pathname.split("/")[3];
    // "Client setup" appears once, as the page's own <h1> (PageHeader) — the
    // setup panel's cards carry per-step headings instead.
    await expect(page.getByRole("heading", { name: "Client setup" })).toBeVisible();

    // GAP 2: accounts.blueprintPartial is a pure function of the `apply`
    // search param on this route — it needs no forced applyBlueprint failure
    // to exercise (the failure-*detection* path is already covered at the db
    // layer in actions.ts). Direct navigation with ?apply=partial must show
    // the banner; the same route without it must not, or an operator would
    // see (or silently miss) a data-loss warning unrelated to what actually
    // happened during this account's creation. Matched on text, not
    // role="alert" — see the GAP 1 comment above on the route announcer.
    //
    // Checked on the SETUP route, because that is where the redirect now
    // lands and therefore the only place the banner would ever be seen after
    // a real partial apply. The checklist route keeps its own copy of the
    // block for direct visits.
    await page.goto(`/dashboard/accounts/${accountId}/setup?apply=partial`);
    await expect(page.getByText(/did not apply/i)).toBeVisible();
    await page.goto(`/dashboard/accounts/${accountId}/setup`);
    await expect(page.getByText(/did not apply/i)).toHaveCount(0);

    // The checklist is still a live route with its own state — reached
    // directly now rather than by redirect.
    await page.goto(`/dashboard/accounts/${accountId}/checklist`);
    await expect(page.getByRole("heading", { name: "Activation checklist" })).toBeVisible();

    // setChecklistItemAction is a raw (unwrapped) form action — clicking submit
    // fires a real POST that Next.js's router intercepts, but page.click() only
    // waits for the click event, not for that request to land. Reloading
    // immediately raced it and lost the same way the earlier waits did: the
    // toggle hadn't reached the database yet, so the reload just re-served the
    // still-untouched row. Wait for the POST's response first, matching
    // pipeline.spec.ts's dragTo() helper.
    // The predicate must also match the BODY, not just method+URL: since the
    // Phase-2 shell, the sidebar fires its own server-action POST
    // (getShellSnapshot) on every account-route navigation,
    // and server actions POST to the current page URL — so on this route a
    // sidebar read also matches "/checklist" and can resolve this wait while
    // the toggle's own POST is still in flight, making the reload lose the
    // write. Only the toggle's multipart form body carries the itemKey.
    const togglePosted = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().includes("/checklist") &&
        (res.request().postData() ?? "").includes("phone_number"),
    );
    await page.getByRole("button", { name: "Buy a phone number" }).click();
    // .ok() check matches pipeline.spec.ts's dragTo: a resolved response that
    // carried an action error would otherwise read as "write raced the
    // reload" when it's really "write failed".
    expect((await togglePosted).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("button", { name: "Buy a phone number" }))
      .toHaveAttribute("aria-pressed", "true");

    // A2P: the item DERIVES from recorded account state, so this is the only
    // place the whole chain is exercised — panel → serviceDb write → the
    // checklist re-reading it. `a2p_*` carries no grant for `authenticated`
    // (migration 0023), and unit tests mock the database, so a write wrongly
    // routed through dbForRequest() would be green everywhere but here.
    const a2pItem = page.getByRole("button", { name: "Register A2P 10DLC brand and campaign" });
    await expect(a2pItem).toHaveAttribute("aria-pressed", "false");
    // Derived items must not offer a toggle: the row would be written and the
    // merge would ignore it, so the operator would click a box that never ticks.
    await expect(a2pItem).toBeDisabled();

    // `approved` with no identifiers is refused: it would tick an item that
    // reads "Register A2P 10DLC brand and campaign" for a company with no
    // campaign to send on, which is the exact false-true this phase exists to
    // stop. Refused with copy that names what is missing, not a generic error.
    await page.getByLabel("Status").click();
    await page.getByRole("option", { name: "Approved" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Both the brand ID and campaign ID are needed/)).toBeVisible();

    // 🔴 THE REGRESSION GUARD, and it must run WITHOUT a reload in between.
    // React resets a form once its `action` prop resolves — including to
    // {ok:false} — and Radix's Select listens for that reset and drives its
    // value back to first render, firing onValueChange. So a refused save
    // silently reverted the operator's chosen status while the fields still
    // looked filled, and their next Save wrote `not_started` with the ids
    // attached: an approval a human typed, stored as not-approved. Found on
    // the first real use of this panel, NOT by this suite — the earlier
    // version of this block reloaded here, which is exactly what hid it.
    // a2p-panel.tsx uses onSubmit rather than `action` because of this.
    await expect(page.getByLabel("Status")).toContainText("Approved");

    // And the operator's typing survives a refusal too — same reset, same
    // cause. Both fields were empty for the refusal, so fill them now.
    await page.getByLabel("Brand ID").fill("BRAND123");
    await page.getByLabel("Campaign ID").fill("CAMP456");
    // Deliberately NOT re-selecting the status: the whole point is that the
    // choice made before the refusal is still the choice being submitted.
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("A2P registration updated")).toBeVisible();

    // Derived, not ticked: the item reads done because the status says so, and
    // nothing ever wrote a checklist_items row for it.
    await expect(a2pItem).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByLabel("Brand ID")).toHaveValue("BRAND123");
    await expect(page.getByRole("button", { name: "Register A2P 10DLC brand and campaign" }))
      .toHaveAttribute("aria-pressed", "true");
    // The status carries its date — "with the carriers" means one thing a day
    // old and another a quarter old. Rendered in the ACCOUNT's timezone, and
    // the YEAR is asserted on purpose: `/^Recorded /` alone was format-blind,
    // and the first cut of this used a formatter that emits no year, so two
    // registrations a year apart rendered identically.
    await expect(page.getByText(/^Recorded \w+ \d+, 20\d\d$/)).toBeVisible();

    // And it goes BACKWARDS — new behaviour for this list, and the reason the
    // item cannot be a manual tick: a rejected registration must not keep
    // reading as done for a client who cannot legally text.
    await page.getByLabel("Status").click();
    await page.getByRole("option", { name: "Rejected" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("A2P registration updated")).toBeVisible();
    await expect(page.getByRole("button", { name: "Register A2P 10DLC brand and campaign" }))
      .toHaveAttribute("aria-pressed", "false");

    // GAP 3: the account dashboard's compact checklist row (checklist-row.tsx)
    // — NOT the full ChecklistPanel /checklist itself renders — links back to
    // the full checklist route, so an unfinished checklist stays reachable
    // from the summary view. This account has only "phone_number" ticked,
    // and A2P sitting at `rejected` from the block above — 1 of the 7
    // catalogue items done — so the row's own accessible name (an aria-label
    // on the Link, carrying the count) reads "Activation checklist (1 of 7
    // done)". If the row stopped rendering (or the isAgency gate around it
    // dropped for a client), no such link would exist at all.
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    const checklistRow = page.getByRole("link", { name: "Activation checklist (1 of 7 done)" });
    await expect(checklistRow).toBeVisible();
    await expect(checklistRow)
      .toHaveAttribute("href", `/dashboard/accounts/${accountId}/checklist`);

    // Everything above is generic post-account-creation behavior: the
    // checklist route, its heading, and the toggle-persists-after-reload
    // check would all pass identically for an account created with "No
    // blueprint" selected, because checklist_items is state-only and
    // independent of any blueprint's contents (see that table's comment in
    // migration 0007). This is M1d's sole automated proof of its headline
    // capability — "capture config from one company, apply it to a new
    // one" — so it needs an assertion that is actually blueprint-specific:
    // query the new account directly for rows the apply path wrote.
    //
    // `origin = 'blueprint'` (also migration 0007) is written only by
    // applyBlueprint's upsert helper, never by any user-driven CRUD path, so
    // it is the discriminator between "this account has config" and "this
    // config came from the blueprint apply". Check two independent asset
    // kinds actually captured from Test Client One (see buildBundle in
    // packages/db/src/blueprints.ts): the "Sales" pipeline plus its stages
    // — the order-dependent, two-table half of applyBlueprint, where a
    // pipeline insert is followed by per-stage inserts keyed off the new
    // pipeline's id — and the "Referral Source" custom field, a single flat
    // upsert. Either check alone already fails if createClientAccount stops
    // reading formData.get("blueprintId") or applyBlueprint is replaced
    // with a no-op; checking both also catches a defect scoped to just one
    // asset kind.
    const { data: newAcct } = await db.from("accounts").select("id")
      .eq("name", companyName).single();
    if (!newAcct) throw new Error(`new account "${companyName}" should exist after creation`);

    const { data: appliedPipeline } = await db.from("pipelines")
      .select("id, name").eq("account_id", newAcct.id).eq("origin", "blueprint").maybeSingle();
    expect(appliedPipeline?.name, "blueprint-sourced pipeline should exist on the new account")
      .toBe("Sales");
    if (!appliedPipeline) throw new Error("unreachable — the expect above already failed");

    const { data: appliedStages } = await db.from("pipeline_stages")
      .select("id").eq("pipeline_id", appliedPipeline.id).eq("origin", "blueprint");
    expect(appliedStages?.length, "blueprint-sourced pipeline should carry its stages too")
      .toBeGreaterThan(0);

    const { data: appliedField } = await db.from("custom_fields")
      .select("field_key").eq("account_id", newAcct.id).eq("origin", "blueprint").maybeSingle();
    expect(appliedField?.field_key, "blueprint-sourced custom field should exist on the new account")
      .toBe("referral_source");
  } finally {
    // Cleanup: this writes real rows to the shared dev database.
    const { data: acct } = await db.from("accounts")
      .select("id, clerk_org_id").eq("name", companyName).single();
    if (acct) {
      // createClientAccount (accounts/actions.ts) makes a real
      // organizations.createOrganization call before the account row ever
      // exists; nothing here used to clean it up, so every run of this test
      // left an orphan "E2E Co <stamp>" org in the shared Clerk dev instance.
      // Resilient on purpose: a failed delete (rate limit, org already
      // gone, credentials hiccup) must not throw out of a `finally` and mask
      // whatever real assertion failure the `try` block above hit.
      if (acct.clerk_org_id) {
        try {
          const clerk = await clerkClient();
          await clerk.organizations.deleteOrganization(acct.clerk_org_id);
        } catch (e) {
          console.error(`blueprints.spec cleanup: failed to delete Clerk org ${acct.clerk_org_id}: ${String(e)}`);
        }
      }
      for (const t of ["checklist_items", "events", "form_submissions", "forms",
                       "pipeline_stages", "pipelines", "custom_fields", "custom_values",
                       "tags", "contacts"]) {
        await db.from(t).delete().eq("account_id", acct.id);
      }
      await db.from("accounts").delete().eq("id", acct.id);
    }
    await db.from("blueprints").delete().eq("name", blueprintName);
  }
});
