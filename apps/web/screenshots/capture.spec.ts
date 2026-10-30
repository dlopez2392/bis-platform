import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { serviceDb, getBranding, getVoiceProfile, brandDisplayName,
         DEMO_TIMEZONE } from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { m } from "@/lib/messages";
import { weeklyReportEmail, weeklyReportSubject } from "@/lib/email/templates/weekly-report";
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
 * The message as a phone's mail app opens it: who it is from, the subject,
 * when it arrived, then the message. Neutral on purpose — no mail app's own
 * look, because imitating one would be showing somebody else's product.
 *
 * Composed here rather than drawn on the website because two of its three
 * lines are the PRODUCT's: the From name is the one the pass sends under
 * (`fromName: brand.name`) and the subject is `weeklyReportSubject`, the
 * function the pass calls, on the same numbers as the message below it. A
 * website copy of either would drift the first time the numbers changed.
 * "Mon 8:00 AM" is the first tick of the pass's Monday band (08:00-11:00
 * local, lib/reports/weekly-window.ts `inMondayBand`).
 *
 * One line each for the sender and the time, the sender cut short with an
 * ellipsis, as a mail app does: the demo's brand name ("Resaca Air
 * Conditioning & Heating") wrapped onto two lines in the first phone-size
 * capture (run 38267925952) and pushed the time onto two lines with it.
 */
function withMailHeader(html: string, h: { from: string; subject: string; accent: string }): string {
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  // Literal colours: this is a stand-in for a mail app's chrome, painted into
  // a capture, not app UI — DESIGN.md's tokens have nothing to say about it.
  const avatar = /^#[0-9a-f]{6}$/i.test(h.accent) ? h.accent : "#52525b";
  const header = `<div style="background:#ffffff;border-bottom:1px solid #e4e4e7;padding:14px 16px 12px;
      font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b;">
    <div style="font-size:17px;font-weight:600;line-height:1.3;">${esc(h.subject)}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px;">
      <div style="width:36px;height:36px;border-radius:999px;background:${avatar};color:#ffffff;
          display:flex;align-items:center;justify-content:center;font-weight:600;font-size:16px;">${esc(h.from.slice(0, 1).toUpperCase())}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:15px;">
          <span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(h.from)}</span>
          <span style="flex:none;color:#71717a;font-size:13px;white-space:nowrap;">Mon 8:00 AM</span>
        </div>
        <div style="color:#71717a;font-size:13px;">to me</div>
      </div>
    </div>
  </div>`;
  const at = html.search(/<body[^>]*>/);
  if (at < 0) throw new Error("the weekly report has no <body> to open");
  const end = html.indexOf(">", at) + 1;
  return html.slice(0, end) + header + html.slice(end);
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
 * F-118 part 1: the capture's agency session is a fresh sign-in every run
 * (screenshots/auth.setup.ts), so the first account it opens has no live
 * visit and meets the chooser (`/dashboard/enter/<id>`) exactly as any other
 * agency sign-in does. Gives the demo account one reason — "Setup", the
 * truest one for a screenshot run — so every capture after this one lands on
 * the page it asked for. The demo's own access log keeps this visit's ids
 * only; no picture of the chooser or this visit is ever taken.
 */
async function enterOnce(page: Page, accountId: string) {
  if (new URL(page.url()).pathname.startsWith(`/dashboard/enter/${accountId}`)) {
    await page.getByRole("button", { name: m["accessLog.reason.setup"], exact: true }).click();
    await page.waitForURL(new RegExp(`/dashboard/accounts/${accountId}/dashboard$`));
  }
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
  // Clerk's own words for an agency session with no active organization, which
  // the topbar's switcher printed on every capture until screenshots/
  // auth.setup.ts gave the capture user one (CAPTURE_ORG there).
  await expect(page.getByText("No organization selected")).toHaveCount(0);
  await expect(page.locator('[data-skeleton], .animate-pulse')).toHaveCount(0, { timeout: 20_000 });
  // An error boundary is a settled page too, which is how the 2026-10-08
  // capture passed while photographing four "Something went wrong" screens
  // (every user-scoped read was refused by the database). A capture of an
  // error is a failed capture: fail here, naming the page, never upload it.
  await expect(page.getByText(m["error.title"]), `${page.url()} rendered the error boundary`).toHaveCount(0);
  // Fonts, so no capture lands mid-swap with a fallback face.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function shoot(page: Page, file: string, opts: { fullPage?: boolean } = {}) {
  mkdirSync(OUT, { recursive: true });
  // NO `scale: "css"`. That option means one image pixel per CSS pixel, which
  // throws away the deviceScaleFactor: 2 the contexts below are created with
  // — the first capture run produced 1280x800 and 640x800 while the website's
  // lib/platform-tour.ts declares 2560x1600 and 1280x1600, so every image
  // would have been half-resolution on any retina screen. Playwright's
  // default is "device", which is what the comment under WIDE has always
  // claimed this does.
  await page.screenshot({ path: path.join(OUT, file), ...opts });
}

// Output is 2x the viewport: deviceScaleFactor 2 in the project's device
// preset. 1280x800 -> 2560x1600, which is what lib/platform-tour.ts declares
// on the website side. Those two numbers have to agree or next/image reserves
// the wrong box.
const WIDE = { width: 1280, height: 800 };
/**
 * The dashboard alone is taller: 1280x1000 -> 2560x2000 (see below). At 800 the calls chart's day labels fell below the
 * bottom edge once a "LAST 7 DAYS" caption joined the page above the KPIs
 * (2026-10-09 capture). 880 rather than 900: at 900 the chart's legend fits
 * with room to spare, but the top 5px of the next element down showed as a
 * sliver along the bottom edge (capture run 37959965188). DESIGN.md wants a label under EVERY period, so a
 * chart photographed without its labels is the chart breaking its own rule.
 * `shoot` is preceded by a check that the axis is inside the frame, so the
 * next layout change that pushes it out fails the capture instead of cropping
 * it silently.
 * 1000 since 2026-10-26: the business status card ("Open / Closed today /
 * Running late / Storm", #286) joined the page above the chart and moved its
 * day labels down to 999.5, so the 880 capture failed this check. The
 * website's `heroShot` (2560x1760) changes to 2560x2000 the day it takes a
 * capture made at this size.
 */
const DASHBOARD = { width: 1280, height: 1000 };
/**
 * The booking page and the email, at the size of the phone they are read on
 * (2026-10-12). A customer opens the booking link from a text message; the
 * owner reads the Monday report in bed. Both used to be 640x800, a window no
 * real device has, which the website then had to shrink into a half-column:
 * the white half of each image was empty and the words were too small to
 * read. The website now draws a phone around these two (BIS-Website's
 * PhoneFrame), so they have to BE phone screens — a desktop layout shrunk
 * into a phone would be a picture of a page nobody sees.
 *
 * 390x797 at 3x -> 1170x2391: an iPhone 13-15's 390x844 screen less the
 * 47-point status bar the frame draws above it, at its real pixel density.
 * lib/platform-tour.ts declares the same two numbers on the website side.
 */
const PHONE = { width: 390, height: 797 };

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
    await page.setViewportSize(DASHBOARD);
    await page.goto(`/dashboard/accounts/${demo.accountId}/dashboard`);
    await enterOnce(page, demo.accountId);
    await settled(page);
    const axis = await page.locator('[data-slot="chart-axis"]').first().boundingBox();
    expect(axis, "the calls chart's day labels are not on the dashboard").not.toBeNull();
    expect(axis!.y + axis!.height, "the calls chart's day labels fall below the dashboard capture")
      .toBeLessThanOrEqual(DASHBOARD.height);
    await shoot(page, "dashboard-dark.png");
    await page.setViewportSize(WIDE);

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

    // 5. The booking page, DARK and signed out — this is what a customer
    //    sees, and a customer is not logged into anything. A fresh context
    //    rather than the authenticated one, so no dashboard chrome leaks in.
    //    Dark since 2026-10-26 (owner's call): the demo company's logo is
    //    drawn on black and sat as a black square on the light page, and the
    //    site that shows this image is dark. It is asked for with `?theme=`,
    //    the hint `embed.js` forwards from a host page — the hint stands in
    //    for a mode nobody fixed — so the account keeps no brand mode and its
    //    dashboard keeps BIS's own ground in the captures above.
    // `timezoneId` matters: the booking page renders slot times in the
    // VISITOR's zone and says so under the day strip. A runner with no zone
    // set is UTC, so the first capture read "Times shown in UTC" on a page
    // selling a Harlingen HVAC company. A customer looking at this is in the
    // Valley; so is the context now.
    // `isMobile`: a phone's browser, not a narrow desktop window. It honours
    // the page's viewport meta and draws no scrollbar gutter.
    const phone = await browser.newContext({
      viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: DEMO_TIMEZONE,
    });
    const pub = await phone.newPage();
    await pinClock(pub, demo);
    await useTheme(pub, "dark");
    await pub.goto(`/b/${demo.calendarPublicId}?theme=dark`);
    await settled(pub);
    // Today is pre-selected, and after about midday its last slot has passed:
    // the 2026-10-06 run, started at lunchtime, photographed "No times
    // available this day" for the website. Walk forward to the first day that
    // has open times, so the capture never depends on what time it was run.
    // And prefer a day with a few open times (2026-10-26): a capture run in
    // the afternoon caught today with one slot left, which reads as a
    // business with nothing free. The first day with FULL_DAY open times
    // wins; failing that, the first with any.
    const FULL_DAY = 3;
    const slots = pub.locator(".bis-booking-slot");
    const days = pub.locator(".bis-booking-day:not(:disabled)");
    // Day 0 is today, the pre-selected day, so clicking it records it too.
    let firstWithAny: number | null = null;
    for (let i = 0; (await slots.count()) < FULL_DAY && i < (await days.count()); i++) {
      await days.nth(i).click();
      await settled(pub);
      if (firstWithAny === null && (await slots.count()) > 0) firstWithAny = i;
    }
    if ((await slots.count()) < FULL_DAY && firstWithAny !== null) {
      await days.nth(firstWithAny).click();
      await settled(pub);
    }
    await expect(slots.first(), "no day this week has an open time — re-seed or check the demo calendar").toBeVisible();
    // The open times are what this image is for. A phone screen is a fixed
    // height, so a layout change that pushes them below it fails here rather
    // than shipping a booking page with no times on it.
    const slot = await slots.first().boundingBox();
    expect(slot!.y + slot!.height, "the booking page's first open time falls below the phone's screen")
      .toBeLessThanOrEqual(PHONE.height);
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

    const brand = emailBrandNamed(branding, brandDisplayName(branding));
    const { html } = weeklyReportEmail({
      brand,
      now, prior,
      dashboardUrl: null,
      reassurance: {
        receptionist: profile?.enabled ?? false,
        textBack: profile?.textback_enabled ?? false,
      },
    });

    // NOT `isMobile`, unlike the booking page. An email carries no viewport
    // meta, so a phone BROWSER would lay this out 980px wide and shrink it;
    // a mail app fits the message to the screen instead, which is what a
    // plain 390-wide window does. Same density as the booking page.
    const inbox = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3 });
    const mail = await inbox.newPage();
    await mail.setContent(withMailHeader(html, {
      from: brand.name,
      subject: weeklyReportSubject(now),
      accent: brand.accent.accent,
    }), { waitUntil: "networkidle" });
    await mail.evaluate(() => document.fonts.ready);
    // The viewport, not the full page: this is one phone screen. At 390 wide
    // the whole message is shorter than the screen; if a copy change ever
    // makes it longer, the four numbers must still be on it.
    //
    // Through `shoot` rather than its own page.screenshot call. This WAS its
    // own call, and it carried a second `scale: "css"` that the fix in shoot()
    // never touched — so five images came back at 2x and this one stayed at
    // 640x800 against a declared 1280x1600. One call site is the fix; a
    // second one is how the first bug survived being fixed.
    const last = await mail.getByText(/website visitors|bookings/).last().boundingBox();
    expect(last, "the report's numbers are not in the email").not.toBeNull();
    expect(last!.y + last!.height, "the report's last number falls below the phone's screen")
      .toBeLessThanOrEqual(PHONE.height);
    await shoot(mail, "weekly-report.png");

    await inbox.close();
    await phone.close();
  });
});
