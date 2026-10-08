import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { CHECKLIST_CATALOGUE } from "@/lib/checklist-catalogue";

/**
 * The regression this file exists to guard: the dashboard used to render the
 * FULL `ChecklistPanel` — the identical component `/checklist` renders, from
 * the same data and actions — as one of its own sections. It now renders a
 * compact row (`checklist-row.tsx`) in its place, gated by the same
 * `isAgency` branch, with the completed-state small text link left
 * untouched (page.tsx's own comment: "a finished checklist should not
 * compete with the rest of the dashboard"). Mocks the auth gate and the DB
 * entry points this async server component actually reaches — same shape
 * as calls/page.test.ts and automations/page.test.ts — rather than
 * exercising Clerk/Supabase for what is a pure "which branch renders" bug.
 * The chart/activity cards are mocked out entirely: their own data shaping
 * is covered by calls-chart-card.test.ts / activity-card.test.ts, and this
 * file only needs them to not throw.
 */

const authFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: authFixture.isAgency }),
}));

const dbFixture = vi.hoisted(() => ({
  name: "Test Client One", timezone: "America/Chicago",
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { name: dbFixture.name, timezone: dbFixture.timezone }, error: null,
              }),
            }),
          }),
        };
      }
      // Open-opportunity totals now go through sumOpenOpportunities
      // (@bis/db, mocked below) rather than a raw query on this client, so
      // "opportunities" is no longer a table this page's db.from() reaches.
      throw new Error(`unexpected table in dashboard page.test.ts mock: ${table}`);
    },
  }),
}));

vi.mock("@/lib/branding/tenant-theme-reader", () => ({
  getTenantBranding: async () => ({ brandName: null }),
}));

// F-076 (now slice): the CRM-only hero ("Leads captured") reads the SAME
// shared helper the Monday weekly report uses (owner decision) —
// `listLeadInstantsBetween` lives in `@/lib/reports/weekly-metrics`, not
// `@bis/db`, so it needs its own mock module separate from the one below.
// "Calls answered" reads the report's shared answered-calls helper the same
// way (2026-10-06) — before that, every call row, robocalls included.
const reportMocks = vi.hoisted(() => ({
  listLeadInstantsBetween: vi.fn(),
  listAnsweredCallStartsBetween: vi.fn(),
  // The calls chart card's "screened, not empty" state (#182 follow-up) —
  // this file only needs the Promise.all to resolve, never throw; the real
  // state-selection logic is calls-chart-card.test.ts/metrics.test.ts's job
  // (CallsChartCard itself is mocked out below).
  listSpamCallStartsBetween: vi.fn(),
}));
vi.mock("@/lib/reports/weekly-metrics", () => ({
  listLeadInstantsBetween: (...a: unknown[]) => reportMocks.listLeadInstantsBetween(...a),
  listAnsweredCallStartsBetween: (...a: unknown[]) => reportMocks.listAnsweredCallStartsBetween(...a),
  listSpamCallStartsBetween: (...a: unknown[]) => reportMocks.listSpamCallStartsBetween(...a),
}));

const dbMocks = vi.hoisted(() => ({
  listChecklistState: vi.fn(),
  getA2pRegistration: vi.fn(),
  countContacts: vi.fn(),
  getVoiceProfile: vi.fn(),
  getCalendarForAccount: vi.fn(),
  listCalls: vi.fn(),
  listRecentEvents: vi.fn(),
  listBookingCreationsBetween: vi.fn(),
  listOpportunityValuesCreatedBetween: vi.fn(),
  // Task 5's dashboard row — the same `listAccountWork` read tasks/page.tsx
  // already makes; mocked here in this file's own vi.fn() shape.
  listAccountWork: vi.fn(),
  sumOpenOpportunities: vi.fn(),
  countCallsBetween: vi.fn(),
}));
// mergeChecklist (@/lib/checklist-catalogue) is NOT mocked — the real
// CHECKLIST_CATALOGUE (its length read below, never hard-coded here) is
// what makes "the right counts" a meaningful assertion instead of a number
// this file made up itself.
/** The screen's resolved zone (lib/zone.ts) — mutable so a test can put the
 *  page into the "guessed" state without a second `vi.mock`. */
let resolvedZone: {
  zone: string; guessed: boolean; label: string;
  source: "account" | "agency" | "fallback";
} = { zone: "America/Chicago", guessed: false, label: "America/Chicago", source: "account" };
vi.mock("@/lib/zone", () => ({
  renderZone: async () => resolvedZone,
}));

vi.mock("@bis/db", () => ({
  listChecklistState: (...a: unknown[]) => dbMocks.listChecklistState(...a),
  getA2pRegistration: (...a: unknown[]) => dbMocks.getA2pRegistration(...a),
  countContacts: (...a: unknown[]) => dbMocks.countContacts(...a),
  getVoiceProfile: (...a: unknown[]) => dbMocks.getVoiceProfile(...a),
  getCalendarForAccount: (...a: unknown[]) => dbMocks.getCalendarForAccount(...a),
  listCalls: (...a: unknown[]) => dbMocks.listCalls(...a),
  listRecentEvents: (...a: unknown[]) => dbMocks.listRecentEvents(...a),
  listBookingCreationsBetween: (...a: unknown[]) => dbMocks.listBookingCreationsBetween(...a),
  listOpportunityValuesCreatedBetween: (...a: unknown[]) => dbMocks.listOpportunityValuesCreatedBetween(...a),
  listAccountWork: (...a: unknown[]) => dbMocks.listAccountWork(...a),
  sumOpenOpportunities: (...a: unknown[]) => dbMocks.sumOpenOpportunities(...a),
  countCallsBetween: (...a: unknown[]) => dbMocks.countCallsBetween(...a),
}));

vi.mock("./calls-chart-card", () => ({ CallsChartCard: () => null }));
vi.mock("./activity-card", () => ({ ActivityCard: () => null }));

// The one component under real test-of-integration here: captured rather
// than rendered, so this file can assert exactly what page.tsx computed and
// handed it (done/total) without re-asserting checklist-row.tsx's own
// markup — that's checklist-row.test.ts's job.
const checklistRowProps = vi.hoisted(() => ({ current: null as { accountId: string; done: number; total: number } | null }));
vi.mock("./checklist-row", () => ({
  ChecklistRow: (props: { accountId: string; done: number; total: number }) => {
    checklistRowProps.current = props;
    return null;
  },
}));

// Task 5 review fix (Important 2): the work row was wired into page.tsx but
// nothing asserted it — deleting `<WorkRowCard>` from page.tsx, or gating it
// behind `workTotal > 0`, or behind `isAgency`, left this whole file green.
// Same idiom as `checklistRowProps` above: captured rather than rendered, so
// the page-level wiring (which counts it's handed, and that it renders at
// zero for both audiences) is what's under test here, not work-row.tsx's own
// markup (that's work-row.test.ts's job).
const workRowProps = vi.hoisted(() => ({ current: null as { accountId: string; total: number; overdue: number } | null }));
vi.mock("./work-row", () => ({
  WorkRowCard: (props: { accountId: string; total: number; overdue: number }) => {
    workRowProps.current = props;
    return null;
  },
}));

const { default: AccountDashboardPage } = await import("./page");

function route(accountId = "acct1") {
  return { params: Promise.resolve({ accountId }) };
}

/** One catalogue item ticked (`done_at` set) — the checklist's own row shape
 *  (packages/db/src/checklist.ts's `ChecklistStateRow`). */
function row(itemKey: string): { id: string; item_key: string; title: string | null; done_at: string | null; done_by: string | null; note: string | null; position: number } {
  return { id: itemKey, item_key: itemKey, title: null, done_at: "2026-01-01T00:00:00Z", done_by: "user_1", note: null, position: 0 };
}

// Every catalogue key (checklist-catalogue.ts) EXCEPT `a2p_registration`,
// derived rather than hand-listed so a new catalogue item is covered by
// construction instead of silently under-counted here. `a2p_registration` is
// excluded on purpose, not forgotten: this fixture always sets
// `getA2pRegistration` too, which makes that one key DERIVED
// (`mergeChecklist`, checklist-catalogue.ts:83) rather than a stored tick —
// mapping it through `row()` would create a stored row whose `done_at` the
// merge never even reads for that key.
const ALL_CATALOGUE_KEYS = CHECKLIST_CATALOGUE
  .map((item) => item.key)
  .filter((key) => key !== "a2p_registration");

// Shared by both describe blocks below (checklist row + work row) — the same
// reset either page-level row needs, factored out rather than duplicated
// when the work row's own describe block was added for the Task 5 review fix.
function resetFixtures() {
  authFixture.isAgency = true;
  checklistRowProps.current = null;
  workRowProps.current = null;
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  reportMocks.listLeadInstantsBetween.mockReset();
  reportMocks.listAnsweredCallStartsBetween.mockReset();
  reportMocks.listSpamCallStartsBetween.mockReset();
  dbMocks.countContacts.mockResolvedValue(0);
  dbMocks.getVoiceProfile.mockResolvedValue(null);
  dbMocks.getCalendarForAccount.mockResolvedValue(null);
  dbMocks.listCalls.mockResolvedValue([]);
  dbMocks.listRecentEvents.mockResolvedValue([]);
  reportMocks.listAnsweredCallStartsBetween.mockResolvedValue([]);
  dbMocks.listBookingCreationsBetween.mockResolvedValue([]);
  dbMocks.listOpportunityValuesCreatedBetween.mockResolvedValue([]);
  reportMocks.listLeadInstantsBetween.mockResolvedValue([]);
  dbMocks.listAccountWork.mockResolvedValue([]);
  dbMocks.sumOpenOpportunities.mockResolvedValue({ count: 0, value: 0 });
  dbMocks.countCallsBetween.mockResolvedValue(0);
  reportMocks.listSpamCallStartsBetween.mockResolvedValue([]);
  // Default: one item ticked, A2P not approved — mirrors blueprints.spec.ts's
  // own GAP 3 fixture shape (1 ticked, A2P rejected).
  dbMocks.listChecklistState.mockResolvedValue([row("phone_number")]);
  dbMocks.getA2pRegistration.mockResolvedValue({ status: "rejected", updatedAt: null });
}

describe("AccountDashboardPage — the checklist row (replaces the old full ChecklistPanel)", () => {
  beforeEach(resetFixtures);

  it("an agency sees the row, handed the account's real done/total counts (not a made-up number)", async () => {
    await renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(checklistRowProps.current).not.toBeNull();
    expect(checklistRowProps.current).toEqual({
      accountId: "acct1", done: 1, total: CHECKLIST_CATALOGUE.length,
    });
  });

  it("a client never sees the row — nor the completed-state review link — regardless of checklist state", async () => {
    authFixture.isAgency = false;
    // Same fixture as the completed-state test below: if the isAgency gate
    // around the WHOLE section were ever dropped, this account has both a
    // row AND a review link available to leak.
    dbMocks.listChecklistState.mockResolvedValue(ALL_CATALOGUE_KEYS.map(row));
    dbMocks.getA2pRegistration.mockResolvedValue({ status: "approved", updatedAt: null });

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(checklistRowProps.current).toBeNull();
    expect(html).not.toContain(m["checklist.reviewLink"]);
    expect(html).not.toContain(m["checklist.title"]);
  });

  it("the completed state (nothing left) is untouched: no row, just the small review-link text into /checklist", async () => {
    dbMocks.listChecklistState.mockResolvedValue(ALL_CATALOGUE_KEYS.map(row));
    // a2p_registration is DERIVED (mergeChecklist), not a stored tick — only
    // `approved` reads as done, so every catalogue item needs this too.
    dbMocks.getA2pRegistration.mockResolvedValue({ status: "approved", updatedAt: null });

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(checklistRowProps.current).toBeNull();
    expect(html).toContain(m["checklist.reviewLink"]);
    expect(html).toContain('href="/dashboard/accounts/acct1/checklist"');
  });
});

// Task 5 review fix (Important 2). Before this block, nothing in this file —
// or anywhere else — asserted `<WorkRowCard>` is ever rendered: deleting it
// from page.tsx, gating it behind `workTotal > 0`, or gating it behind
// `isAgency` all left the suite green, including the three tests above whose
// `listAccountWork` mock entry existed only to keep the page's own
// `Promise.all` from throwing.
describe("AccountDashboardPage — the work row (unlike the checklist row, both audiences and every count)", () => {
  beforeEach(resetFixtures);

  /** `dueAt` fixed far in the past or far in the future rather than relative
   *  to "now" — page.tsx buckets against the real `new Date()`, not an
   *  injectable clock, so a date near "today" would make this test's own
   *  overdue/waiting split depend on when it happens to run. Derived rows
   *  (conversation/booking) always land in `waiting` regardless of date
   *  (bucketWork's own doc comment), so `dueAt: null` there is enough. */
  function workRow(source: WorkRow["source"], dueAt: string | null): WorkRow {
    return {
      id: `${source}:${dueAt ?? "none"}`, source, accountId: "acct1", contactId: null,
      title: "", dueAt, occurredAt: "2020-01-01T00:00:00Z",
    };
  }

  it("hands WorkRowCard the account's real total/overdue counts from a mix of sources", async () => {
    dbMocks.listAccountWork.mockResolvedValue([
      workRow("task", "2020-01-01T00:00:00Z"), // always overdue
      workRow("task", "2099-01-01T00:00:00Z"), // always waiting (future)
      // The current instant — shares a local day with page.tsx's own `now`
      // in ANY zone by construction (both are `new Date()` a moment apart),
      // unlike a relative offset that would need its own zone reasoning.
      // Pins the bucket a plain overdue+waiting fixture leaves uncovered:
      // `workTotal`'s middle term (`workBuckets.today.length`) could be
      // deleted from page.tsx and this test stayed green without a row that
      // actually lands in Today.
      workRow("task", new Date().toISOString()), // today
      workRow("conversation", null), // derived — always waiting
      workRow("booking", null), // derived — always waiting
    ]);

    await renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(workRowProps.current).toEqual({ accountId: "acct1", total: 5, overdue: 1 });
  });

  it("still renders the row at an empty queue, for an agency session", async () => {
    await renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(workRowProps.current).toEqual({ accountId: "acct1", total: 0, overdue: 0 });
  });

  it("counts overdue work in the RESOLVED zone, not the account's raw one (mutation: bucketWork(..., account.timezone) -> overdue drops to 0 -> FAILS)", async () => {
    // The account's stored zone is unusable; `renderZone` resolves past it.
    // Bucketed in the raw value, `bucketWork` cannot judge any row and sends
    // every one of them to Waiting — so the dashboard's "N overdue" silently
    // becomes 0 while the KPI periods beside it are measured in a zone that
    // works. This page is the one that used to hold BOTH answers at once.
    dbFixture.timezone = "Not/AZone";
    dbMocks.listAccountWork.mockResolvedValue([workRow("task", "2020-01-01T00:00:00Z")]);

    await renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(workRowProps.current).toEqual({ accountId: "acct1", total: 1, overdue: 1 });
  });

  it("still renders the row at an empty queue, for a client session", async () => {
    authFixture.isAgency = false;

    await renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(workRowProps.current).toEqual({ accountId: "acct1", total: 0, overdue: 0 });
  });
});

/**
 * The zone note reaches the account dashboard.
 *
 * This page is the one that had TWO answers fifty lines apart — a UTC clamp
 * for the KPI windows and the raw zone for `bucketWork` — so it is the one
 * where naming the single resolved zone matters most. Both audiences land
 * here at login, which is why the client case is exercised too.
 */
describe("AccountDashboardPage — the zone note", () => {
  beforeEach(resetFixtures);

  it("names the zone above the KPI tiles (mutation: delete the ZoneNote element from page.tsx -> FAILS)", async () => {
    resolvedZone = { zone: "America/Chicago", guessed: false, label: "America/Chicago", source: "account" };
    const html = renderToStaticMarkup(await AccountDashboardPage(route()));
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "America/Chicago"));
  });

  it("gives the agency the fix and a CLIENT no link at all (mutation: drop the isAgency branch in ZoneNote -> FAILS)", async () => {
    resolvedZone = { zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" };

    const agencyHtml = renderToStaticMarkup(await AccountDashboardPage(route()));
    expect(renderedText(agencyHtml)).toContain(m["zone.guessed.fix"]);

    authFixture.isAgency = false;
    const clientHtml = renderToStaticMarkup(await AccountDashboardPage(route()));
    expect(renderedText(clientHtml)).not.toContain(m["zone.guessed.fix"]);
    // Settings is agency-only; a client following that link is redirected
    // straight back to this page.
    expect(clientHtml).not.toContain("/settings");
  });
});

/**
 * F-055 (now half): this page used to query `opportunities` directly
 * (`.select("monetary_value").eq("account_id", …).eq("status", "open")`),
 * which PostgREST caps at `max_rows` (1000) — silently undercounting both
 * the "Open deals" count and the "Pipeline value" sum above that. It now
 * goes through `sumOpenOpportunities` (packages/db/src/opportunities.ts),
 * which pages past the cap; this test pins that the KPI tiles render
 * exactly what that call returned, not a value this page recomputed from a
 * raw row set.
 */
describe("AccountDashboardPage — open deals and pipeline value (F-055 now-half)", () => {
  beforeEach(resetFixtures);

  it("renders the count and currency-formatted sum sumOpenOpportunities returned", async () => {
    dbMocks.sumOpenOpportunities.mockResolvedValue({ count: 7, value: 12345 });

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(renderedText(html)).toContain(m["account.openOpps"]);
    expect(html).toContain(">7<");
    expect(html).toContain("$12,345");
  });

  it("scopes the call to this account", async () => {
    dbMocks.sumOpenOpportunities.mockResolvedValue({ count: 0, value: 0 });

    await AccountDashboardPage(route("acct_specific"));

    expect(dbMocks.sumOpenOpportunities).toHaveBeenCalledWith(expect.anything(), "acct_specific");
  });
});

/**
 * F-076 (now slice, crm-features.md §2.3/§6.3): the dashboard's hero used to
 * be "Calls answered" for every account, unconditionally — structurally
 * always 0 on a CRM-only account (no enabled voice profile), since nothing
 * is answering calls. The honest, available-today signal is the same one
 * `showVoiceSub`/`offerVoiceSetup` already use elsewhere on this exact page
 * and in calls-chart-card.tsx: `voiceProfile?.enabled === true`, not a
 * billing plan (account_billing/plans.features.voice_receptionist isn't
 * populated for most accounts yet — M7a's own billing-floor work is still
 * in flight per crm-features.md §4.2 — so reading it here would silently
 * misclassify a real client as "CRM-only"). Owner decision: the CRM-only
 * hero is "Leads captured", the SAME definition `listLeadInstantsBetween`
 * (lib/reports/weekly-metrics.ts) hands the Monday weekly report — not
 * "every new contact".
 *
 * Time is PINNED (`vi.setSystemTime`) for the two value/delta/spark tests
 * below: `page.tsx` reads `new Date()` directly (no injectable clock), and
 * without pinning it, fixture ISO strings written at commit time silently
 * drift outside the rolling 14-day window as the real clock advances —
 * exactly the gap the reviewer found (every mutation below passed, because
 * nothing in the OLD test put rows on both sides of the current/prior
 * split). `NOW` is a fixed Monday noon UTC = 7 AM America/Chicago (this
 * fixture's own zone, no DST ambiguity in June), so `window7`'s current
 * period is June 9–15 and its prior period is June 2–8 — the fixture
 * timestamps below sit well inside the middle of each half, clear of any
 * midnight boundary.
 */
describe("AccountDashboardPage — the hero follows the plan (F-076 now slice)", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z");
  // Leads: 3 in the current week, 1 in the prior week — current=3, prior=1,
  // so deltaVsPrior gives "up 200%" (diff 2 / prior 1).
  const LEADS_CURRENT = [
    "2026-06-10T12:00:00.000Z", "2026-06-11T12:00:00.000Z", "2026-06-12T12:00:00.000Z",
  ];
  const LEADS_PRIOR = ["2026-06-05T12:00:00.000Z"];
  // Calls: 2 current, 1 prior — "up 100%" (diff 1 / prior 1). Deliberately a
  // DIFFERENT count and a DIFFERENT delta than leads, so a mutation that
  // reuses one branch's source for the other is visible in the rendered
  // value AND the delta wording, not just one of the two.
  const CALLS_CURRENT = ["2026-06-11T12:00:00.000Z", "2026-06-12T12:00:00.000Z"];
  const CALLS_PRIOR = ["2026-06-04T12:00:00.000Z"];

  beforeEach(() => {
    resetFixtures();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The EXACT sparkline geometry `page.tsx` should hand `StatTile` for a
   *  given source array — computed with the real `bucketByLocalDay`/
   *  `sparklinePath` (never re-implemented here), the same window14 the
   *  page itself derives from the pinned `NOW` and this fixture's zone. */
  async function expectedSparkPoints(sourceIso: string[]): Promise<string> {
    const { localDayWindow, bucketByLocalDay, sparklinePath } = await import("@/lib/dashboard/metrics");
    const window14 = localDayWindow(NOW, "America/Chicago", 14);
    const counts = bucketByLocalDay(sourceIso, "America/Chicago", window14.dayKeys).map((b) => b.count);
    return sparklinePath(counts, 84, 26).line;
  }

  it("no enabled voice profile: the hero is Leads captured, with its own real value, delta and sparkline (mutations: value from calls -> FAILS; hard-coded 0 -> FAILS; calls delta/spark reused -> FAILS; flipped current/prior split -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    reportMocks.listLeadInstantsBetween.mockResolvedValue([...LEADS_CURRENT, ...LEADS_PRIOR]);
    // A distinctly different, non-zero calls source: if the hero wrongly
    // read from calls instead of leads, the value/delta assertions below
    // would see THIS shape, not the leads one.
    reportMocks.listAnsweredCallStartsBetween.mockResolvedValue([...CALLS_CURRENT, ...CALLS_PRIOR]);

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));
    const leadsLine = await expectedSparkPoints([...LEADS_CURRENT, ...LEADS_PRIOR]);

    expect(html.match(/data-hero="true"/g)?.length).toBe(1);
    // Value: exactly the 3 CURRENT leads, not 0, not the calls count (2).
    expect(html).toMatch(/data-testid="kpi-leads-captured" data-hero="true"[^>]*>3</);
    expect(html).not.toContain('data-testid="kpi-calls-answered"');
    expect(renderedText(html)).toContain(m["dashboard.kpi.leadsCaptured"]);
    // Delta: "up 200%" (3 vs 1) — would read "up 100%" (the calls shape) or
    // "flat"/"1" under the named mutations.
    expect(renderedText(html)).toContain("up 200% vs the prior period");
    // Sparkline: the exact geometry the real LEADS source produces, not an
    // empty/zeroed one and not the calls source's geometry.
    expect(html).toContain(`points="${leadsLine}"`);
  });

  it("an enabled voice profile keeps Calls answered as the hero, with its own real value, delta and sparkline (mutations: value from leads -> FAILS; hard-coded 0 -> FAILS; leads delta/spark reused -> FAILS; flipped current/prior split -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: true });
    reportMocks.listAnsweredCallStartsBetween.mockResolvedValue([...CALLS_CURRENT, ...CALLS_PRIOR]);
    // A distinctly different, non-zero leads source: if the hero wrongly
    // read from leads instead of calls, the value/delta assertions below
    // would see THIS shape, not the calls one.
    reportMocks.listLeadInstantsBetween.mockResolvedValue([...LEADS_CURRENT, ...LEADS_PRIOR]);

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));
    const callsLine = await expectedSparkPoints([...CALLS_CURRENT, ...CALLS_PRIOR]);

    expect(html.match(/data-hero="true"/g)?.length).toBe(1);
    // Value: exactly the 2 CURRENT calls, not 0, not the leads count (3).
    expect(html).toMatch(/data-testid="kpi-calls-answered" data-hero="true"[^>]*>2</);
    expect(html).not.toContain('data-testid="kpi-leads-captured"');
    expect(renderedText(html)).toContain(m["dashboard.kpi.callsAnswered"]);
    // Delta: "up 100%" (2 vs 1) — would read "up 200%" (the leads shape) or
    // "flat"/"0" under the named mutations.
    expect(renderedText(html)).toContain("up 100% vs the prior period");
    expect(html).toContain(`points="${callsLine}"`);
  });

  it("the Leads-captured hero reads real lead instants for THIS account's window, not a made-up number", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    reportMocks.listLeadInstantsBetween.mockResolvedValue([...LEADS_CURRENT, ...LEADS_PRIOR]);

    await AccountDashboardPage(route("acct_specific"));

    expect(reportMocks.listLeadInstantsBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_specific", expect.any(String), expect.any(String),
    );
  });

  // 2026-10-06: the hero, its spark, the 14-day chart and the after-hours
  // tile all read EVERY call row, robocalls and the owner's test calls
  // included, under a label that says "answered". They now share the Monday
  // report's answered-calls read; `@bis/db`'s every-row read is not mocked in
  // this file at all, so a regression to it fails to import, not silently.
  it("the Calls-answered hero reads the report's answered-calls helper for THIS account's 14-day window", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: true });

    await AccountDashboardPage(route("acct_specific"));

    const { localDayWindow } = await import("@/lib/dashboard/metrics");
    const window14 = localDayWindow(NOW, "America/Chicago", 14);
    expect(reportMocks.listAnsweredCallStartsBetween).toHaveBeenCalledWith(
      expect.anything(), "acct_specific", window14.fromIso, window14.toIso,
    );
  });
});

/**
 * Minor fix from code review: "After-hours captured" is a property of calls
 * Sofía takes, so a CRM-only account (no enabled voice profile) showed an
 * always-0 tile there too, the same unmeasured-not-zeroed defect the hero
 * swap above fixes — now gated on `showVoiceSub` as well as a configured
 * calendar (page.tsx's `hasAfterHours`).
 */
describe("AccountDashboardPage — After-hours captured is hidden without voice (minor fix)", () => {
  beforeEach(resetFixtures);

  const CONFIGURED_CALENDAR = { open_hours: { mon: [["09:00", "17:00"]] } } as never;

  it("no enabled voice profile, even with a configured calendar: After-hours captured does not render (mutation: drop showVoiceSub from hasAfterHours -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    dbMocks.getCalendarForAccount.mockResolvedValue(CONFIGURED_CALENDAR);

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(renderedText(html)).not.toContain(m["dashboard.kpi.afterHoursCaptured"]);
  });

  it("an enabled voice profile with a configured calendar: After-hours captured still renders", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: true });
    dbMocks.getCalendarForAccount.mockResolvedValue(CONFIGURED_CALENDAR);

    const html = renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(renderedText(html)).toContain(m["dashboard.kpi.afterHoursCaptured"]);
  });
});
