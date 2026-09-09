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

    const probe = (dark: boolean) =>
      page.evaluate((isDark: boolean) => {
        document.documentElement.classList.toggle("dark", isDark);
        const card = document.querySelector('[data-slot="card"]')!;
        const cs = getComputedStyle(card);
        const btn = [...document.querySelectorAll('[data-slot="button"]')]
          .find((b) => b.textContent?.trim() === "Primary action")!;
        return {
          filter: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || "",
          bg: cs.backgroundColor,
          aside: getComputedStyle(document.querySelector("aside")!).backdropFilter,
          btn: getComputedStyle(btn).backgroundImage,
        };
      }, dark);
    const d = await probe(true);
    // Cards do NOT blur (danlo 2026-09-09 pm, deciding on the measurement:
    // blurred vs not on the real dashboard differs by a mean of 2.3/765 with
    // only 0.07% of pixels past 8/765, and it cost 7-9 of 52 frames scrolling
    // on an integrated GPU). The blur lives on the sidebar and the overlays,
    // which never scroll. Pin the RADIUS on the sidebar, not just "some blur":
    // Chromium supports backdrop-filter, so an `includes("blur")` check cannot
    // tell blur(14px) from blur(0px). The @supports-not fallback is pinned by
    // the unit parity test (src/lib/branding/northern-lights.test.ts).
    expect(d.filter, "dark card does not blur").toBe("none");
    expect(d.aside, "dark sidebar keeps the 14px blur").toBe("blur(14px)");
    // The BIS half of the composed-token fix: tokens.css declares
    // --gradient-primary on `*`/`.dark *` instead of :root/.dark, so every
    // element re-resolves it against the accent it inherits. The unthemed
    // agency path must still land on BIS's own accents — #8B7CF7 in dark
    // (first stop mixed 50% with white, which Chromium serializes in srgb),
    // #6D28D9 → #5B21B8 in light. client-access.spec.ts pins the tenant half.
    expect(d.btn, "dark primary button paints the BIS dark gradient").toBe(
      "linear-gradient(color(srgb 0.772549 0.743137 0.984314), rgb(139, 124, 247))",
    );
    const l = await probe(false);
    // Light cards are glass now: 72% white, so the lit ground tints them.
    expect(l.bg).toBe("rgba(255, 255, 255, 0.72)");
    // Light ships NO filter at all: blur(0px) is a non-none filter list and
    // would still cost a stacking context + a backdrop surface per element.
    expect(l.filter).toBe("none");
    expect(l.aside).toBe("none");
    expect(l.btn, "light primary button paints the BIS light gradient").toBe(
      "linear-gradient(rgb(109, 40, 217), rgb(91, 33, 184))",
    );
    // The lit ground actually paints: relative-colour glows resolved, behind
    // everything, fixed to the viewport.
    const g = await page.evaluate(() => {
      const el = document.querySelector('[data-slot="ground"]') as HTMLElement;
      const cs = getComputedStyle(el.firstElementChild as HTMLElement);
      return { img: cs.backgroundImage, z: getComputedStyle(el).zIndex, pos: getComputedStyle(el).position };
    });
    expect(g.img).toContain("radial-gradient(");
    expect(g.z).toBe("-10");
    expect(g.pos).toBe("fixed");
    await expect(page.getByText("Ground & light", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Primary action" })).toBeVisible();
    // Spec §5: one hero per screen — the styleguide is a screen too.
    await expect(page.locator('[data-hero="true"]')).toHaveCount(1);
    await expect(page.getByText("Pageviews ÷ 3")).toBeVisible();
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
