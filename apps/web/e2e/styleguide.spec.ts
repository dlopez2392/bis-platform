import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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

  test("ships the Northern Lights material in both themes", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    await expect(page.getByText("Ground & light", { exact: true })).toBeVisible();

    const probe = () =>
      page.evaluate((dark: boolean) => {
        document.documentElement.classList.toggle("dark", dark);
        const card = document.querySelector('[data-slot="card"]')!;
        const cs = getComputedStyle(card);
        return { filter: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || "", bg: cs.backgroundColor };
      }, dark);
    let dark = true;
    const d = await probe();
    // Glass shipped: blur(14px) — or, where backdrop-filter is unsupported, the opaque fallback #15131F.
    expect(d.filter.includes("blur") || d.bg === "rgb(21, 19, 31)").toBe(true);
    dark = false;
    const l = await probe();
    expect(l.bg).toBe("rgb(255, 255, 255)");
    await expect(page.getByText("Ground & light", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Primary action" })).toBeVisible();
  });
});

test.describe("the style guide is agency-only", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client is redirected away", async ({ page }) => {
    // POSITIVE CONTROL FIRST. An absence check alone passes just as happily
    // when the session is broken and every page is an error — the lesson this
    // suite's client specs have already been bitten by. Prove the session
    // works before proving this one route does not.
    const f = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };
    await page.goto(`/dashboard/accounts/${f.accountId}/contacts`);
    await expect(page.locator("aside").getByRole("link", { name: "Contacts", exact: true }))
      .toBeVisible();

    await page.goto("/dashboard/styleguide");
    // requireAgency() sends a non-agency caller to "/", NOT to their own
    // dashboard — that is requireAgencyOnlyAccountAccess's behaviour, and this
    // route has no accountId to send them to.
    await expect(page).not.toHaveURL(/styleguide/);
    await expect(page.getByRole("heading", { name: "Style guide" })).toHaveCount(0);
  });
});
