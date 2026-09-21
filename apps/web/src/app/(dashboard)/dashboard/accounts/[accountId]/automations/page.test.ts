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
const dbMock = vi.hoisted(() => ({
  getAutomation: vi.fn(), getBranding: vi.fn(), getCalendarForAccount: vi.fn(), readQuietSettings: vi.fn(),
}));
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
  getCalendarForAccount: (...a: unknown[]) => dbMock.getCalendarForAccount(...a),
  readQuietSettings: (...a: unknown[]) => dbMock.readQuietSettings(...a),
  DEFAULT_QUIET_SETTINGS: { enabled: true, start: "21:00", end: "08:00" },
}));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () => ({ ok: false, reason: "a2p_not_approved" }),
}));
vi.mock("./actions", () => ({
  saveReviewRequestAction: async () => ({ ok: true }),
  saveNoShowNudgeAction: async () => ({ ok: true }),
  saveSmsReminderAction: async () => ({ ok: true }),
  saveInstantReplyAction: async () => ({ ok: true }),
  saveQuietHoursAction: async () => ({ ok: true }),
}));

type Props = Record<string, unknown>;
const captured = vi.hoisted(() => ({
  review: null as Props | null, noShow: null as Props | null, sms: null as Props | null, instant: null as Props | null,
  quiet: null as Props | null,
}));
vi.mock("./automations-settings", () => ({
  AutomationsSettings: (props: Props) => { captured.review = props; return null; },
}));
vi.mock("./no-show-nudge-card", () => ({
  NoShowNudgeCard: (props: Props) => { captured.noShow = props; return null; },
}));
vi.mock("./sms-reminder-card", () => ({
  SmsReminderCard: (props: Props) => { captured.sms = props; return null; },
}));
vi.mock("./instant-reply-card", () => ({
  InstantReplyCard: (props: Props) => { captured.instant = props; return null; },
}));
vi.mock("./quiet-hours-card", () => ({
  QuietHoursCard: (props: Props) => { captured.quiet = props; return null; },
}));

const { default: AutomationsPage } = await import("./page");

const base = { account_id: "a1", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z" };
const ROWS: Record<string, AutomationRow> = {
  review_request: { ...base, id: "au1", recipe_key: "review_request", enabled: true, body: "Hi",
    config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
  no_show_nudge: { ...base, id: "au2", recipe_key: "no_show_nudge", enabled: false, body: "Come back", config: { channel: "email" } },
  instant_reply: { ...base, id: "au4", recipe_key: "instant_reply", enabled: false, body: "Hi", config: { bodyEs: "Hola" } },
};

async function render() {
  captured.review = captured.noShow = captured.sms = captured.instant = captured.quiet = null;
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
  dbMock.getCalendarForAccount.mockReset().mockResolvedValue({ id: "cal_1", public_id: "cal_pub_1", enabled: true });
  dbMock.readQuietSettings.mockReset().mockResolvedValue({ enabled: true, start: "22:30", end: "06:15" });
});

describe("automations page", () => {
  it("previews every card with the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.review!.brandName).toBe("Rio Roofing");
    expect(c.noShow!.brandName).toBe("Rio Roofing");
    expect(c.sms!.brandName).toBe("Rio Roofing");
  });

  it("hands the cards NOTHING rather than the account name when the company has set no brand name", async () => {
    // The label stays in the fixture on purpose: with no brand name the preview
    // shows a nameless default, never "Rio Roofing — trial". Unreachable through
    // the product since 0028 (creation seeds a brand name, the Branding save
    // refuses a blank, go-live requires the step) — pinned so a reintroduced
    // `?? accountName` fallback fails here.
    expect(dbFixture.name).toBe("Rio Roofing — trial");
    expect((await render()).review!.brandName).toBe("");
  });

  it("hands each card ITS OWN row (null where none is stored) and the SMS gate", async () => {
    // Mutation: hand every card the review row.
    const c = await render();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(c.noShow!.automation).toEqual(ROWS.no_show_nudge);
    expect(c.sms!.automation).toBeNull();
    for (const p of [c.review!, c.noShow!, c.sms!]) expect(p.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("hands the nudge card the real booking-page link and whether the page is on — a READ, never a write on a GET", async () => {
    const c = await render();
    expect(dbMock.getCalendarForAccount).toHaveBeenCalledWith(expect.anything(), "a1");
    expect(c.noShow!.bookingUrl).toBe("https://app.example.com/b/cal_pub_1");
    expect(c.noShow!.calendarEnabled).toBe(true);
  });

  it("hands the text-reminder card the account's zone for its sample time", async () => {
    expect((await render()).sms!.accountTimezone).toBe("America/Chicago");
  });

  it("hands the instant-reply card ITS OWN row, the customer-facing name for its defaults, and the SMS gate", async () => {
    // Mutation: hand it the review row, or accounts.name.
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.instant!.automation).toEqual(ROWS.instant_reply);
    expect(c.instant!.brandName).toBe("Rio Roofing");
    expect(c.instant!.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
    expect(dbMock.getAutomation).toHaveBeenCalledWith(expect.anything(), "a1", "instant_reply");
  });
});

describe("automations page — no calendar yet", () => {
  it("renders all three cards; the nudge card gets no link and a switched-off page", async () => {
    dbMock.getCalendarForAccount.mockResolvedValue(null);
    const c = await render();
    expect(c.review).not.toBeNull();
    expect(c.sms).not.toBeNull();
    expect(c.noShow!.bookingUrl).toBe("");
    expect(c.noShow!.calendarEnabled).toBe(false);
  });

  it("the instant-reply card renders too — it has no calendar to depend on", async () => {
    dbMock.getCalendarForAccount.mockResolvedValue(null);
    const c = await render();
    expect(c.instant).not.toBeNull();
  });
});

describe("the Quiet hours card", () => {
  it("receives the STORED window (not the defaults) and the account's zone, and links to Activity (mutation: pass DEFAULT_QUIET_SETTINGS → FAILS)", async () => {
    const { quiet } = await render();
    expect(quiet).toMatchObject({ settings: { enabled: true, start: "22:30", end: "06:15" }, zoneLabel: "America/Chicago" });
    expect(dbMock.readQuietSettings).toHaveBeenCalledWith(expect.anything(), "a1");
  });
  it("the page links to What went out", async () => {
    // `render()` captures props only; render the page's markup once for the link.
    const html = renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
    expect(html).toContain('href="/dashboard/accounts/a1/activity"');
    expect(html).toContain("See what went out");
  });
  it("a failed settings read degrades to the defaults and says so in the log, never a blank page", async () => {
    dbMock.readQuietSettings.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { quiet } = await render();
    expect(quiet).toMatchObject({ settings: { enabled: true, start: "21:00", end: "08:00" } });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });
});
