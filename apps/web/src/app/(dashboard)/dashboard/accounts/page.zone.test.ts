import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * Each row's own "Created" date rendered through `formatDate` — the
 * RUNTIME's zone (server or browser), never that ACCOUNT'S OWN zone, even
 * though the row already names it (`a.timezone`, printed right above the
 * date) — the same bug D-010 fixed for the contacts list and the activity
 * timeline, here on the one list where the row's own zone was already on
 * screen and simply never used to render the row's own date.
 */
vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_agency" }) }));
// A mutable mock (`vi.hoisted`, not a bare async literal) so the unusable-
// zone test below can swap in its own row without disturbing the first
// test's fixture — same reason contacts/page.test.ts's own `accountRead`
// mock is a `vi.fn()`.
const listAccountsMock = vi.hoisted(() => vi.fn(async () => [
  {
    id: "acct_1", name: "West Co", clerk_org_id: "org_1", status: "active",
    timezone: "America/Los_Angeles", created_at: "2026-10-09T02:30:00.000Z",
  },
]));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({}),
  listAccounts: () => listAccountsMock(),
  listBlueprints: async () => [],
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ organizations: { getOrganizationList: async () => ({ data: [] }) } }),
}));
vi.mock("./actions", () => ({ createClientAccount: vi.fn(), adoptOrphanOrgAction: vi.fn() }));

const { default: AccountsPage } = await import("./page");

describe("accounts list's row 'Created' date renders in THAT ACCOUNT's own zone, not the runtime's", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    listAccountsMock.mockReset();
    listAccountsMock.mockResolvedValue([
      {
        id: "acct_1", name: "West Co", clerk_org_id: "org_1", status: "active",
        timezone: "America/Los_Angeles", created_at: "2026-10-09T02:30:00.000Z",
      },
    ]);
  });

  it("follows the row's own timezone (Los Angeles), not the runtime's (Tokyo)", async () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const text = renderedText(renderToStaticMarkup(await AccountsPage()));
    // 02:30 UTC on the 9th is still Oct 8 in Los Angeles (PDT, UTC-7) but
    // already Oct 9 both in UTC itself and in Tokyo — the account's own day,
    // which the row must show regardless of either wrong fallback.
    expect(text).toContain("Oct 8, 2026");
    expect(text).not.toContain("Oct 9, 2026");
  });

  // Review of #225: `isUsableZone(a.timezone) ? a.timezone : "UTC"`
  // (page.tsx:146) was never exercised by an actually-unusable row — every
  // existing fixture carried a real IANA name, so a regression that threw
  // instead of falling back (or dropped the guard and fed `Intl` garbage
  // directly) could not have failed any test here.
  it("a row with an unusable timezone still renders — it falls back to UTC rather than throwing (mutation: drop the `isUsableZone` guard → FAILS)", async () => {
    listAccountsMock.mockResolvedValueOnce([
      {
        id: "acct_2", name: "Bad Zone Co", clerk_org_id: "org_2", status: "active",
        timezone: "Not-A-Real-Zone", created_at: "2026-10-09T02:30:00.000Z",
      },
    ]);
    const text = renderedText(renderToStaticMarkup(await AccountsPage()));
    expect(text).toContain("Bad Zone Co");
    // Formatted in the UTC fallback, not thrown and not silently blank.
    expect(text).toContain("Oct 9, 2026");
  });
});
