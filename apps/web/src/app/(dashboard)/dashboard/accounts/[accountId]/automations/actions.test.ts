import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  upsertAutomation: vi.fn(), saveQuietSettings: vi.fn(), bumpHeldForAccount: vi.fn(),
  // The reactivation save reads these two before turning the recipe on.
  getMailingAddress: vi.fn(), getBranding: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
// voice/actions.test.ts's switchable guard: requireAccountAccess resolves for
// any legitimate caller; the ACTION turns isAgency:false into {ok:false}.
const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import {
  saveReviewRequestAction, saveNoShowNudgeAction, saveReferralAskAction, saveReactivationAction, saveSmsReminderAction,
  saveAppointmentConfirmAction, saveQuoteFollowupAction,
  saveInstantReplyAction, saveQuietHoursAction,
} from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const URL = "https://g.page/r/x/review";

beforeEach(() => {
  guardFixture.isAgency = true;
  dbMocks.upsertAutomation.mockReset().mockResolvedValue({});
  dbMocks.saveQuietSettings.mockReset().mockResolvedValue(undefined);
  dbMocks.bumpHeldForAccount.mockReset().mockResolvedValue(0);
  // LOAD-BEARING DEFAULTS: every existing reactivation case that turns the
  // recipe on is about something else, so the account it saves for HAS an
  // address and a reply-to. The refusal cases below clear one at a time.
  dbMocks.getMailingAddress.mockReset().mockResolvedValue("123 Main St\nMcAllen, TX 78501");
  dbMocks.getBranding.mockReset().mockResolvedValue({
    brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: "owner@rioroofing.com",
  });
});

describe("saveReviewRequestAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + channel + link + body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveReviewRequestAction("acct_1",
      fd({ enabled: "on", channel: "sms", review_url: ` ${URL} `, body: "Thanks!" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: true, body: "Thanks!", config: { channel: "sms", reviewUrl: URL } }, "user_1");
  });

  it("turning it on without a link is refused, with copy that says what to do", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: "" })))
      .toEqual({ ok: false, error: m["automations.review.urlRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a junk link is refused even while the recipe is OFF — a javascript: url must never be stored", async () => {
    // Mutation: validate only when `enabled`.
    for (const bad of ["javascript:alert(1)", "not a url", "ftp://x.example/r"]) {
      expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: bad })), bad)
        .toEqual({ ok: false, error: m["automations.review.urlInvalid"] });
    }
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("stores the NORMALISED link, so the page previews exactly the string the pass sends", async () => {
    // Re-review finding: the pass sends parsed.href; a raw stored string would
    // let a bare origin preview one character short of what goes out.
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "sms", review_url: "https://x.example" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: true, body: "", config: { channel: "sms", reviewUrl: "https://x.example/" } }, "user_1");
  });

  it("stores a whitespace-only body as empty, so it keeps meaning 'use the default'", async () => {
    // Review finding: the page previews `body.trim() || default` and the pass
    // sends `row.body.trim() || default`; a stored "   " must not survive to
    // make those two disagree on a reload.
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: "", body: "  \n  " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: false, body: "", config: { channel: "email", reviewUrl: "" } }, "user_1");
  });

  it("saves an OFF row with an empty link, so the operator can fill it in later", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: "", body: "" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: false, body: "", config: { channel: "email", reviewUrl: "" } }, "user_1");
  });

  it("an unknown channel and a database failure both come back as a toastable failure", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "fax", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.review.saveFailed"] });
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.review.saveFailed"] });
  });
});

describe("saveNoShowNudgeAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveNoShowNudgeAction("acct_1", fd({ enabled: "on", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + channel + trimmed body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveNoShowNudgeAction("acct_1", fd({ enabled: "on", channel: "sms", body: "  Come back!  " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "no_show_nudge",
      { enabled: true, body: "Come back!", config: { channel: "sms" } }, "user_1");
  });

  it("an unknown channel and a database failure both come back as a toastable failure", async () => {
    // Mutation: default an unknown channel to email instead of refusing.
    expect(await saveNoShowNudgeAction("acct_1", fd({ channel: "fax" })))
      .toEqual({ ok: false, error: m["automations.noShow.saveFailed"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveNoShowNudgeAction("acct_1", fd({ enabled: "on", channel: "email" })))
      .toEqual({ ok: false, error: m["automations.noShow.saveFailed"] });
  });
});

describe("saveReferralAskAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveReferralAskAction("acct_1", fd({ enabled: "on", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + channel + trimmed body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveReferralAskAction("acct_1", fd({ enabled: "on", channel: "sms", body: "  Know anyone else?  " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "referral_ask",
      { enabled: true, body: "Know anyone else?", config: { channel: "sms" } }, "user_1");
  });

  it("an unknown channel and a database failure both come back as a toastable failure", async () => {
    // Mutation: default an unknown channel to email instead of refusing.
    expect(await saveReferralAskAction("acct_1", fd({ channel: "carrier pigeon" })))
      .toEqual({ ok: false, error: m["automations.referral.saveFailed"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveReferralAskAction("acct_1", fd({ enabled: "on", channel: "email" })))
      .toEqual({ ok: false, error: m["automations.referral.saveFailed"] });
  });

  it("stores a whitespace-only body as empty, so it keeps meaning 'use the default'", async () => {
    // The card previews `body.trim() || default` and the pass sends
    // `row.body.trim() || default`; a stored "   " must not survive to make
    // those two disagree on a reload.
    expect(await saveReferralAskAction("acct_1", fd({ channel: "email", body: "  \n  " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "referral_ask",
      { enabled: false, body: "", config: { channel: "email" } }, "user_1");
  });
});

describe("saveQuoteFollowupAction", () => {
  const STAGE = "6f1b2c3d-4e5a-4b7c-8d9e-0a1b2c3d4e5f";

  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveQuoteFollowupAction("acct_1", fd({ enabled: "on", stage_id: STAGE, quiet_days: "3", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("stores the PARSED config, not the raw form values", async () => {
    // `quiet_days` arrives as the string "4" and must reach the row as the
    // number 4 — the pass reads this jsonb back with the same parser, and a
    // string there would make every send fail its own range check.
    // Mutation: store `{ stageId, quietDays: formData.get("quiet_days"), channel }`
    // → this reds on the number.
    expect(await saveQuoteFollowupAction("acct_1",
      fd({ enabled: "on", stage_id: STAGE, quiet_days: "4", channel: "sms", body: "  Any questions?  " })))
      .toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "quote_followup",
      { enabled: true, body: "Any questions?", config: { stageId: STAGE, quietDays: 4, channel: "sms" } }, "user_1");
  });

  it("asks for a stage BY NAME when the recipe is being turned on without one", async () => {
    // Mutation: return the generic `saveFailed` here → this reds, and the
    // operator is told nothing about what is actually missing.
    expect(await saveQuoteFollowupAction("acct_1", fd({ enabled: "on", stage_id: "", quiet_days: "3", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.quoteFollowup.stageRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("asks for the stage BY NAME when the recipe is left OFF too, in words that do not mention turning it on", async () => {
    // Decision C (danlo, 2026-09-22). A first visit that fills the days and
    // the message, forgets the stage and saves with the switch off used to
    // get the generic `saveFailed` — "Could not save" with no clue what was
    // missing — because the branch only fired with `enabled`. A stage is
    // required to save at all (the parser refuses an empty one), so the
    // message is the same either way, and it must read true with the switch
    // off. Mutation: restore `enabled &&` on the branch → this reds while the
    // case above stays green; restore the old "…before turning this on." copy
    // → the wording line reds.
    expect(await saveQuoteFollowupAction("acct_1", fd({ stage_id: "", quiet_days: "3", channel: "sms", body: "Any questions?" })))
      .toEqual({ ok: false, error: m["automations.quoteFollowup.stageRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(m["automations.quoteFollowup.stageRequired"]).not.toMatch(/\bturn/i);
  });

  it("REFUSES a quiet-days value outside the range rather than clamping it — at both bounds and one past each", async () => {
    // The card's `max` makes this unreachable from a normal keyboard, which is
    // why the parser's refusal is proved HERE and never in Playwright.
    // Mutation: clamp instead of refusing (`Math.min(30, Math.max(1, n))`) →
    // the out-of-range lines red, and the operator would see one number while
    // the send used another.
    for (const quiet_days of ["0", "31", "3.5", "", "abc"]) {
      expect(await saveQuoteFollowupAction("acct_1", fd({ enabled: "on", stage_id: STAGE, quiet_days, channel: "sms" })), quiet_days)
        .toEqual({ ok: false, error: m["automations.quoteFollowup.quietDaysInvalid"] });
    }
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    // …and AT each bound it saves, so the refusal is a range and not a wall.
    expect(await saveQuoteFollowupAction("acct_1", fd({ stage_id: STAGE, quiet_days: "1", channel: "sms" }))).toEqual({ ok: true });
    expect(await saveQuoteFollowupAction("acct_1", fd({ stage_id: STAGE, quiet_days: "30", channel: "sms" }))).toEqual({ ok: true });
  });

  it("refuses a stage id that is not a uuid, and an unknown channel, with the generic message", async () => {
    // A junk stage id would reach the due-list's `.in("stage_id", …)` and make
    // PostgREST 400 the WHOLE tick, every account's rows with it — which is
    // why the parser carries a uuid shape check at all.
    expect(await saveQuoteFollowupAction("acct_1", fd({ enabled: "on", stage_id: "Quoted", quiet_days: "3", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.quoteFollowup.saveFailed"] });
    expect(await saveQuoteFollowupAction("acct_1", fd({ enabled: "on", stage_id: STAGE, quiet_days: "3", channel: "carrier-pigeon" })))
      .toEqual({ ok: false, error: m["automations.quoteFollowup.saveFailed"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a database failure comes back as a toastable failure", async () => {
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveQuoteFollowupAction("acct_1", fd({ enabled: "on", stage_id: STAGE, quiet_days: "3", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.quoteFollowup.saveFailed"] });
  });

  it("stores a whitespace-only body as empty, so it keeps meaning 'use the default'", async () => {
    expect(await saveQuoteFollowupAction("acct_1", fd({ stage_id: STAGE, quiet_days: "3", channel: "email", body: "  \n  " })))
      .toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "quote_followup",
      { enabled: false, body: "", config: { stageId: STAGE, quietDays: 3, channel: "email" } }, "user_1");
  });

  it("refuses a body past the platform maximum", async () => {
    expect(await saveQuoteFollowupAction("acct_1",
      fd({ stage_id: STAGE, quiet_days: "3", channel: "sms", body: "x".repeat(AUTOMATION_BODY_MAX_LENGTH + 1) })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });
});

describe("saveReactivationAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months: "9" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + months + trimmed body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months: "14", body: "  Still holding up?  " })))
      .toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "reactivation",
      { enabled: true, body: "Still holding up?", config: { months: 14 } }, "user_1");
  });

  it("REFUSES a months value outside the range rather than clamping it — at both bounds and one past each", async () => {
    // The card's `max` makes this unreachable from a normal keyboard, which
    // is why the parser's refusal is proved HERE and never in Playwright.
    // Mutation: clamp instead of refusing (`Math.min(18, Math.max(6, n))`) →
    // the two out-of-range lines red, and the operator would see one number
    // while the send used another.
    for (const months of ["5", "19", "9.5", "", "abc"]) {
      expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months })), months)
        .toEqual({ ok: false, error: m["automations.reactivation.monthsInvalid"] });
    }
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    // …and AT each bound it saves, so the refusal is a range and not a wall.
    expect(await saveReactivationAction("acct_1", fd({ months: "6" }))).toEqual({ ok: true });
    expect(await saveReactivationAction("acct_1", fd({ months: "18" }))).toEqual({ ok: true });
  });

  it("a database failure comes back as a toastable failure", async () => {
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months: "9" })))
      .toEqual({ ok: false, error: m["automations.reactivation.saveFailed"] });
  });

  it("stores a whitespace-only body as empty, so it keeps meaning 'use the default'", async () => {
    expect(await saveReactivationAction("acct_1", fd({ months: "9", body: "  \n  " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "reactivation",
      { enabled: false, body: "", config: { months: 9 } }, "user_1");
  });

  // Decision A (danlo, 2026-09-22): the check-in carries the business's postal
  // address and a "reply and let us know" opt-out, so it may not be turned
  // on until both exist. The pass skips a row missing either anyway; refusing
  // here is what tells the operator BEFORE the first morning goes by silent.
  it("turning it on with no mailing address (blank after .trim()) is REFUSED, naming Settings", async () => {
    // Mutation: delete the mailing-address refusal → this reds BY NAME.
    for (const blank of [null, "", " \n\t "]) {
      dbMocks.getMailingAddress.mockResolvedValue(blank);
      expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months: "9" })), JSON.stringify(blank))
        .toEqual({ ok: false, error: m["automations.reactivation.needsMailingAddress"] });
    }
    expect(m["automations.reactivation.needsMailingAddress"]).toContain("Settings");
    expect(dbMocks.getMailingAddress).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("turning it on with no reply-to (blank after .trim()) is REFUSED, naming Settings", async () => {
    // Mutation: delete the reply-to refusal → this reds BY NAME.
    for (const blank of [null, "", "   "]) {
      dbMocks.getBranding.mockResolvedValue({
        brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
        brandCorners: null, brandType: null, brandMode: null, replyToEmail: blank,
      });
      expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months: "9" })), JSON.stringify(blank))
        .toEqual({ ok: false, error: m["automations.reactivation.needsReplyTo"] });
    }
    expect(m["automations.reactivation.needsReplyTo"]).toContain("Settings");
    expect(dbMocks.getBranding).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saving with the recipe OFF needs neither — the months and message still save", async () => {
    // Mutation: check the two regardless of `enabled` → this reds BY NAME,
    // and an operator could not even turn the recipe OFF on an account whose
    // address had been cleared.
    dbMocks.getMailingAddress.mockResolvedValue(null);
    dbMocks.getBranding.mockResolvedValue({
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
    });
    expect(await saveReactivationAction("acct_1", fd({ months: "12", body: "Hi" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "reactivation",
      { enabled: false, body: "Hi", config: { months: 12 } }, "user_1");
  });

  it("a failed read of either comes back as the toastable save failure, and nothing is written", async () => {
    // "Not set" is an answer the refusal acts on; a failed query is not one.
    dbMocks.getMailingAddress.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveReactivationAction("acct_1", fd({ enabled: "on", months: "9" })))
      .toEqual({ ok: false, error: m["automations.reactivation.saveFailed"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("acct_1"));
    spy.mockRestore();
  });
});

describe("saveSmsReminderAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveSmsReminderAction("acct_1", fd({ enabled: "on" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + trimmed body with an empty config — the recipe has nothing else to configure", async () => {
    expect(await saveSmsReminderAction("acct_1", fd({ enabled: "on", body: " See you soon! " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "sms_reminder",
      { enabled: true, body: "See you soon!", config: {} }, "user_1");
  });

  it("saves an OFF row with an empty body, and reports a database failure as a toastable failure", async () => {
    expect(await saveSmsReminderAction("acct_1", fd({}))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "sms_reminder",
      { enabled: false, body: "", config: {} }, "user_1");
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveSmsReminderAction("acct_1", fd({ enabled: "on" })))
      .toEqual({ ok: false, error: m["automations.smsReminder.saveFailed"] });
  });
});

describe("saveAppointmentConfirmAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveAppointmentConfirmAction("acct_1", fd({ enabled: "on" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + trimmed closing line with an empty config — the channel IS the recipe", async () => {
    expect(await saveAppointmentConfirmAction("acct_1", fd({ enabled: "on", body: " Parking is out front. " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "appointment_confirm",
      { enabled: true, body: "Parking is out front.", config: {} }, "user_1");
  });

  it("saves an OFF row with an empty body, and reports a database failure as a toastable failure", async () => {
    expect(await saveAppointmentConfirmAction("acct_1", fd({}))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "appointment_confirm",
      { enabled: false, body: "", config: {} }, "user_1");
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveAppointmentConfirmAction("acct_1", fd({ enabled: "on" })))
      .toEqual({ ok: false, error: m["automations.appointmentConfirm.saveFailed"] });
  });
});

describe("the body cap — every recipe refuses a message longer than AUTOMATION_BODY_MAX_LENGTH", () => {
  const tooLong = "x".repeat(AUTOMATION_BODY_MAX_LENGTH + 1);
  const atCap = "x".repeat(AUTOMATION_BODY_MAX_LENGTH);

  it("review request", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL, body: tooLong })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL, body: atCap }))).toEqual({ ok: true });
  });

  it("no-show nudge", async () => {
    expect(await saveNoShowNudgeAction("acct_1", fd({ channel: "sms", body: tooLong })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("text reminder", async () => {
    expect(await saveSmsReminderAction("acct_1", fd({ body: tooLong })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("referral ask", async () => {
    expect(await saveReferralAskAction("acct_1", fd({ channel: "sms", body: tooLong })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(await saveReferralAskAction("acct_1", fd({ channel: "sms", body: atCap }))).toEqual({ ok: true });
  });

  it("reactivation check-in", async () => {
    expect(await saveReactivationAction("acct_1", fd({ months: "9", body: tooLong })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(await saveReactivationAction("acct_1", fd({ months: "9", body: atCap }))).toEqual({ ok: true });
  });

  it("appointment confirmation", async () => {
    expect(await saveAppointmentConfirmAction("acct_1", fd({ body: tooLong })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    expect(await saveAppointmentConfirmAction("acct_1", fd({ body: atCap }))).toEqual({ ok: true });
  });
});

describe("saveInstantReplyAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "Hi", body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + the English text in body + the Spanish text in config.bodyEs, both trimmed", async () => {
    // Mutation: store the Spanish text untrimmed, or in body.
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "  Hi there  ", body_es: " Hola " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "instant_reply",
      { enabled: true, body: "Hi there", config: { bodyEs: "Hola" } }, "user_1");
  });

  it("turning it on needs BOTH texts — either one blank is refused with copy that says so", async () => {
    // Mutation: require only the English text.
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "Hi", body_es: "   " })))
      .toEqual({ ok: false, error: m["automations.instantReply.bodiesRequired"] });
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "", body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.instantReply.bodiesRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves an OFF row with blank texts, so the operator can come back to it", async () => {
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: "", body_es: "" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "instant_reply",
      { enabled: false, body: "", config: { bodyEs: "" } }, "user_1");
  });

  it("the cap applies to EITHER text", async () => {
    // Mutation: cap only body_en.
    const long = "x".repeat(AUTOMATION_BODY_MAX_LENGTH + 1);
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: long, body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: "Hi", body_es: long })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a database failure comes back as a toastable failure", async () => {
    dbMocks.upsertAutomation.mockRejectedValue(new Error("down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: "Hi", body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.instantReply.saveFailed"] });
    quiet.mockRestore();
  });
});

describe("saveQuietHoursAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "22:00", quiet_end: "07:00" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.saveQuietSettings).not.toHaveBeenCalled();
  });

  it("saves the window through serviceDb, then bumps every held row so tonight's queue is re-read under the new window (mutation: drop the bump → FAILS)", async () => {
    dbMocks.bumpHeldForAccount.mockResolvedValue(3);
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "22:30", quiet_end: "06:15" }))).toEqual({ ok: true });
    expect(dbMocks.saveQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1", { enabled: true, start: "22:30", end: "06:15" }, "user_1");
    expect(dbMocks.bumpHeldForAccount).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.saveQuietSettings.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.bumpHeldForAccount.mock.invocationCallOrder[0]!);
  });

  it("an unticked box saves enabled:false with the times kept", async () => {
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_start: "21:00", quiet_end: "08:00" }))).toEqual({ ok: true });
    expect(dbMocks.saveQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1", { enabled: false, start: "21:00", end: "08:00" }, "user_1");
  });

  it("equal start and end while ON is refused — quiet-hours.ts treats start === end as disabled, so an enabled row with equal times would silently never be quiet (mutation: delete the guard → FAILS)", async () => {
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "21:00", quiet_end: "21:00" })))
      .toEqual({ ok: false, error: m["automations.quiet.invalidTime"] });
    expect(dbMocks.saveQuietSettings).not.toHaveBeenCalled();
  });

  it("equal start and end while OFF still saves — a stored disabled window with equal times is legal", async () => {
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_start: "21:00", quiet_end: "21:00" }))).toEqual({ ok: true });
    expect(dbMocks.saveQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1", { enabled: false, start: "21:00", end: "21:00" }, "user_1");
  });

  it("a time that is not HH:MM is refused with the copy, and nothing is written (mutation: skip isClock → FAILS)", async () => {
    for (const bad of [{ quiet_start: "9pm", quiet_end: "08:00" }, { quiet_start: "21:00", quiet_end: "" }, { quiet_start: "24:00", quiet_end: "08:00" }]) {
      expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", ...bad })), JSON.stringify(bad))
        .toEqual({ ok: false, error: m["automations.quiet.invalidTime"] });
    }
    expect(dbMocks.saveQuietSettings).not.toHaveBeenCalled();
  });

  it("a failed write is a Result, not a throw, and the bump never runs", async () => {
    dbMocks.saveQuietSettings.mockRejectedValue(new Error("down"));
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "21:00", quiet_end: "08:00" })))
      .toEqual({ ok: false, error: m["automations.quiet.saveFailed"] });
    expect(dbMocks.bumpHeldForAccount).not.toHaveBeenCalled();
  });

  it("a failed bump still reports success — the save landed; the queue catches up at each row's own held_until", async () => {
    dbMocks.bumpHeldForAccount.mockRejectedValue(new Error("down"));
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "21:00", quiet_end: "08:00" }))).toEqual({ ok: true });
  });
});
