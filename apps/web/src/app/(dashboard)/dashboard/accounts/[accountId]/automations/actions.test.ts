import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertAutomation: vi.fn() }));
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
import { saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction, saveInstantReplyAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const URL = "https://g.page/r/x/review";

beforeEach(() => {
  guardFixture.isAgency = true;
  dbMocks.upsertAutomation.mockReset().mockResolvedValue({});
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
