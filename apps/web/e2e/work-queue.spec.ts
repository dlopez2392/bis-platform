import { test, expect } from "@playwright/test";

// The first screen in this app whose whole purpose is to span every
// account (design spec docs/superpowers/specs/2026-09-14-work-queue-design.md
// §4.2). Its test is a boundary test first, a feature test second — this
// file's whole job, before any feature assertion is ever added to it, is to
// prove a client can never reach /dashboard/work.
//
// requireAgency() (src/lib/auth.ts:7-13) redirects anyone whose session
// claims carry app_role !== "agency_admin" to "/", on the very first line,
// before any read happens — so the agency-wide query is never even issued
// on a client's behalf. The proof is therefore two-sided: the client does
// not end up sitting on /dashboard/work, AND that screen's own content
// never rendered on whatever page they DO land on.
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
  await page.goto("/dashboard/work");

  // requireAgency() redirects to "/" before any read, so the client must
  // not still be sitting on /dashboard/work once navigation settles.
  await expect(page).not.toHaveURL(/\/dashboard\/work$/);

  // And the agency screen's own content must never have rendered, on
  // whatever page the redirect actually lands on. Task 6 has not added this
  // heading to `messages.ts` yet — this spec is written and run BEFORE the
  // route exists (task-6-brief.md step 1) — so the name below is the
  // working title carried by both the task brief and
  // docs/superpowers/plans/2026-09-14-work-queue.md's own Task 6 sketch, not
  // a confirmed string read from shipped copy. If Task 6 lands with a
  // different heading, this line needs updating to match it when this spec
  // is re-run to green — a pass against the wrong text would prove nothing.
  await expect(page.getByRole("heading", { name: /everything due/i })).toHaveCount(0);
});
