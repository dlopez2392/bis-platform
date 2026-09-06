import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";

/**
 * The voice page test's one question, asked again here: which company name
 * does this page hand the preview? It must be the customer-facing brand
 * name, because the preview's default body and the sent default body are
 * built from the same string — an internal-label preview would show the
 * operator one message while a different one went out.
 */
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1" }),
}));
const dbFixture = vi.hoisted(() => ({ name: "Rio Roofing — trial", brandName: null as string | null }));
const dbMock = vi.hoisted(() => ({ getAutomation: vi.fn(), getBranding: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: dbFixture.name }, error: null }) }),
      }),
    }),
  }),
  getAutomation: (...a: unknown[]) => dbMock.getAutomation(...a),
  getBranding: (...a: unknown[]) => dbMock.getBranding(...a),
}));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () => ({ ok: false, reason: "a2p_not_approved" }),
}));
vi.mock("./actions", () => ({ saveReviewRequestAction: async () => ({ ok: true }) }));

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("./automations-settings", () => ({
  AutomationsSettings: (props: Record<string, unknown>) => { captured.props = props; return null; },
}));

const { default: AutomationsPage } = await import("./page");

const ROW: AutomationRow = {
  id: "au1", account_id: "a1", recipe_key: "review_request", enabled: true, body: "Hi",
  config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" },
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

async function render() {
  captured.props = null;
  renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
  return captured.props!;
}

beforeEach(() => {
  dbFixture.name = "Rio Roofing — trial";
  dbFixture.brandName = null;
  dbMock.getAutomation.mockReset().mockResolvedValue(ROW);
  dbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }));
});

describe("automations page", () => {
  it("previews with the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    expect((await render()).brandName).toBe("Rio Roofing");
  });

  it("falls back to the account name when the company has set no brand name", async () => {
    dbFixture.name = "Rio Roofing";
    expect((await render()).brandName).toBe("Rio Roofing");
  });

  it("hands the stored row and the SMS gate to the form", async () => {
    const props = await render();
    expect(props.automation).toEqual(ROW);
    expect(props.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });
});
