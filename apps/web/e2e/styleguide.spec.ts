import { test, expect } from "@playwright/test";

test.describe("the style guide", () => {
  test("renders the component index for the agency", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    await expect(page.getByRole("heading", { name: "Style guide" })).toBeVisible();
    await expect(page.getByRole("button", { name: "destructive" })).toBeVisible();
    // DESIGN.md rule 3 — status is dot + WORD, never colour alone. This is
    // m["setup.state.unknown"] ("Couldn't check — reload to retry"); getByText
    // is a substring match, so the leading phrase is the right anchor.
    await expect(page.getByText("Couldn't check")).toBeVisible();
    // The rail's sixth kind, which only exists on the rail (StateKind + locked).
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
  });
});

test.describe("the style guide is agency-only", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client is redirected away", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    // requireAgency() sends a non-agency caller to "/", NOT to their own
    // dashboard — that is requireAgencyOnlyAccountAccess's behaviour, and this
    // route has no accountId to send them to.
    await expect(page).not.toHaveURL(/styleguide/);
    await expect(page.getByRole("heading", { name: "Style guide" })).toHaveCount(0);
  });
});
