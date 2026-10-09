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
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({}),
  listAccounts: async () => [
    {
      id: "acct_1", name: "West Co", clerk_org_id: "org_1", status: "active",
      timezone: "America/Los_Angeles", created_at: "2026-10-09T02:30:00.000Z",
    },
  ],
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
});
