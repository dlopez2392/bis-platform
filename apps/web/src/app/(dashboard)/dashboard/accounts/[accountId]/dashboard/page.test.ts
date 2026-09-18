import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

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
  openOpps: [] as { monetary_value: number }[],
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
      if (table === "opportunities") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ data: dbFixture.openOpps, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in dashboard page.test.ts mock: ${table}`);
    },
  }),
}));

vi.mock("@/lib/branding/tenant-theme-reader", () => ({
  getTenantBranding: async () => ({ brandName: null }),
}));

const dbMocks = vi.hoisted(() => ({
  listChecklistState: vi.fn(),
  getA2pRegistration: vi.fn(),
  countContacts: vi.fn(),
  getVoiceProfile: vi.fn(),
  getCalendarForAccount: vi.fn(),
  listCalls: vi.fn(),
  listRecentEvents: vi.fn(),
  listCallStartsBetween: vi.fn(),
  listBookingCreationsBetween: vi.fn(),
  listOpportunityValuesCreatedBetween: vi.fn(),
  // Task 5's dashboard row — the same `listAccountWork` read tasks/page.tsx
  // already makes; mocked here in this file's own vi.fn() shape.
  listAccountWork: vi.fn(),
}));
// mergeChecklist (@/lib/checklist-catalogue) is NOT mocked — the real
// 7-item CHECKLIST_CATALOGUE is what makes "the right counts" a meaningful
// assertion instead of a number this file made up itself.
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
  listCallStartsBetween: (...a: unknown[]) => dbMocks.listCallStartsBetween(...a),
  listBookingCreationsBetween: (...a: unknown[]) => dbMocks.listBookingCreationsBetween(...a),
  listOpportunityValuesCreatedBetween: (...a: unknown[]) => dbMocks.listOpportunityValuesCreatedBetween(...a),
  listAccountWork: (...a: unknown[]) => dbMocks.listAccountWork(...a),
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

// The full CHECKLIST_CATALOGUE (checklist-catalogue.ts), so a test can drive
// "everything done" without hard-coding a key list that drifts from it.
const ALL_CATALOGUE_KEYS = [
  "phone_number", "email_domain", "form_notify", "reply_to", "gbp_connect", "invite_owner",
];

// Shared by both describe blocks below (checklist row + work row) — the same
// reset either page-level row needs, factored out rather than duplicated
// when the work row's own describe block was added for the Task 5 review fix.
function resetFixtures() {
  authFixture.isAgency = true;
  dbFixture.openOpps = [];
  checklistRowProps.current = null;
  workRowProps.current = null;
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.countContacts.mockResolvedValue(0);
  dbMocks.getVoiceProfile.mockResolvedValue(null);
  dbMocks.getCalendarForAccount.mockResolvedValue(null);
  dbMocks.listCalls.mockResolvedValue([]);
  dbMocks.listRecentEvents.mockResolvedValue([]);
  dbMocks.listCallStartsBetween.mockResolvedValue([]);
  dbMocks.listBookingCreationsBetween.mockResolvedValue([]);
  dbMocks.listOpportunityValuesCreatedBetween.mockResolvedValue([]);
  dbMocks.listAccountWork.mockResolvedValue([]);
  // Default: 1 of 7 catalogue items done, A2P not approved — mirrors
  // blueprints.spec.ts's own GAP 3 fixture shape (1 ticked, A2P rejected).
  dbMocks.listChecklistState.mockResolvedValue([row("phone_number")]);
  dbMocks.getA2pRegistration.mockResolvedValue({ status: "rejected", updatedAt: null });
}

describe("AccountDashboardPage — the checklist row (replaces the old full ChecklistPanel)", () => {
  beforeEach(resetFixtures);

  it("an agency sees the row, handed the account's real done/total counts (not a made-up number)", async () => {
    await renderToStaticMarkup(await AccountDashboardPage(route()));

    expect(checklistRowProps.current).not.toBeNull();
    expect(checklistRowProps.current).toEqual({ accountId: "acct1", done: 1, total: 7 });
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
