import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { clerkClient } from "@clerk/nextjs/server";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const ACCOUNT_NAME = "Test Client One";

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

    // The onboarding path ends on the checklist, not on a blank dashboard.
    // createClientAccount does a real Clerk organizations.createOrganization
    // API call, then createAccount, then a full applyBlueprint pass (five
    // asset kinds, each a sequential upsert-lookup-then-insert round trip) —
    // comfortably longer than the suite's default 10s expect timeout, so this
    // one wait gets an explicit allowance instead.
    await expect(page).toHaveURL(/\/checklist$/, { timeout: 30_000 });
    // Reused below (GAP 2 / GAP 3) so those checks don't need their own DB
    // round trip — this is the fresh account's own checklist route.
    const accountId = new URL(page.url()).pathname.split("/")[3];
    // The checklist route renders "Activation checklist" twice: once as the
    // page's own <h1> (PageHeader) and again inside ChecklistPanel's CardTitle
    // — both real, both correct, so a plain getByText is ambiguous under
    // Playwright's strict mode. Target the page heading specifically.
    await expect(page.getByRole("heading", { name: "Activation checklist" })).toBeVisible();

    // GAP 2: accounts.blueprintPartial is a pure function of the `apply`
    // search param on this route — it needs no forced applyBlueprint failure
    // to exercise (the failure-*detection* path is already covered at the db
    // layer in actions.ts). Direct navigation with ?apply=partial must show
    // the banner; the same route without it must not, or an operator would
    // see (or silently miss) a data-loss warning unrelated to what actually
    // happened during this account's creation. Matched on text, not
    // role="alert" — see the GAP 1 comment above on the route announcer.
    await page.goto(`/dashboard/accounts/${accountId}/checklist?apply=partial`);
    await expect(page.getByText(/did not apply/i)).toBeVisible();
    await page.goto(`/dashboard/accounts/${accountId}/checklist`);
    await expect(page.getByText(/did not apply/i)).toHaveCount(0);

    // setChecklistItemAction is a raw (unwrapped) form action — clicking submit
    // fires a real POST that Next.js's router intercepts, but page.click() only
    // waits for the click event, not for that request to land. Reloading
    // immediately raced it and lost the same way the earlier waits did: the
    // toggle hadn't reached the database yet, so the reload just re-served the
    // still-untouched row. Wait for the POST's response first, matching
    // pipeline.spec.ts's dragTo() helper.
    const togglePosted = page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/checklist"),
    );
    await page.getByRole("button", { name: "Buy a phone number" }).click();
    await togglePosted;
    await page.reload();
    await expect(page.getByRole("button", { name: "Buy a phone number" }))
      .toHaveAttribute("aria-pressed", "true");

    // GAP 3: on the account dashboard, ChecklistPanel's title links back to
    // the full checklist route (via the titleHref prop) so an unfinished
    // checklist stays reachable from the summary view. This account only has
    // "phone_number" ticked — 5 of 6 catalogue items remain — so the panel
    // renders in its non-compact form with the link. If titleHref stopped
    // being passed, CardTitle would render the plain string instead and no
    // such link would exist at all.
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    const checklistTitleLink = page.getByRole("link", { name: "Activation checklist" });
    await expect(checklistTitleLink).toBeVisible();
    await expect(checklistTitleLink)
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
