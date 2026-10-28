import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, createBooking, getOrCreateCalendar, readPersonId } from "@bis/db";
import { openFixtureCalendar } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly (cleanup below), not through a
// Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-048 part 2: the owner's calendar feed, end to end, on the PER-RUN FIXTURE
 * ACCOUNT ONLY — never `Test Client One` (support.ts's own rule: anything
 * that mutates account state belongs here, and making/turning off/replacing
 * a calendar link is exactly that). The fixture Owner's session
 * ("e2e/.auth/client-state.json", the same storageState idiom
 * contacts-drawer.spec.ts and client-access.spec.ts use) is what the card
 * reads — the agency session the rest of this suite signs in as sees no
 * link at all (plan deviation: "the agency gets none").
 *
 * One journey, not several: every later step depends on the field value
 * (and in one case the URL) the earlier step produced, and the suite already
 * runs `workers: 1` against one shared build+database.
 */
type ClientFixture = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";
function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  return parsed.accountId && parsed.clerkUserId ? { accountId: parsed.accountId, clerkUserId: parsed.clerkUserId } : null;
}

test.describe.configure({ timeout: 120_000 });

test.describe("F-048 part 2: the calendar feed, on the fixture account", () => {
  // The fixture OWNER's cookie jar, not the agency session every other
  // project in this config signs in as — the card has nothing to show an
  // agency member (view.kind === "agency").
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("make, fetch with no auth, turn off, undo, replace, and the Spanish card", async ({ page, request }) => {
    const fixture = readFixture();
    if (!fixture) {
      test.skip(true, `No client fixture at ${CLIENT_FIXTURE_FILE} — the setup project creates it; run the full suite.`);
      return;
    }
    const db = serviceDb();
    const stamp = Date.now();
    // A real first name with no digit (feedFirstName drops any word containing
    // one, as a dropped-placeholder guard) and a real phone/email ON FILE, so
    // "no phone, email or video link" is a claim that could actually fail —
    // not a vacuous check against a contact that never carried them.
    const contactFirstName = "Priya";
    const contactLastName = `CalFeed ${stamp}`;
    const contactEmail = `e2e+calfeed${stamp}@example.com`;
    const contactPhone = `+1956295${String(Math.floor(Math.random() * 9000) + 1000)}`;

    let contactId = "";
    let bookingId = "";
    let ownerUserId: string | null = null;
    let firstUrl = "";

    try {
      // --- Step 1: a booking 2 days ahead, on the fixture account's own calendar ---
      ({ id: contactId } = await createContact(
        db, fixture.accountId,
        { firstName: contactFirstName, lastName: contactLastName, email: contactEmail, phone: contactPhone },
        fixture.clerkUserId,
      ));
      const calendar = await getOrCreateCalendar(db, fixture.accountId, fixture.clerkUserId);
      const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + calendar.slot_duration_minutes * 60_000);
      ({ id: bookingId } = await createBooking(
        db, fixture.accountId, { calendarId: calendar.id, contactId, startsAt, endsAt }, fixture.clerkUserId,
      ));
      ownerUserId = await readPersonId(db, fixture.accountId, fixture.clerkUserId);

      // --- Step 2: open the Calendar page as the Owner and make the link ---
      await openFixtureCalendar(page);
      await expect(page).toHaveURL(/\/calendar$/);
      await page.getByRole("button", { name: "Make my link" }).click();
      const field = page.getByLabel("Your private link");
      await expect(field).toBeVisible();
      firstUrl = await field.inputValue();
      expect(firstUrl).toMatch(/^http:\/\/localhost:3000\/cal\/.+\.ics$/);

      // --- Step 3: fetch the .ics with NO auth (the `request` fixture carries no cookies) ---
      const res = await request.get(firstUrl);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/text\/calendar/);
      expect(res.headers()["cache-control"]).toBe("private, no-cache");
      const etag = res.headers()["etag"];
      expect(etag).toBeTruthy();
      const body = await res.text();
      expect(body).toContain("BEGIN:VCALENDAR");
      expect(body).toContain(contactFirstName);
      expect(body).not.toContain(contactLastName);
      expect(body).not.toContain(contactEmail);
      expect(body).not.toContain(contactPhone.replace(/^\+1/, ""));
      expect(body).not.toMatch(/^URL:/m);

      // HEAD behaves the same as GET (coordinator addition): same status and headers, body never read.
      const headRes = await request.head(firstUrl);
      expect(headRes.status()).toBe(200);
      expect(headRes.headers()["content-type"]).toMatch(/text\/calendar/);
      expect(headRes.headers()["cache-control"]).toBe("private, no-cache");
      expect(headRes.headers()["etag"]).toBe(etag);

      // A repeat with If-None-Match is a 304 with no body (coordinator addition).
      const cached = await request.get(firstUrl, { headers: { "If-None-Match": etag! } });
      expect(cached.status()).toBe(304);
      expect((await cached.body()).length).toBe(0);

      // --- Step 4: Turn off. The same GET is now a 404, cached `no-store` ---
      await page.getByRole("button", { name: "Turn off" }).click();
      await expect(page.getByText("Link turned off.")).toBeVisible();
      const off = await request.get(firstUrl);
      expect(off.status()).toBe(404);
      expect(off.headers()["cache-control"]).toBe("no-store");

      // --- Step 5: Undo within 30 s. The GET is 200 again, same URL ---
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText("Your link is back.")).toBeVisible();
      await expect(field).toHaveValue(firstUrl);
      const backOn = await request.get(firstUrl);
      expect(backOn.status()).toBe(200);

      // --- Step 6: Make a new link. The old URL 404s, the new field value is 200 ---
      await page.getByRole("button", { name: "Make a new link" }).click();
      await expect(page.getByText("New link made. Your old link stopped working.")).toBeVisible();
      await expect(field).not.toHaveValue(firstUrl);
      const secondUrl = await field.inputValue();
      const oldAfterReplace = await request.get(firstUrl);
      expect(oldAfterReplace.status()).toBe(404);
      const newRes = await request.get(secondUrl);
      expect(newRes.status()).toBe(200);

      // --- Step 7: the Spanish card title, the e2e QA locale override ---
      await page.goto(`/dashboard/accounts/${fixture.accountId}/calendar?locale=es`);
      await expect(page.locator("[data-feed-card]").getByText("Sus citas en el teléfono")).toBeVisible();
    } finally {
      // Reset any per-person feed state this run created, rather than leaving it
      // for auth.teardown's end-of-run account cascade — a same-run retry of
      // this spec should never find a stale live row already occupying the
      // Owner's one-live-link slot.
      if (ownerUserId) {
        const { error } = await db.from("calendar_feeds")
          .delete().eq("account_id", fixture.accountId).eq("user_id", ownerUserId);
        if (error) console.error(`calendar-feed e2e cleanup: calendar_feeds delete failed: ${error.message}`);
      }
      if (bookingId) {
        const { error } = await db.from("bookings").delete().eq("id", bookingId);
        if (error) console.error(`calendar-feed e2e cleanup: booking delete failed: ${error.message}`);
      }
      if (contactId) {
        const { error } = await db.from("contacts").delete().eq("id", contactId);
        if (error) console.error(`calendar-feed e2e cleanup: contact delete failed: ${error.message}`);
      }
    }
  });
});
