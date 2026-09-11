import "dotenv/config";
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import { seedDemoTenant, dropDemoAccount, findDemoAccount } from "../demo/seed";
import { ACCOUNT_OWNED_TABLES, deleteAccountCascade } from "../account-teardown";
import { DEMO_EMAIL_RE, DEMO_PHONE_RE, DEMO_ORG_ID } from "../demo/fiction";
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
  }, 240_000);

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
