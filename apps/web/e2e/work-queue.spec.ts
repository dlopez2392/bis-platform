import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, getOrCreateCalendar, createBooking } from "@bis/db";
import { m } from "../src/lib/messages";
import { SEEDED_ACCOUNT_NAME } from "./support";

// This file's last describe block talks to Supabase directly from the
// Playwright runner process (creating the booking the closing assertion
// needs), not through a Next.js request — same two paths, same reason, as
// automations.spec.ts and booking.spec.ts.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// The first screen in this app whose whole purpose is to span every
// account (design spec docs/superpowers/specs/2026-09-14-work-queue-design.md
// §4.2). Its test is a boundary test first, a feature test second — this
// file's whole job, before any feature assertion is ever added to it, is to
// prove a client can never reach /dashboard/work.
//
// requireAgency() (src/lib/auth.ts:7-13) redirects anyone whose session
// claims carry app_role !== "agency_admin" to "/", on the very first line,
// before any read happens — so the agency-wide query is never even issued
// on a client's behalf. "/" itself then redirects a client straight to
// their OWN account dashboard (resolveClientAccount(), (dashboard)/page.tsx
// — the same redirect client-access.spec.ts's own first assertion proves).
// That destination, not merely the absence of /dashboard/work, is what this
// spec asserts: an original draft also asserted the work queue's heading
// was absent from whatever page the client landed on, but that was vacuous
// twice over — once the redirect has already carried the client to an
// unrelated page, "this unrelated page lacks that heading" is true of
// nearly any page, proving nothing about the guard; and it can never
// observe anything else in the first place, because requireAgency() runs
// before the page's own first read, so the work queue's markup is never
// generated, let alone sent to the browser, redirect or not. A heading
// check would only mean something if the browser had a chance to paint the
// guarded content and didn't — that never happens here. Asserting the
// actual redirect target is the assertion that fails if requireAgency()
// ever pointed somewhere other than "/" (an open error page, say, with no
// boundary of its own) while still trivially not being /dashboard/work.
//
// A reviewer since argued (2026-09-15) that the redirect-target assertion
// alone still isn't enough, for three reasons, and this file now answers
// each:
//   1. It's a negative about the DESTINATION, so it can't tell "the guard
//      fired" from "the route fell over" — any redirect target, correct or
//      not, satisfies "the client is not at /dashboard/work". A positive
//      control below proves the heading locator this file's reasoning
//      leans on actually matches real content, on the one session that
//      should see it.
//   2. It says nothing about what the browser actually RECEIVED. This
//      route has a loading.tsx, so a document genuinely is served at
//      /dashboard/work before requireAgency()'s redirect resolves — today
//      that document holds only skeletons, which is fine, but that's a
//      property of today's implementation, not one the architecture
//      guarantees. A future client-side guard (redirect after paint, a
//      partial shell) would satisfy the URL assertion perfectly while
//      every account's brand name had already streamed to the client's
//      browser. The cross-tenant assertion below checks for exactly that
//      leak, not just for the heading's absence.
//   3. The URL pattern was anchored with a bare `$`, so a trailing slash or
//      a query string on the landed URL would not match even though both
//      are the same, correctly-guarded destination. Widened below.
//
// Signed in as the client fixture auth.setup.ts creates ("authenticate as
// client user (no app_role)") — the same identity, and the same
// storageState file, client-access.spec.ts drives as this suite's other
// (and so far only other) client-boundary spec. Copied from there rather
// than invented: fixture creation AND cleanup live outside this file.
// auth.setup.ts creates the Clerk user/org and the accounts row;
// auth.teardown.ts (a Playwright teardown project — see
// playwright.config.ts) deletes all of it afterward, unconditionally, so a
// filtered run that never selects this spec — including a run scoped to
// only this file — still cleans up what "setup" unconditionally created.
//
// This spec never mutates: it navigates and asserts. The per-run fixture
// account exists here only as the vehicle for a real client identity —
// nothing about the fixture's own rows is read or asserted on. Per the
// repo's standing rule, a spec that DID need to mutate account state would
// belong on this same fixture and never on `Test Client One`.
test.describe("a client cannot reach the agency work queue", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client cannot reach the agency work queue", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };

    await page.goto("/dashboard/work");

    // The client lands on their OWN account dashboard, not merely
    // "somewhere that isn't /dashboard/work" — see the file-level comment
    // for why the stronger, positive assertion is the one that actually
    // exercises the guard. Widened from a bare trailing `$` to
    // `(?:[/?]|$)` so a trailing slash or a query string on the same,
    // correctly-guarded destination still matches — the anchor's job is to
    // stop "/dashboard/…/dashboard-something-else" matching, not to
    // reject every character that could follow a real navigation.
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard(?:[/?]|$)`),
    );

    // The heading is only a proxy for the real leak: another account's
    // brand name reaching a client's browser. `SEEDED_ACCOUNT_NAME`
    // ("Test Client One", support.ts) is a real, distinct account in this
    // shared environment — not this run's own fixture — and the same
    // canary client-access.spec.ts's own cross-tenant check uses. This
    // page is the client's OWN dashboard; that account's name has no
    // legitimate reason to ever appear on it. Renaming
    // "Everything that needs you" tomorrow would not touch this
    // assertion, unlike a check against the heading text itself.
    await expect(page.getByText(SEEDED_ACCOUNT_NAME)).toHaveCount(0);
  });
});

// The positive control the negative assertion above needs to be
// falsifiable at all: `getByText(SEEDED_ACCOUNT_NAME).toHaveCount(0)` (and,
// before Task 6 shipped, a heading-absence check with the same shape) is a
// locator that has never been proven to match anything in this file — a
// typo in the string, a role that changed, or a copy edit all leave a
// bare `toHaveCount(0)` green forever. Signed in as the one identity that
// SHOULD see this screen (the project's default chromium storageState,
// e2e/.auth/state.json — the agency admin auth.setup.ts signs in as),
// spelled out explicitly here rather than left implicit, since the rest of
// this file overrides it to the client fixture.
test.describe("the agency admin can reach the queue this file guards", () => {
  test.use({ storageState: "e2e/.auth/state.json" });

  test("the agency admin sees the work queue's own heading", async ({ page }) => {
    await page.goto("/dashboard/work");

    // Read from the message catalogue, not a hand-written literal — a
    // literal here has nothing keeping it in step with the copy, which is
    // exactly how "everything due" survived unnoticed until 41a5a3f. Same
    // key AgencyWorkPage renders (dashboard/work/page.tsx) and the same key
    // page.test.ts's own unit test already pins to an <h1>.
    await expect(
      page.getByRole("heading", { name: m["work.agency.title"] }),
    ).toBeVisible();
  });
});

// The assertion this whole milestone rests on (Task 7 brief). The
// review-request automation's own query (`listDueReviewRequests`,
// packages/db/src/automations.ts:218) selects bookings whose `status` is
// `completed` and whose `completed_at` is not null — and across every
// booking ever created in this database, that status had never once been
// set. Nothing was broken; the close-out buttons simply sat behind a screen
// nobody had a reason to open. The To do screen's booking row
// (`staleBookings`, work-queue.ts: `status = "booked"` AND `ends_at` in the
// past) is the thing that asks, and "It happened" (`WorkRowActions` →
// `closeOutBooking` → `setBookingStatusAction` → `setBookingStatus`,
// booking.ts) is the one path in the product that flips both columns the
// automation's query reads. This proves that path actually stamps them — not
// that the automation then sends, which is automations.spec.ts's and the db
// package's own job — on the per-run fixture account (CLAUDE.md: booking
// state is a mutation, and this shared database is also production, so this
// never runs against `Test Client One` or any live account).
test.describe("It happened closes the loop the milestone exists for", () => {
  test("a stale booking marked It happened becomes completed and stamped", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };
    const db = serviceDb();

    // A real calendar, a real contact, and a real booking whose `ends_at` is
    // already an hour in the past with `status: "booked"` — the column's own
    // default, never set explicitly here — so this row is exactly what
    // `staleBookings` selects on, without the test faking `bucketWork`'s
    // classification.
    const calendar = await getOrCreateCalendar(db, fixture.accountId, "e2e-work-queue");
    const stamp = Date.now();
    const { id: contactId } = await createContact(
      db, fixture.accountId,
      { firstName: "E2E", lastName: `WorkQueue ${stamp}` },
      "e2e-work-queue",
    );
    const contactName = `E2E WorkQueue ${stamp}`;
    const now = Date.now();
    const { id: bookingId } = await createBooking(
      db, fixture.accountId,
      {
        calendarId: calendar.id,
        contactId,
        startsAt: new Date(now - 2 * 60 * 60 * 1000),
        endsAt: new Date(now - 60 * 60 * 1000),
      },
      "e2e-work-queue",
    );

    try {
      await page.goto(`/dashboard/accounts/${fixture.accountId}/tasks`);

      // Scoped to THIS booking's own row by the contact name it renders
      // (`secondaryLine`, work-list.tsx) — every booking row shares the same
      // primary sentence ("Did this job happen?", `work.booking`), so a bare
      // role query for the button alone would be ambiguous if another stale
      // booking exists on this account.
      const row = page.locator("li").filter({ hasText: contactName });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: m["work.booking.completed"] }).click();
      await expect(page.getByText(m["work.booking.completed.toast"])).toBeVisible();

      // THE assertion: both columns the automation's own query filters on.
      const { data, error } = await db
        .from("bookings")
        .select("status, completed_at")
        .eq("id", bookingId)
        .single();
      if (error) throw new Error(`work-queue e2e: booking re-read failed: ${error.message}`);
      expect(data?.status).toBe("completed");
      expect(data?.completed_at).not.toBeNull();
    } finally {
      // The whole fixture account is deleted by auth.teardown.ts regardless,
      // but cleaning up here (not just there) matches booking.spec.ts's own
      // precedent: teardown only runs when the suite COMPLETES, and a
      // same-run retry of this spec should not find the previous attempt's
      // booking still sitting on this contact.
      await db.from("bookings").delete().eq("id", bookingId);
      await db.from("contacts").delete().eq("id", contactId);
    }
  });
});
