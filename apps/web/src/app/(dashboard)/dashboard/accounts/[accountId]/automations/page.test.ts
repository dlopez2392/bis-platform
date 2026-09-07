import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";

/**
 * The voice page test's one question, asked for each card: which company
 * name does this page hand the preview? It must be the customer-facing
 * brand name, because each preview's default body and the sent default
 * body are built from the same string. Plus, for Milestone B: each card
 * gets ITS OWN row, the nudge card gets the real booking-page link, and the
 * text-reminder card gets the account's zone for its sample time.
 */
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1" }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example.com" }) }));
vi.mock("@/lib/email/origin", () => ({ originFrom: () => "https://app.example.com" }));
const dbFixture = vi.hoisted(() => ({
  name: "Rio Roofing — trial", timezone: "America/Chicago", brandName: null as string | null,
}));
const dbMock = vi.hoisted(() => ({ getAutomation: vi.fn(), getBranding: vi.fn(), getOrCreateCalendar: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: dbFixture.name, timezone: dbFixture.timezone }, error: null }) }),
      }),
    }),
  }),
  getAutomation: (...a: unknown[]) => dbMock.getAutomation(...a),
  getBranding: (...a: unknown[]) => dbMock.getBranding(...a),
  getOrCreateCalendar: (...a: unknown[]) => dbMock.getOrCreateCalendar(...a),
}));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () => ({ ok: false, reason: "a2p_not_approved" }),
}));
vi.mock("./actions", () => ({
  saveReviewRequestAction: async () => ({ ok: true }),
  saveNoShowNudgeAction: async () => ({ ok: true }),
  saveSmsReminderAction: async () => ({ ok: true }),
}));

type Props = Record<string, unknown>;
const captured = vi.hoisted(() => ({ review: null as Props | null, noShow: null as Props | null, sms: null as Props | null }));
vi.mock("./automations-settings", () => ({
  AutomationsSettings: (props: Props) => { captured.review = props; return null; },
}));
vi.mock("./no-show-nudge-card", () => ({
  NoShowNudgeCard: (props: Props) => { captured.noShow = props; return null; },
}));
vi.mock("./sms-reminder-card", () => ({
  SmsReminderCard: (props: Props) => { captured.sms = props; return null; },
}));

const { default: AutomationsPage } = await import("./page");

const base = { account_id: "a1", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z" };
const ROWS: Record<string, AutomationRow> = {
  review_request: { ...base, id: "au1", recipe_key: "review_request", enabled: true, body: "Hi",
    config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
  no_show_nudge: { ...base, id: "au2", recipe_key: "no_show_nudge", enabled: false, body: "Come back", config: { channel: "email" } },
};

async function render() {
  captured.review = captured.noShow = captured.sms = null;
  renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
  return captured;
}

beforeEach(() => {
  dbFixture.name = "Rio Roofing — trial";
  dbFixture.timezone = "America/Chicago";
  dbFixture.brandName = null;
  dbMock.getAutomation.mockReset().mockImplementation(async (_db: unknown, _a: unknown, key: string) => ROWS[key] ?? null);
  dbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }));
  dbMock.getOrCreateCalendar.mockReset().mockResolvedValue({ id: "cal_1", public_id: "cal_pub_1", enabled: true });
});

describe("automations page", () => {
  it("previews every card with the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.review!.brandName).toBe("Rio Roofing");
    expect(c.noShow!.brandName).toBe("Rio Roofing");
    expect(c.sms!.brandName).toBe("Rio Roofing");
  });

  it("falls back to the account name when the company has set no brand name", async () => {
    dbFixture.name = "Rio Roofing";
    expect((await render()).review!.brandName).toBe("Rio Roofing");
  });

  it("hands each card ITS OWN row (null where none is stored) and the SMS gate", async () => {
    // Mutation: hand every card the review row.
    const c = await render();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(c.noShow!.automation).toEqual(ROWS.no_show_nudge);
    expect(c.sms!.automation).toBeNull();
    for (const p of [c.review!, c.noShow!, c.sms!]) expect(p.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("hands the nudge card the real booking-page link and whether the page is on — the lazily created calendar, as the Calendar page does", async () => {
    const c = await render();
    expect(dbMock.getOrCreateCalendar).toHaveBeenCalledWith(expect.anything(), "a1", "user_1");
    expect(c.noShow!.bookingUrl).toBe("https://app.example.com/b/cal_pub_1");
    expect(c.noShow!.calendarEnabled).toBe(true);
  });

  it("hands the text-reminder card the account's zone for its sample time", async () => {
    expect((await render()).sms!.accountTimezone).toBe("America/Chicago");
  });
});
