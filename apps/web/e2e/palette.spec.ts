import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SEEDED_ACCOUNT_NAME, SEEDED_CONTACT_NAME, openAccountByName } from "./support";

/**
 * WHY THIS FILE EXISTS.
 *
 * The palette's live half rides `dbForRequest()` — an RLS-scoped client — and a
 * client session must see only its own rows. Every unit test around the search
 * route mocks the database and is blind to column grants; this project has
 * shipped three defects behind exactly that blind spot. Only the client-role
 * block at the bottom of this file can prove the grant and the policy are both
 * actually there.
 *
 * READ-ONLY BY DESIGN. This spec seeds nothing and deletes nothing, so the
 * agency half targets the shared seeded account (`support.ts`'s convention for
 * specs that only need to READ real rows). That also keeps it clear of the
 * opportunities/pipelines/tags tables `deleteAccountCascade` does not cover —
 * a stranded row there makes the whole account teardown fail.
 */

/** cmdk renders its input as a combobox and its rows as options. */
const PALETTE = "dialog";

test.describe("the command palette, as the agency", () => {
  test("opens on the shortcut, is named, and closes on Esc", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await expect(page).toHaveURL(/\/dashboard\/accounts\/[^/]+/);

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);
    await expect(palette).toBeVisible();
    // The dialog must be NAMED. The stock CommandDialog rendered its title
    // outside DialogContent, which left it unnamed for screen readers.
    await expect(palette).toHaveAccessibleName(/search/i);

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  });

  test("the shortcut still works while focus is in a text field", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);
    await expect(palette).toBeVisible();

    // cmdk focuses the palette's own input, so this press originates from an
    // EDITABLE element — the case the "don't steal Ctrl+K in a text field"
    // bail covers. That bail is macOS-only for a reason: on Windows and Linux
    // Ctrl+K is the only shortcut there is, and applying the guard everywhere
    // (as this shipped before review) made it impossible to close the palette
    // with the same keys that opened it. Every other press in this file
    // originates from document.body and cannot see that.
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toHaveCount(0);
  });

  test("a static destination is reachable with the keyboard alone", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);
    const options = palette.getByRole("option");

    // "cal" matches exactly two destinations — Calls, then Calendar in nav
    // order — so ArrowDown has somewhere to go and Enter lands deterministically.
    await palette.getByRole("combobox").fill("cal");

    // WAIT FOR THE FILTERED LIST TO SETTLE before touching the keyboard.
    // fill() returns before React has re-rendered, and keys pressed into the
    // still-unfiltered list silently act on whatever was second OVERALL
    // (Contacts) rather than second among the matches — which is exactly how
    // this test failed once before this guard existed.
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAccessibleName("Calls");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/calendar$/);
  });

  test("a settings section jumps to its own anchor, and the anchor exists", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole(PALETTE).getByRole("combobox").fill("custom fields");
    await page.getByRole("option", { name: "Custom fields" }).click();
    await expect(page).toHaveURL(/\/settings#custom-fields$/);
    // A registry entry pointing at a missing id looks exactly like the palette
    // doing nothing at all, so the anchor itself is the assertion.
    await expect(page.locator("#custom-fields")).toBeVisible();
  });

  test("typing a seeded contact returns it live and opens that contact", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);
    await palette.getByRole("combobox").fill(SEEDED_CONTACT_NAME.split(" ")[0]!);

    const hit = palette.getByRole("option", { name: new RegExp(SEEDED_CONTACT_NAME, "i") });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: SEEDED_CONTACT_NAME })).toBeVisible();
    // A 404 renders not-found.tsx, which still satisfies the URL check above.
    await expect(page.getByText("Page not found")).toHaveCount(0);
  });

  test("a query that matches nothing says so instead of going blank", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);
    await palette.getByRole("combobox").fill("zzzqqqnothingmatchesthis");
    await expect(palette.getByText(/nothing matches/i)).toBeVisible({ timeout: 15_000 });
  });

  test("a failed search shows an honest error, never an empty list", async ({ page }) => {
    await openAccountByName(page, SEEDED_ACCOUNT_NAME);
    // Silence on a failed fetch reads as "no such contact" — a lie about a
    // failure. Forcing the 500 is the only way to see that row.
    await page.route("**/api/accounts/*/search*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);
    // "call" deliberately: it matches STATIC destinations (Calls, Calendar) as
    // well as triggering the live search, which is what makes the last
    // assertion here meaningful. A query matching no destination would leave
    // the static half legitimately empty and prove nothing.
    await palette.getByRole("combobox").fill("call");
    await expect(palette.getByTestId("palette-error")).toBeVisible({ timeout: 15_000 });
    await expect(palette.getByRole("button", { name: /try again/i })).toBeVisible();
    // The static half must keep working — the palette is never wholly dead.
    await expect(palette.getByRole("option", { name: "Calls" })).toBeVisible();
  });
});

/**
 * The grant, through a real client session — the assertion no unit test can
 * make. The client fixture account has its own contact; `Test Client One`'s
 * Maria Garcia belongs to a DIFFERENT tenant and must be invisible here.
 */
test.describe("the command palette, as the client", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  type ClientFixture = { accountId: string; contactName: string };
  const fixture = (): ClientFixture =>
    JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

  test("searches its own records and cannot see another tenant's", async ({ page }) => {
    const f = fixture();
    await page.goto(`/dashboard/accounts/${f.accountId}/dashboard`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);

    // The POSITIVE case first — the M2 lesson. Every absence check in this
    // suite's client specs once passed while the client's whole CRM was a 404.
    await palette.getByRole("combobox").fill(f.contactName.split(" ")[0]!);
    await expect(
      palette.getByRole("option", { name: new RegExp(f.contactName, "i") }),
    ).toBeVisible({ timeout: 15_000 });

    // And now the boundary: another tenant's contact, by name, returns nothing.
    await palette.getByRole("combobox").fill(SEEDED_CONTACT_NAME);
    await expect(palette.getByText(/nothing matches/i)).toBeVisible({ timeout: 15_000 });
    // Asserted as an absent OPTION, not absent TEXT: the empty-state message
    // echoes the query back ("Nothing matches “Maria Garcia”."), so a plain
    // text check matches the empty state itself and can never fail.
    await expect(
      palette.getByRole("option", { name: new RegExp(SEEDED_CONTACT_NAME, "i") }),
    ).toHaveCount(0);
  });

  test("is never offered an agency-only destination", async ({ page }) => {
    const f = fixture();
    await page.goto(`/dashboard/accounts/${f.accountId}/dashboard`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole(PALETTE);

    // Positive control: the palette really is populated for this client.
    await expect(palette.getByRole("option", { name: "Contacts" })).toBeVisible();
    // The absence checks, which only mean anything because that passed.
    await expect(palette.getByRole("option", { name: "Voice", exact: true })).toHaveCount(0);
    await expect(palette.getByRole("option", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(palette.getByRole("option", { name: "Custom fields" })).toHaveCount(0);
  });
});
