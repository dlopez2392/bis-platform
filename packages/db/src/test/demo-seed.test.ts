import "dotenv/config";
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import { seedDemoTenant, dropDemoAccount, findDemoAccount } from "../demo/seed";
import { ACCOUNT_OWNED_TABLES, deleteAccountCascade } from "../account-teardown";
import {
  DEMO_EMAIL_RE, DEMO_PHONE_RE, DEMO_ORG_ID, DEMO_BUSINESS_LINE,
  DEMO_FROM_EMAIL, DEMO_FORWARDING_TICK_KEY, DEMO_PEOPLE,
  demoVercelProjectId, demoPhone,
} from "../demo/fiction";
import { listSitesToSync } from "../sites";
import { listDueReminders } from "../booking";
import { listAccountsForWeeklyRollup, listAccountsDueWeeklyReport } from "../weekly-report";

/**
 * The seeder against a real database — a THROWAWAY org id, never the real
 * `org_demo_resaca_air`.
 *
 * That distinction is the whole reason `orgId` is injectable. This project is
 * shared with production, and a test that rebuilt the actual demo tenant on
 * every CI run would leave it missing or half-written for the length of the
 * run, right when somebody might be screenshotting it.
 *
 * One `it`, not eight, and deliberately: seeding is ~400 round trips, and
 * eight tests that each seed would be eight times the wall clock for no extra
 * coverage. The timeout is raised on this test alone rather than on the
 * suite, so a genuinely hung test elsewhere still reports in 60s.
 *
 * 600s, not 240s, and the number is MEASURED rather than guessed. ~400
 * sequential round trips makes this the most latency-sensitive test in the
 * repo, so it is always the one that loses a race for the shared Supabase
 * project — and 240s was sitting exactly on the cliff edge:
 *
 *   CI run #35163108842 (main, alone on the project):  94.7s
 *   CI run #35173679953 (two verify jobs at once):     >240s, killed
 *
 * The whole db suite slowed 2.5x in that second run (test time 1065s ->
 * 2678s; `checklist.test.ts` 9.5s -> 23.5s), which puts this test at ~237s —
 * inside its own budget by three seconds. Two branches pushed a minute
 * apart is not an unusual event, and `verify` is NOT serialized across the
 * repo the way `e2e` is, so that contention is the normal case rather than
 * the exceptional one. 600s is 6.3x the uncontended figure instead of 2.5x.
 *
 * This is headroom, not a fix. What actually costs the time is 400 round
 * trips issued one at a time; batching them would make the test fast enough
 * that no budget question arises.
 */
const THROWAWAY = `org_test_demoseed_${Math.random().toString(36).slice(2, 10)}`;

describe("demo tenant seeder", () => {
  it("builds a whole account that cannot reach anybody, and tears itself down", async () => {
    const db = serviceDb();
    // Used by the assertions below. Deliberately NOT what teardown keys on —
    // see the `finally`.
    let accountId: string | null = null;
    try {
      const result = await seedDemoTenant(db, { orgId: THROWAWAY, now: new Date("2026-09-11T15:00:00Z") });
      accountId = result.accountId;
      expect(result.replacedExisting).toBe(false);

      // --- The account is suppressed. Everything else is downstream of this.
      const { data: account } = await db.from("accounts")
        .select("outbound_suppressed, brand_name, brand_color, brand_neutral, brand_logo_path, timezone, report_emails")
        .eq("id", accountId).single();
      expect(account!.outbound_suppressed).toBe(true);
      expect(account!.timezone).toBe("America/Chicago");
      // A brand colour WITHOUT a neutral: `deriveTheme` returns null unless
      // one of neutral/corners/type/mode is set, which is what keeps the
      // dashboard on BIS's own chrome while the client's colour still paints
      // the booking page's CTA. Asserting the absence, because the whole
      // point is a combination that is easy to break by "completing" it.
      expect(account!.brand_color).toBeTruthy();
      expect(account!.brand_neutral).toBeNull();
      // The logo really made it into storage, and under this account's own
      // prefix — the path is content-addressed and account-scoped, which is
      // also why the teardown has to remove it explicitly.
      expect(account!.brand_logo_path).toMatch(new RegExp(`^${accountId}/logo-[0-9a-f]{16}\\.png$`));
      // No recipients: the weekly report's own switch, on top of the flag.
      expect(account!.report_emails).toEqual([]);

      // --- Every stored contact detail is reserved. Read back from the
      //     DATABASE, not from the source list — this is the assertion that
      //     covers a value the seeder built at runtime.
      const { data: contacts } = await db.from("contacts")
        .select("email, phone").eq("account_id", accountId);
      expect(contacts!.length).toBe(result.counts.contacts);
      for (const c of contacts as { email: string | null; phone: string | null }[]) {
        expect(c.email).toMatch(DEMO_EMAIL_RE);
        expect(c.phone).toMatch(DEMO_PHONE_RE);
      }
      const { data: callers } = await db.from("calls")
        .select("caller_e164").eq("account_id", accountId);
      for (const c of callers as { caller_e164: string | null }[]) {
        expect(c.caller_e164).toMatch(DEMO_PHONE_RE);
      }
      const { data: lines } = await db.from("phone_numbers")
        .select("e164").eq("account_id", accountId);
      for (const l of lines as { e164: string }[]) expect(l.e164).toMatch(DEMO_PHONE_RE);

      // --- And it did not take anything the REAL demo owns. This is the
      //     assertion that would have failed the day this test started
      //     breaking CI: `phone_numbers.e164` and `sites.vercel_project_id`
      //     are unique across every account in the project, so a throwaway
      //     that reached for the demo's values could only run while the demo
      //     did not exist. Asserted against the database rather than against
      //     `demoBusinessLines`, because the point is what was WRITTEN.
      expect(lines!.map((l) => (l as { e164: string }).e164))
        .not.toContain(DEMO_BUSINESS_LINE);
      const { data: site } = await db.from("sites")
        .select("vercel_project_id").eq("account_id", accountId).single();
      expect(site!.vercel_project_id).toBe(demoVercelProjectId(THROWAWAY));
      expect(site!.vercel_project_id).not.toBe(demoVercelProjectId(DEMO_ORG_ID));

      // --- The demo looks like a business that finished setting up. Each of
      //     these was a visible defect in the first capture run, and none was
      //     a rendering bug — the demo was honestly reporting itself as
      //     half-configured.

      // The booking page 404'd because `calendars.enabled` defaults to false
      // and /b/[publicId] answers a disabled calendar with notFound(). A
      // capture of that shipped as one of six marketing screenshots.
      const { data: cal } = await db.from("calendars")
        .select("enabled, open_hours").eq("account_id", accountId).single();
      expect(cal!.enabled).toBe(true);
      // Not merely present: `deriveSetupStatus`'s hours step wants at least
      // one day with a non-empty window, because `open_hours: {}` passes
      // "enabled" and still reads "no availability" on every day.
      const windows = Object.values(cal!.open_hours as Record<string, unknown[]>);
      expect(windows.some((w) => w.length > 0)).toBe(true);

      // The two setup steps with nothing else to derive them from.
      const { data: acct2 } = await db.from("accounts")
        .select("from_email").eq("id", accountId).single();
      expect(acct2!.from_email).toBe(DEMO_FROM_EMAIL);
      expect(acct2!.from_email).toMatch(DEMO_EMAIL_RE);

      const { data: ticks } = await db.from("checklist_items")
        .select("item_key, done_at").eq("account_id", accountId)
        .eq("item_key", DEMO_FORWARDING_TICK_KEY);
      expect(ticks).toHaveLength(1);
      expect(ticks![0]!.done_at).not.toBeNull();

      // --- The business is growing, which is the whole point of showing it.
      //
      //     The dashboard's KPI row compares the last 7 local days against the
      //     7 before. "Pipeline added" used to derive a deal's age from its
      //     STAGE, so everything recent was a stage-0 deal and stage-0 deals
      //     are the cheap ones — the captured dashboard reported $178 and a
      //     97% collapse across the hero row. Asserted on the rows rather than
      //     on the DEALS table, because what matters is what landed in the
      //     database, and a re-seed moves every date.
      const dayMs = 24 * 60 * 60 * 1000;
      const seededAt = Date.parse("2026-09-11T15:00:00Z");
      //     The column is `monetary_value`, not `value`. The first version of
      //     this assertion asked for `value`, and because it destructured only
      //     `data` and never looked at `error`, PostgREST's refusal came back
      //     as a null row set — so both sums were 0 and the failure read
      //     "expected 0 to be greater than 0" instead of naming the bad
      //     column. Hence `oppsErr`: a query that cannot run must say so.
      const { data: opps, error: oppsErr } = await db.from("opportunities")
        .select("monetary_value, created_at").eq("account_id", accountId);
      expect(oppsErr, `opportunities read failed: ${oppsErr?.message}`).toBeNull();
      expect(opps!.length).toBeGreaterThan(0);
      const valueBetween = (fromDaysAgo: number, toDaysAgo: number) =>
        opps!.filter((o) => {
          const age = (seededAt - Date.parse(o.created_at as string)) / dayMs;
          return age >= toDaysAgo && age < fromDaysAgo;
        }).reduce((sum, o) => sum + Number(o.monetary_value), 0);

      const addedLast7 = valueBetween(7, 0);
      const addedPrior7 = valueBetween(14, 7);
      expect(addedLast7).toBeGreaterThan(0);
      expect(addedPrior7).toBeGreaterThan(0);
      expect(addedLast7).toBeGreaterThan(addedPrior7);

      // --- A caller's language matches the person taking the call.
      //
      //     The seeder used to pick the transcript by index and the contact
      //     by a different index, so the two were unrelated: the captured
      //     call log showed María Guzmán and Verónica Alaniz on English calls
      //     and Kevin Braun and Owen Serrato on Spanish ones. Each is
      //     possible in the Valley; a whole column of them reads as a product
      //     that does not know who it is talking to.
      //
      //     Asserted by joining back through the PHONE, because `contacts`
      //     stores no language — the person's language lives only in
      //     DEMO_PEOPLE, which is the thing the seeder is supposed to honour.
      const langByPhone = new Map(DEMO_PEOPLE.map((p) => [demoPhone(p.line), p.lang]));
      const { data: callRows } = await db.from("calls")
        .select("language, contact_id").eq("account_id", accountId)
        .not("contact_id", "is", null);
      const { data: contactRows } = await db.from("contacts")
        .select("id, phone").eq("account_id", accountId);
      const phoneById = new Map(
        (contactRows ?? []).map((c) => [c.id as string, c.phone as string]));

      expect(callRows!.length).toBeGreaterThan(0);
      const mismatched = callRows!.filter((call) => {
        const phone = phoneById.get(call.contact_id as string);
        const personLang = phone ? langByPhone.get(phone) : undefined;
        return personLang !== undefined && personLang !== call.language;
      });
      expect(mismatched).toEqual([]);

      // --- It actually built something. A seeder that silently wrote four
      //     rows would pass every safety assertion above.
      expect(result.counts.contacts).toBeGreaterThanOrEqual(40);
      expect(result.counts.calls).toBeGreaterThanOrEqual(30);
      expect(result.counts.bookings).toBeGreaterThanOrEqual(12);
      expect(result.counts.opportunities).toBeGreaterThanOrEqual(12);
      expect(result.counts.messages).toBeGreaterThanOrEqual(25);
      expect(result.counts.trafficDays).toBe(60);

      // --- The history is backdated. Every row landing in the same second is
      //     the single most obvious tell that a dashboard is seeded, and the
      //     events feed is the surface where it shows worst.
      const { data: events } = await db.from("events")
        .select("created_at").eq("account_id", accountId).order("created_at");
      const spanDays =
        (Date.parse(events!.at(-1)!.created_at) - Date.parse(events![0]!.created_at)) / 86_400_000;
      expect(spanDays).toBeGreaterThan(30);

      // --- And no pass will touch it. Four reads, one per guarded shape.
      expect((await listSitesToSync(db)).some((s) => s.accountId === accountId)).toBe(false);
      expect((await listAccountsForWeeklyRollup(db)).some((a) => a.accountId === accountId)).toBe(false);
      expect((await listAccountsDueWeeklyReport(db)).some((a) => a.accountId === accountId)).toBe(false);
      // The seeded bookings include five in the future, so without the flag
      // one of them would be inside the reminder window on some tick. Asked
      // across the whole future rather than at one instant, so this does not
      // depend on where the window happens to fall.
      const due = await listDueReminders(db, new Date("2026-09-12T15:00:00Z").toISOString());
      expect(due.some((d) => d.accountId === accountId)).toBe(false);

      // Re-seeding is NOT exercised here, on purpose. One seed is roughly 800
      // round trips and a second would double this test's wall clock for one
      // boolean — and `replacedExisting` is nothing but `dropDemoAccount`'s
      // return value, whose whole mechanism the teardown assertion below
      // proves directly. The replace path is verified by hand against the
      // real project when the demo is actually re-seeded.

      // --- Teardown leaves nothing. This is the assertion that catches a
      //     table added to the seeder and not to ACCOUNT_OWNED_TABLES, which
      //     would otherwise surface much later as an FK violation in an
      //     unrelated test.
      const dropped = await dropDemoAccount(db, THROWAWAY);
      expect(dropped).toBe(true);
      const leftovers: string[] = [];
      for (const table of ACCOUNT_OWNED_TABLES) {
        const { count: n } = await db.from(table)
          .select("id", { count: "exact", head: true }).eq("account_id", accountId);
        if (n) leftovers.push(`${table}: ${n}`);
      }
      expect(leftovers).toEqual([]);
      expect(await findDemoAccount(db, THROWAWAY)).toBeNull();
    } finally {
      // Resolved BY ORG ID, not from `accountId`.
      //
      // `accountId` is only assigned once `seedDemoTenant` RETURNS, so the
      // first version of this cleaned up nothing whenever the seeder threw —
      // which is exactly when there is something to clean up. CI proved it:
      // a run that died inside the seeder left a complete 40-contact account
      // in the shared project, and the next run failed on
      // `phone_numbers_e164_key` because the orphan still held the demo's
      // phone number.
      //
      // The seeder now removes its own half-built account, so this is the
      // second line rather than the first — but it is the line that does not
      // depend on the seeder's own error handling being correct.
      const stray = await findDemoAccount(db, THROWAWAY);
      if (stray) await deleteAccountCascade(db, stray.id, "demo-seed.test cleanup");
    }
  }, 600_000);

  it("refuses an org id Clerk could actually mint", async () => {
    const db = serviceDb();
    // The outer of the three guards. Not a formality: this function DELETES
    // the account it finds, and `org_2abcXYZ` is the shape of a real one.
    await expect(seedDemoTenant(db, { orgId: "org_2abcXYZdefGHI" }))
      .rejects.toThrow(/not a seedable org id/);
    await expect(dropDemoAccount(db, "org_2abcXYZdefGHI"))
      .rejects.toThrow(/not a seedable org id/);
  });

  it("refuses to delete an account at the demo org id that is not suppressed", async () => {
    const db = serviceDb();
    // The middle guard, and the one that matters if the org-id check is ever
    // loosened: an account that is NOT suppressed is not one this seeder
    // created, whatever id it is sitting at.
    const existing = await findDemoAccount(db, DEMO_ORG_ID);
    if (!existing) return; // nothing seeded in this project yet — nothing to assert against.
    expect(existing.outboundSuppressed).toBe(true);
  });
});
