import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { serviceDb, getBranding, getVoiceProfile, brandDisplayName } from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { weeklyReportEmail } from "@/lib/email/templates/weekly-report";
import { weeklyMetrics } from "@/lib/reports/weekly-metrics";
import { lastWeekMonday, weekWindow } from "@/lib/reports/weekly-window";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const OUT = process.env.SCREENSHOT_DIR ?? "screenshots/out";

/**
 * The demo tenant, found the way the seeder names it. Nothing here is
 * hard-coded to one seeded run: ids change every time the account is rebuilt,
 * so the capture reads them rather than carrying a copy that goes stale the
 * first time somebody re-seeds.
 */
const DEMO_ORG_ID = "org_demo_resaca_air";

type Demo = {
  accountId: string;
  calendarPublicId: string;
  spanishCallId: string;
  /** The seed's own moment — see `pinClock`. */
  seededAt: number;
};

async function loadDemo(): Promise<Demo> {
  const db = serviceDb();
  const { data: account, error } = await db.from("accounts")
    .select("id, created_at, outbound_suppressed")
    .eq("clerk_org_id", DEMO_ORG_ID).maybeSingle();
  if (error) throw new Error(`could not read the demo account: ${error.message}`);
  if (!account) {
    throw new Error(
      `No demo account at ${DEMO_ORG_ID}. Run \`pnpm --filter @bis/db db:seed-demo\` ` +
      `(or the "Seed demo tenant" workflow) first.`);
  }
  // Refuse to photograph an account that is not the flagged demo. If this is
  // ever false, something has gone wrong enough that the pictures are the
  // least of it — and publishing a real client's workspace to a marketing
  // page would be the actual harm.
  if (account.outbound_suppressed !== true) {
    throw new Error(
      `The account at ${DEMO_ORG_ID} is not suppressed. Refusing to capture it: ` +
      `an unsuppressed account is not one the seeder built.`);
  }

  const { data: cal } = await db.from("calendars")
    .select("public_id").eq("account_id", account.id).maybeSingle();
  if (!cal) throw new Error("the demo account has no calendar — re-seed");

  // A Spanish call that got BOOKED: the transcript that carries the argument.
  const { data: call } = await db.from("calls")
    .select("id").eq("account_id", account.id)
    .eq("language", "es").eq("outcome", "booked")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!call) throw new Error("the demo account has no booked Spanish call — re-seed");

  return {
    accountId: account.id,
    calendarPublicId: cal.public_id,
    spanishCallId: call.id,
    seededAt: Date.parse(account.created_at),
  };
}

/**
 * Pins the browser clock to the moment the demo was seeded, plus a few hours
 * so "today" has a plausible amount of day behind it.
 *
 * This makes anything the CLIENT renders from `Date.now()` stable between
 * runs. It does NOT pin the server, which is where the dashboard's period
 * panels are computed — see screenshots/README.md. Re-seeding immediately
 * before capturing is the lever that actually matters; this is the cheap part
 * that was worth doing anyway.
 */
async function pinClock(page: Page, demo: Demo) {
  await page.clock.install({ time: new Date(demo.seededAt + 9 * 60 * 60 * 1000) });
}

/** next-themes persists to localStorage; set it before the app boots so no
 *  capture catches the light-to-dark repaint. */
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("theme", t); } catch { /* private mode */ }
  }, theme);
}

/**
 * Waits for the page to be worth photographing, rather than for a timeout.
 *
 * `networkidle` alone is not enough on a dashboard whose panels stream in:
 * it can settle while a skeleton is still on screen, and a screenshot of a
 * skeleton is a screenshot of the product looking broken. DESIGN.md's rule 7
 * gives skeletons a shape, which is exactly what makes them detectable.
 */
async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-skeleton], .animate-pulse')).toHaveCount(0, { timeout: 20_000 });
  // Fonts, so no capture lands mid-swap with a fallback face.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function shoot(page: Page, file: string) {
  mkdirSync(OUT, { recursive: true });
  // NO `scale: "css"`. That option means one image pixel per CSS pixel, which
  // throws away the deviceScaleFactor: 2 the contexts below are created with
  // — the first capture run produced 1280x800 and 640x800 while the website's
  // lib/platform-tour.ts declares 2560x1600 and 1280x1600, so every image
  // would have been half-resolution on any retina screen. Playwright's
  // default is "device", which is what the comment under WIDE has always
  // claimed this does.
  await page.screenshot({ path: path.join(OUT, file) });
}

// Output is 2x the viewport: deviceScaleFactor 2 in the project's device
// preset. 1280x800 -> 2560x1600, which is what lib/platform-tour.ts declares
// on the website side. Those two numbers have to agree or next/image reserves
// the wrong box.
const WIDE = { width: 1280, height: 800 };
/** Narrower and taller: the booking page and the email are portrait objects
 *  shown in a half-column, and an email is 600-odd pixels wide by convention. */
const NARROW = { width: 640, height: 800 };

test.describe("demo captures", () => {
  test("the six images /platform is waiting for", async ({ browser }) => {
    const demo = await loadDemo();

    const wide = await browser.newContext({ viewport: WIDE, deviceScaleFactor: 2 });
    const page = await wide.newPage();
    await pinClock(page, demo);

    // 1. The dashboard, dark. The hero, and the one that has to carry the
    //    Northern Lights ground — which is why it is NOT a themed tenant:
    //    the demo sets a brand colour but no neutral, so deriveTheme returns
    //    null and the chrome stays BIS's own. See lib/platform-tour.ts.
    await useTheme(page, "dark");
    await page.goto(`/dashboard/accounts/${demo.accountId}/dashboard`);
    await settled(page);
    await shoot(page, "dashboard-dark.png");

    // 2. The Spanish call, open. The transcript is the argument.
    await page.goto(`/dashboard/accounts/${demo.accountId}/calls/${demo.spanishCallId}`);
    await settled(page);
    await shoot(page, "call-detail-es.png");

    // 3. The log, including the rows that were not worth anybody's time.
    await page.goto(`/dashboard/accounts/${demo.accountId}/calls`);
    await settled(page);
    await shoot(page, "call-log.png");

    // 4. The board.
    await page.goto(`/dashboard/accounts/${demo.accountId}/pipeline`);
    await settled(page);
    await shoot(page, "pipeline.png");
    await wide.close();

    // 5. The booking page, LIGHT and signed out — this is what a customer
    //    sees, and a customer is not logged into anything. A fresh context
    //    rather than the authenticated one, so no dashboard chrome leaks in.
    const narrow = await browser.newContext({ viewport: NARROW, deviceScaleFactor: 2 });
    const pub = await narrow.newPage();
    await pinClock(pub, demo);
    await useTheme(pub, "light");
    await pub.goto(`/b/${demo.calendarPublicId}`);
    await settled(pub);
    await shoot(pub, "booking-page.png");

    // 6. The Monday email. Not a route — it is a template function, so it is
    //    COMPOSED exactly as weeklyReportPass composes it and then rendered
    //    into a blank page. Same metrics, same brand, same reassurance flags.
    //    An email mocked up with invented numbers would be the one image on
    //    the page that is not actually the product.
    const db = serviceDb();
    const zone = "America/Chicago";
    const at = new Date(demo.seededAt);
    const monday = lastWeekMonday(at, zone);
    const window = weekWindow(monday, zone);
    const priorMonday = lastWeekMonday(new Date(Date.parse(`${monday}T12:00:00Z`)), zone);
    const priorWindow = weekWindow(priorMonday, zone);

    const branding = await getBranding(db, demo.accountId);
    const profile = await getVoiceProfile(db, demo.accountId);
    const [now, prior] = await Promise.all([
      weeklyMetrics(db, demo.accountId, window, true),
      // The demo is six months old, so a prior week genuinely exists — the
      // pass's `priorValid` guard would pass here. If that ever stops being
      // true the email correctly renders the numbers with no comparison.
      weeklyMetrics(db, demo.accountId, priorWindow, true),
    ]);

    const { html } = weeklyReportEmail({
      brand: emailBrandNamed(branding, brandDisplayName(branding)),
      now, prior,
      dashboardUrl: null,
      reassurance: {
        receptionist: profile?.enabled ?? false,
        textBack: profile?.textback_enabled ?? false,
      },
    });

    const mail = await pub.context().newPage();
    await mail.setContent(html, { waitUntil: "networkidle" });
    await mail.evaluate(() => document.fonts.ready);
    // Full page: an email is as tall as it is, and cropping one to a viewport
    // would cut the four numbers this section exists to show.
    mkdirSync(OUT, { recursive: true });
    await mail.screenshot({ path: path.join(OUT, "weekly-report.png"), fullPage: true, scale: "css" });

    await narrow.close();
  });
});
