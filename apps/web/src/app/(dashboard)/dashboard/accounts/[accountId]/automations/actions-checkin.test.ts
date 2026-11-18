import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertAutomation: vi.fn(), getMailingAddress: vi.fn(), getBranding: vi.fn(), getAutomation: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { saveReviewRequestAction } from "./actions";

/**
 * F-072 PR 4 (docs/superpowers/plans/2026-11-17-review-requests.md, D5 and section 3 "PR 4"): the check-in switch on
 * the Review requests save. The switch is `config.checkin`; the action rebuilt `config` from { channel, reviewUrl }
 * alone, so without these a save from the card would silently DROP a stored `checkin: true`. Authorisation first:
 * `automations` grants `authenticated` SELECT only, so `serviceDb()` and the isAgency check are the whole fence.
 */
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const URL = "https://g.page/r/x/review";
const savedConfig = () => (dbMocks.upsertAutomation.mock.calls[0]![3] as { config: unknown }).config;

beforeEach(() => {
  guardFixture.isAgency = true;
  dbMocks.upsertAutomation.mockReset().mockResolvedValue({});
  dbMocks.getMailingAddress.mockReset().mockResolvedValue("123 Main St\nMcAllen, TX 78501");
  dbMocks.getBranding.mockReset().mockResolvedValue({
    brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: "owner@rioroofing.com",
  });
  dbMocks.getAutomation.mockReset().mockResolvedValue(null);
});

describe("the check-in switch on saveReviewRequestAction (plan D5)", () => {
  it("refuses a non-agency caller turning it on, before any read or write (mutation: drop the isAgency check -> FAILS)", async () => {
    guardFixture.isAgency = false;
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL, checkin: "on" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(dbMocks.getBranding).not.toHaveBeenCalled();
    expect(dbMocks.getAutomation).not.toHaveBeenCalled();
  });

  it("a save with the switch ON keeps checkin: true in the stored config (mutation: rebuild config from { channel, reviewUrl } only -> FAILS)", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: ` ${URL} `, checkin: "on" })))
      .toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      expect.objectContaining({ enabled: true, config: { channel: "email", reviewUrl: URL, checkin: true } }), "user_1");
  });

  it("a save with the switch OFF clears it: the stored config carries no checkin key at all (mutation: carry the old value forward -> FAILS)", async () => {
    // The row already holds checkin: true; the form no longer sends the box.
    dbMocks.getAutomation.mockResolvedValue({ config: { channel: "email", reviewUrl: URL, checkin: true }, body: "", body_es: null, body_es_basis: null });
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL }))).toEqual({ ok: true });
    expect(savedConfig()).toEqual({ channel: "email", reviewUrl: URL });
    expect("checkin" in (savedConfig() as object)).toBe(false);
  });

  it("refuses an http: link with the switch on, and says so in words; the same link is still storable with it off (plan D5)", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: "http://example.com/review", checkin: "on" })))
      .toEqual({ ok: false, error: m["automations.review.checkin.needsHttps"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: "http://example.com/review" })))
      .toEqual({ ok: true });
    expect(savedConfig()).toEqual({ channel: "email", reviewUrl: "http://example.com/review" });
  });

  it("refuses the Text channel with the switch on (a text cannot carry the check-in), even while the recipe is off", async () => {
    for (const enabled of [{ enabled: "on" }, {}] as Record<string, string>[]) {
      expect(await saveReviewRequestAction("acct_1", fd({ ...enabled, channel: "sms", review_url: URL, checkin: "on" })))
        .toEqual({ ok: false, error: m["automations.review.checkin.needsEmail"] });
    }
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("refuses the switch with no link: there is nothing to offer after the question, and a silent drop would show it on and store it off", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: "", checkin: "on" })))
      .toEqual({ ok: false, error: m["automations.review.checkin.needsUrl"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a junk link is still the link refusal, not the https one (javascript: is never stored, switch or not)", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: "javascript:alert(1)", checkin: "on" })))
      .toEqual({ ok: false, error: m["automations.review.urlInvalid"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("only the box's own value turns it on: 'off', '1' and 'true' are the switch off", async () => {
    for (const v of ["off", "1", "true", ""]) {
      dbMocks.upsertAutomation.mockClear();
      expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL, checkin: v })), v).toEqual({ ok: true });
      expect(savedConfig(), v).toEqual({ channel: "email", reviewUrl: URL });
    }
  });

  it("keeps the typed message while the switch is on: the hidden box still submits, so turning it off again loses nothing", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL, checkin: "on", body: "Thanks, come again!" })))
      .toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      expect.objectContaining({ body: "Thanks, come again!", config: { channel: "email", reviewUrl: URL, checkin: true } }), "user_1");
  });
});
