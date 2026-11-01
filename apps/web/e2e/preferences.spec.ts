import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { readClientFixture } from "./support";
import { THEME_COOKIE } from "../src/lib/branding/theme-mode";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every spec that talks to Supabase directly
// from the runner process (the afterAll below) rather than through a Next
// request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Mis preferencias (F-096, Task 7): a person's own language and theme, from
 * the user menu to the server's first paint — steps 1-4 as the agency
 * (default storage state, a per-run throwaway identity: fixtures/clerk-
 * identities.ts), step 5 as the per-run fixture's client Owner. Never the
 * real person, never Test Client One (CLAUDE.md fixture discipline) — every
 * identity here is minted fresh by auth.setup.ts for this run alone.
 *
 * Steps 1-4 share state on purpose (one agency identity, one Postgres row):
 * step 1 ends on English, step 2 starts there and ends there again, step 3
 * starts on no-theme-yet and ends on "dark". `test.describe.serial` means a
 * failure in an earlier step skips the rest instead of asserting against
 * whatever state the broken step left behind.
 *
 * WHY STEP 3 READS A RAW FETCH, NOT THE HYDRATED DOM. next-themes applies
 * its class to <html> ONLY via a client-side bootstrap `<script>` it injects
 * (node_modules/next-themes: the `_` component, `dangerouslySetInnerHTML`
 * running `M` against `[attribute, storageKey, defaultTheme, ...]`) — the
 * <html> tag this app's own root layout renders
 * (`src/app/(dashboard)/layout.tsx`) carries no mode class of its own, ever.
 * A real browser's class, read after hydration, is therefore not proof of
 * what the SERVER resolved: `ThemeCookieSync`'s effect (`theme-cookie-
 * sync.tsx`) calls `setTheme(userTheme)` within one tick whenever next-
 * themes' own resolved `theme` disagrees with the person's stored choice —
 * exactly the condition this test manufactures — which would silently
 * repaint the live page back to the right answer and hide a server-side
 * regression in `pickRequestThemeMode`'s call. `page.request.get()` never
 * runs any script, so it is the one place that bootstrap script's own
 * embedded `defaultTheme` argument (a literal `"light"`/`"dark"`/`"system"`
 * baked into the raw HTML by the SERVER, before any JS runs) can be read.
 * `rawServerThemeDefault` below extracts exactly that.
 */

const AGENCY_FIXTURE_FILE = "e2e/.auth/agency-fixture.json";
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

function agencyClerkUserId(): string {
  if (!existsSync(AGENCY_FIXTURE_FILE)) {
    throw new Error(
      `preferences.spec: ${AGENCY_FIXTURE_FILE} is missing — the "setup" project did not run. ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  const { clerkUserId } = JSON.parse(readFileSync(AGENCY_FIXTURE_FILE, "utf-8")) as { clerkUserId: string };
  return clerkUserId;
}

/** `{key}`-style holes, the same replication staff-roles.spec.ts carries —
 *  this file only needs whole-string matches against rendered toasts. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), template);
}

/** A sonner toast carrying this exact rendered sentence somewhere in its text. */
function toastWithText(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/**
 * The Preferences page's own content. /dashboard/preferences has a loading.tsx, and React 19.2's
 * streamed reveal can leave a hidden copy of the page outside <main> (support.ts's RECORD_PAGE
 * CONVENTION; the same duplicate met on /tasks, /team and /documents), which would make an unscoped
 * radio click or heading check resolve to 2 elements. Every presence check and every click on the page
 * goes through <main>; the sidebar, the user menu, the palette and toasts live outside it by design.
 */
function prefs(page: Page) {
  return page.getByRole("main");
}

/**
 * The literal `defaultTheme` argument next-themes' own no-flash bootstrap
 * script bakes into the raw SSR response — see the file-level comment for
 * why this, and not the <html> tag's class attribute, is the real pre-
 * hydration signal. Depends on this app's ThemeProvider never overriding
 * `attribute` (="class") or `storageKey` (left at next-themes' own default,
 * "theme") — `theme-provider.tsx` passes neither, so the script's first two
 * stringified arguments are always exactly `"class","theme",`.
 *
 * Throws, rather than returning undefined, when the pattern is absent: a
 * silent "no match" here would make every call site's assertion vacuously
 * impossible to fail if next-themes ever changes its script's shape, which
 * is exactly the kind of test-cannot-fail defect this suite exists to avoid.
 */
function rawServerThemeDefault(html: string): "light" | "dark" | "system" {
  const found = html.match(/\("class","theme","(light|dark|system)"/);
  if (!found) {
    throw new Error(
      "preferences.spec: next-themes' bootstrap script (or its \"class\",\"theme\",<mode> argument " +
      "shape) was not found in the raw response — this probe needs updating, not loosening.",
    );
  }
  return found[1] as "light" | "dark" | "system";
}

test.describe.serial("the agency's own language and theme (user menu, title, sidebar, ⌘K)", () => {
  // Step 1. Signed in as the agency (default storage state — fixtures/
  // clerk-identities.ts's per-run throwaway, never the real person).
  test("the user menu opens Preferences, and a language choice repaints the sidebar on every account", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }

    await page.goto("/dashboard/accounts");
    await page.locator(".cl-userButtonTrigger").click();
    await page.getByText(m["prefs.menuItem"], { exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/preferences$/);
    await expect(prefs(page).locator("[data-prefs-page]")).toBeVisible();

    await prefs(page).getByRole("radio", { name: "Español", exact: true }).click();
    // Expect the page title AFTER THE REFRESH: the title is sourced from
    // useLocale(), a context the server supplies, which only changes once
    // the save has landed and router.refresh() has re-rendered this page —
    // never from the radio's own optimistic local state. A generous timeout
    // covers the save's 600ms debounce (preference-handlers.ts's
    // PREFS_SAVE_DEBOUNCE_MS) plus the round trip.
    await expect(prefs(page).getByRole("heading", { level: 1, name: "Sus preferencias" })).toBeVisible({ timeout: 15_000 });

    // The agency's OWN language, not the account's: viewing a DIFFERENT
    // account's dashboard must still show the agency's chrome in Spanish.
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    const nav = page.locator("nav");
    // Positive control first (server-only-writes.spec.ts's own convention):
    // "Resumen" visible is what makes the absence check below meaningful,
    // rather than both being true of a sidebar that rendered nothing at all.
    //
    // Mutation: drop `userLanguage` from dashboard/layout.tsx's
    // requestLocale() call (plan departure 3's call-site change) → the
    // sidebar stays "Overview" → this line FAILS.
    await expect(nav.getByText("Resumen", { exact: true })).toBeVisible();
    await expect(nav.getByText("Overview", { exact: true })).toHaveCount(0);

    await page.goto("/dashboard/preferences");
    await prefs(page).getByRole("radio", { name: "English", exact: true }).click();
    await expect(prefs(page).getByRole("heading", { level: 1, name: "Your preferences" })).toBeVisible({ timeout: 15_000 });
  });

  // Step 2. Starts on English (step 1's own end state) — a spec that only
  // ran this file with a --grep would still start a fresh agency identity
  // with NO stored language at all, which languageChoiceFrom reads as
  // "nothing checked" rather than "English checked"; either starting point
  // still ends this test on English, which is the only thing asserted below.
  test("Undo returns the language to what it was, and speaks the language it lands on", async ({ page }) => {
    await page.goto("/dashboard/preferences");

    await prefs(page).getByRole("radio", { name: "Español", exact: true }).click();
    const savedToast = toastWithText(
      page, fillTemplate(m["prefs.saved.language.es"], { language: m["prefs.languageName.spanish.es"] }),
    );
    await expect(savedToast).toBeVisible({ timeout: 15_000 });
    await savedToast.hover();
    // The toast's OWN action label, in the language it is about (Español) —
    // not common.undo, which the team/staff toasts use instead.
    await savedToast.getByRole("button", { name: m["prefs.undo.es"], exact: true }).click();

    // Mutation: an Undo that calls the save action with the wrong previous
    // value (or none) leaves the Español radio checked here instead of
    // English, or leaves nothing checked at all.
    await expect(prefs(page).getByRole("radio", { name: "English", exact: true })).toBeChecked();
    await expect(prefs(page).getByRole("heading", { level: 1, name: "Your preferences" })).toBeVisible({ timeout: 15_000 });
    await expect(toastWithText(page, m["prefs.undone"])).toBeVisible();
  });

  // Step 3. The saved theme is what the server paints first — read from the RAW
  // response both times, in both directions, so neither assertion could
  // pass merely because "light" (or "dark") happens to be some fallback.
  test("a saved theme outranks a disagreeing cookie in the server's own first paint", async ({ page, baseURL }) => {
    await page.goto("/dashboard/preferences");

    await prefs(page).getByRole("radio", { name: "Light", exact: true }).click();
    await expect(toastWithText(page, m["prefs.saved.theme.light"])).toBeVisible({ timeout: 15_000 });
    // Manufacture the disagreement: without this, the cookie ThemeCookieSync
    // itself just wrote already matches the choice, and the test could pass
    // on a server that read the cookie instead of the stored theme.
    // No reload between the cookie and the fetch (final fix wave, I2): a
    // reload mounts ThemeCookieSync, which writes the stored choice back into
    // the cookie, so the server would then see an AGREEING cookie and the
    // assertion could pass on a server that reads the cookie. page.request
    // shares the context's cookie jar; the positive control below proves the
    // disagreeing value is what that request carried.
    const themeCookieNow = async () =>
      (await page.context().cookies(baseURL)).find((c) => c.name === THEME_COOKIE)?.value;
    await page.context().addCookies([{ name: THEME_COOKIE, value: "dark", url: baseURL }]);
    const litUrl = page.url();
    expect(await themeCookieNow()).toBe("dark");
    const litHtml = await (await page.request.get(litUrl)).text();
    expect(await themeCookieNow()).toBe("dark");
    // Mutation: drop `prefs.theme` from getRequestTheme's
    // pickRequestThemeMode(...) call (tenant-theme-reader.ts) → this reads
    // the disagreeing cookie's "dark" instead of the saved "light" → FAILS.
    expect(rawServerThemeDefault(litHtml)).toBe("light");

    await prefs(page).getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(toastWithText(page, m["prefs.saved.theme.dark"])).toBeVisible({ timeout: 15_000 });
    await page.context().addCookies([{ name: THEME_COOKIE, value: "light", url: baseURL }]);
    const darkUrl = page.url();
    expect(await themeCookieNow()).toBe("light");
    const darkHtml = await (await page.request.get(darkUrl)).text();
    expect(await themeCookieNow()).toBe("light");
    expect(rawServerThemeDefault(darkHtml)).toBe("dark");
  });

  // Step 4. The palette offers this destination to every caller — proven
  // here from the agency's top level (no account in scope at all), typing a
  // Spanish keyword regardless of which language is currently active.
  test("⌘K finds Preferences by a Spanish keyword and lands on the page", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await palette.getByRole("combobox").fill("idioma");
    const hit = palette.getByRole("option", { name: m["prefs.palette"], exact: true });
    // Mutation: dropping "idioma" from registry.ts's `nav:preferences` entry
    // keywords leaves this query matching nothing — the option never appears.
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();
    await expect(page).toHaveURL(/\/dashboard\/preferences$/);
  });
});

/**
 * Step 5. The per-run fixture's client Owner login (auth.setup.ts's
 * "authenticate as client user", unconditional on every run) — never Test
 * Client One. Read-only: nothing here saves a choice, so there is nothing
 * for this test's own cleanup to undo, and the file-level afterAll below
 * only ever touches the agency identity.
 */
test.describe("the client Owner's own preferences page", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client with no language of its own is offered three options, 'Follow the account' checked", async ({ page }) => {
    if (!existsSync(CLIENT_FIXTURE_FILE)) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }
    const fixture = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as { clerkUserId?: string };
    if (!fixture.clerkUserId) {
      test.skip(true, "The per-run client fixture has no clerkUserId — the setup project's client-user step did not run.");
      return;
    }

    await page.goto("/dashboard/preferences");
    // Positive control: the page genuinely loaded for this login, before the
    // count below is asked to mean anything.
    await expect(prefs(page).locator("[data-prefs-page]")).toBeVisible();

    const languageCard = prefs(page).locator('[data-prefs-card="language"]');
    const radios = languageCard.getByRole("radio");
    // Mutation: languageChoicesFor returning the agency's two-option list for
    // a client (dropping the isAgency branch) leaves this at 2, with no
    // "Follow the account" tile to find at all.
    await expect(radios).toHaveCount(3);
    await expect(languageCard.getByRole("radio", { name: m["prefs.language.account"], exact: true })).toBeChecked();
    await expect(languageCard.getByRole("radio", { name: "English", exact: true })).not.toBeChecked();
    await expect(languageCard.getByRole("radio", { name: "Español", exact: true })).not.toBeChecked();
  });
});

/**
 * Step 6. Steps 1-4 above leave the agency identity's `users` row with
 * language = "en" and theme = "dark" — a real saved choice, not NULL — so a
 * later spec in this same serial run must not find it. Keyed on
 * clerk_user_id, through the SAME service client staff-roles.spec.ts uses,
 * exactly like that file's own `finally` cleanup: never a membership write
 * (CLAUDE.md — the agency never gets one), never any row but this one.
 *
 * File-level (outside both describe blocks above) so it runs once after
 * every test in this file regardless of which ran — including a filtered
 * invocation that only reached step 5, where the agency identity was never
 * touched at all and this is a harmless no-op on a row already NULL.
 *
 * Independently wrapped, like every other spec's own cleanup in this suite:
 * a failure here must not retroactively fail a run that already passed.
 */
test.afterAll(async () => {
  if (!existsSync(AGENCY_FIXTURE_FILE)) return;
  try {
    const clerkUserId = agencyClerkUserId();
    const db = serviceDb();
    const { error } = await db.from("users").update({ language: null, theme: null }).eq("clerk_user_id", clerkUserId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(`preferences.spec cleanup: could not NULL the agency identity's preferences: ${String(e)}`);
  }
});
