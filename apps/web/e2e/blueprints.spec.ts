import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const ACCOUNT_NAME = "Test Client One";

test("a blueprint captured from one company applies to a new one", async ({ page }) => {
  const stamp = Date.now();
  const blueprintName = `E2E Blueprint ${stamp}`;
  const companyName = `E2E Co ${stamp}`;

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
  // The checklist route renders "Activation checklist" twice: once as the
  // page's own <h1> (PageHeader) and again inside ChecklistPanel's CardTitle
  // — both real, both correct, so a plain getByText is ambiguous under
  // Playwright's strict mode. Target the page heading specifically.
  await expect(page.getByRole("heading", { name: "Activation checklist" })).toBeVisible();

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

  // Cleanup: this writes real rows to the shared dev database.
  const db = serviceDb();
  const { data: acct } = await db.from("accounts").select("id").eq("name", companyName).single();
  if (acct) {
    for (const t of ["checklist_items", "events", "form_submissions", "forms",
                     "pipeline_stages", "pipelines", "custom_fields", "custom_values",
                     "tags", "contacts"]) {
      await db.from(t).delete().eq("account_id", acct.id);
    }
    await db.from("accounts").delete().eq("id", acct.id);
  }
  await db.from("blueprints").delete().eq("name", blueprintName);
});
