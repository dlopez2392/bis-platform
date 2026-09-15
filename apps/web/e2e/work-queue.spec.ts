import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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
test.use({ storageState: "e2e/.auth/client-state.json" });

test("a client cannot reach the agency work queue", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
  ) as { accountId: string };

  await page.goto("/dashboard/work");

  // The client lands on their OWN account dashboard, not merely "somewhere
  // that isn't /dashboard/work" — see the file-level comment for why the
  // stronger, positive assertion is the one that actually exercises the
  // guard. This is the shipped heading's replacement for the plan-sketch
  // "everything due" this spec asserted before the route existed
  // (work.agency.title in messages.ts is "Everything that needs you" — see
  // AgencyWorkPage in dashboard/work/page.tsx); that string plays no part
  // here because the redirect means the client's browser never receives it.
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard$`),
  );
});
