import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

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
}));
// mergeChecklist (@/lib/checklist-catalogue) is NOT mocked — the real
// 7-item CHECKLIST_CATALOGUE is what makes "the right counts" a meaningful
// assertion instead of a number this file made up itself.
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

describe("AccountDashboardPage — the checklist row (replaces the old full ChecklistPanel)", () => {
  beforeEach(() => {
    authFixture.isAgency = true;
    dbFixture.openOpps = [];
    checklistRowProps.current = null;
    for (const fn of Object.values(dbMocks)) fn.mockReset();
    dbMocks.countContacts.mockResolvedValue(0);
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    dbMocks.getCalendarForAccount.mockResolvedValue(null);
    dbMocks.listCalls.mockResolvedValue([]);
    dbMocks.listRecentEvents.mockResolvedValue([]);
    dbMocks.listCallStartsBetween.mockResolvedValue([]);
    dbMocks.listBookingCreationsBetween.mockResolvedValue([]);
    dbMocks.listOpportunityValuesCreatedBetween.mockResolvedValue([]);
    // Default: 1 of 7 catalogue items done, A2P not approved — mirrors
    // blueprints.spec.ts's own GAP 3 fixture shape (1 ticked, A2P rejected).
    dbMocks.listChecklistState.mockResolvedValue([row("phone_number")]);
    dbMocks.getA2pRegistration.mockResolvedValue({ status: "rejected", updatedAt: null });
  });

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
