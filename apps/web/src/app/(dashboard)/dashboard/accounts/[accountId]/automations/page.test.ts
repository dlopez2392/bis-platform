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
const originMock = vi.hoisted(() => ({ headers: vi.fn(), originFrom: vi.fn() }));
vi.mock("next/headers", () => ({ headers: (...a: unknown[]) => originMock.headers(...a) }));
vi.mock("@/lib/email/origin", () => ({ originFrom: (...a: unknown[]) => originMock.originFrom(...a) }));
const dbFixture = vi.hoisted(() => ({
  name: "Rio Roofing — trial", timezone: "America/Chicago", brandName: null as string | null,
  replyToEmail: "owner@rioroofing.com" as string | null,
}));
const dbMock = vi.hoisted(() => ({
  getAutomation: vi.fn(), getBranding: vi.fn(), getCalendarForAccount: vi.fn(), readQuietSettings: vi.fn(),
  listPipelinesWithStages: vi.fn(), getMailingAddress: vi.fn(),
}));
vi.mock("@bis/db", async () => ({
  // THE REAL RULE, not a stub: the page asks `missingForReactivation` (whose
  // home is @bis/db since the review fix of 2026-09-22; the page reaches it
  // through reactivation-gate.ts's re-export), and the reactivation case
  // below exists to prove the page judges "missing" exactly as the save and
  // the pass do. A stub here would prove the stub.
  missingForReactivation: (await vi.importActual<typeof import("@bis/db")>("@bis/db")).missingForReactivation,
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
  listPipelinesWithStages: (...a: unknown[]) => dbMock.listPipelinesWithStages(...a),
  getMailingAddress: (...a: unknown[]) => dbMock.getMailingAddress(...a),
  DEFAULT_QUIET_SETTINGS: { enabled: true, start: "21:00", end: "08:00" },
}));
const smsMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: (...a: unknown[]) => smsMock.resolveSmsSender(...a),
}));
vi.mock("./actions", () => ({
  saveReviewRequestAction: async () => ({ ok: true }),
  saveReferralAskAction: async () => ({ ok: true }),
  saveReactivationAction: async () => ({ ok: true }),
  saveNoShowNudgeAction: async () => ({ ok: true }),
  saveSmsReminderAction: async () => ({ ok: true }),
  saveAppointmentConfirmAction: async () => ({ ok: true }),
  saveQuoteFollowupAction: async () => ({ ok: true }),
  saveInstantReplyAction: async () => ({ ok: true }),
  saveQuietHoursAction: async () => ({ ok: true }),
}));

type Props = Record<string, unknown>;
const captured = vi.hoisted(() => ({
  review: null as Props | null, noShow: null as Props | null, sms: null as Props | null, instant: null as Props | null,
  confirm: null as Props | null, quiet: null as Props | null, referral: null as Props | null,
  reactivation: null as Props | null, quoteFollowup: null as Props | null,
}));
vi.mock("./automations-settings", () => ({
  AutomationsSettings: (props: Props) => { captured.review = props; return null; },
}));
vi.mock("./referral-ask-card", () => ({
  ReferralAskCard: (props: Props) => { captured.referral = props; return null; },
}));
vi.mock("./reactivation-card", () => ({
  ReactivationCard: (props: Props) => { captured.reactivation = props; return null; },
}));
vi.mock("./quote-followup-card", () => ({
  QuoteFollowupCard: (props: Props) => { captured.quoteFollowup = props; return null; },
}));
vi.mock("./no-show-nudge-card", () => ({
  NoShowNudgeCard: (props: Props) => { captured.noShow = props; return null; },
}));
vi.mock("./sms-reminder-card", () => ({
  SmsReminderCard: (props: Props) => { captured.sms = props; return null; },
}));
vi.mock("./appointment-confirm-card", () => ({
  AppointmentConfirmCard: (props: Props) => { captured.confirm = props; return null; },
}));
vi.mock("./instant-reply-card", () => ({
  InstantReplyCard: (props: Props) => { captured.instant = props; return null; },
}));
vi.mock("./quiet-hours-card", () => ({
  QuietHoursCard: (props: Props) => { captured.quiet = props; return null; },
}));

const { default: AutomationsPage } = await import("./page");

const base = { account_id: "a1", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z" };
const STAGE_ID = "6f1b2c3d-4e5a-4b7c-8d9e-0a1b2c3d4e5f";
const ROWS: Record<string, AutomationRow> = {
  review_request: { ...base, id: "au1", recipe_key: "review_request", enabled: true, body: "Hi",
    config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
  referral_ask: { ...base, id: "au6", recipe_key: "referral_ask", enabled: true, body: "Know anyone else?", config: { channel: "sms" } },
  reactivation: { ...base, id: "au7", recipe_key: "reactivation", enabled: true, body: "Still holding up?", config: { months: 14 } },
  no_show_nudge: { ...base, id: "au2", recipe_key: "no_show_nudge", enabled: false, body: "Come back", config: { channel: "email" } },
  instant_reply: { ...base, id: "au4", recipe_key: "instant_reply", enabled: false, body: "Hi", config: { bodyEs: "Hola" } },
  appointment_confirm: { ...base, id: "au5", recipe_key: "appointment_confirm", enabled: true, body: "Parking is out front.", config: {} },
  quote_followup: { ...base, id: "au8", recipe_key: "quote_followup", enabled: true, body: "Any questions?",
    config: { stageId: STAGE_ID, quietDays: 4, channel: "email" } },
};

async function render() {
  captured.review = captured.noShow = captured.sms = captured.instant = captured.confirm = captured.quiet = captured.referral = captured.reactivation = captured.quoteFollowup = null;
  renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
  return captured;
}

beforeEach(() => {
  dbFixture.name = "Rio Roofing — trial";
  dbFixture.timezone = "America/Chicago";
  dbFixture.brandName = null;
  dbFixture.replyToEmail = "owner@rioroofing.com";
  dbMock.getMailingAddress.mockReset().mockResolvedValue("123 Main St\nMcAllen, TX 78501");
  dbMock.getAutomation.mockReset().mockImplementation(async (_db: unknown, _a: unknown, key: string) => ROWS[key] ?? null);
  dbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: dbFixture.replyToEmail,
  }));
  dbMock.getCalendarForAccount.mockReset().mockResolvedValue({ id: "cal_1", public_id: "cal_pub_1", enabled: true });
  dbMock.readQuietSettings.mockReset().mockResolvedValue({ enabled: true, start: "22:30", end: "06:15" });
  dbMock.listPipelinesWithStages.mockReset().mockResolvedValue([
    { id: "pl_1", name: "Sales", stages: [{ id: STAGE_ID, name: "Quoted", position: 2 }] },
  ]);
  smsMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
  originMock.headers.mockReset().mockResolvedValue(new Headers({ host: "app.example.com" }));
  originMock.originFrom.mockReset().mockReturnValue("https://app.example.com");
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

  it("hands the confirmation card ITS OWN row, the brand name, the account's zone and the SMS gate", async () => {
    // Mutation: hand it `smsReminder` (the adjacent binding in the positional
    // Promise.all) — this reds, because that read has no stored row and
    // resolves null while `appointment_confirm` has au5.
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.confirm!.automation).toEqual(ROWS.appointment_confirm);
    expect(c.confirm!.brandName).toBe("Rio Roofing");
    expect(c.confirm!.accountTimezone).toBe("America/Chicago");
    expect(c.confirm!.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
    expect(dbMock.getAutomation).toHaveBeenCalledWith(expect.anything(), "a1", "appointment_confirm");
  });

  it("hands the referral-ask card ITS OWN row, the brand name and the SMS gate", async () => {
    // Mutation: hand it `review` or `noShow` (the two adjacent bindings in
    // the positional Promise.all) — this reds, because those rows are au1
    // and au2 while `referral_ask` is au6.
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.referral!.automation).toEqual(ROWS.referral_ask);
    expect(c.referral!.brandName).toBe("Rio Roofing");
    expect(c.referral!.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
    expect(dbMock.getAutomation).toHaveBeenCalledWith(expect.anything(), "a1", "referral_ask");
  });

  it("hands the reactivation card ITS OWN row and the brand name — and NO sms gate, because it is email only", async () => {
    // Mutation: hand it `referral` or `noShow` (the two adjacent bindings in
    // the positional Promise.all) — this reds, because those rows are au6
    // and au2 while `reactivation` is au7. The absent `smsGate` prop is the
    // same email-only rule the due-row type states by carrying no phone.
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.reactivation!.automation).toEqual(ROWS.reactivation);
    expect(c.reactivation!.brandName).toBe("Rio Roofing");
    expect(c.reactivation).not.toHaveProperty("smsGate");
    expect(dbMock.getAutomation).toHaveBeenCalledWith(expect.anything(), "a1", "reactivation");
  });

  it("hands the reactivation card the account id and WHAT IS MISSING — the address and the reply-to, judged like the save and the pass judge them", async () => {
    // Decision A (2026-09-22). Mutation: hand the card a constant
    // `{ mailingAddress: false, replyTo: false }` → the second and third
    // halves red BY NAME; swap the two facts → the second half reds.
    let c = await render();
    expect(c.reactivation!.accountId).toBe("a1");
    expect(c.reactivation!.missing).toEqual({ mailingAddress: false, replyTo: false });
    expect(dbMock.getMailingAddress).toHaveBeenCalledWith(expect.anything(), "a1");

    dbMock.getMailingAddress.mockResolvedValue(" \n ");   // blank after .trim()
    c = await render();
    expect(c.reactivation!.missing).toEqual({ mailingAddress: true, replyTo: false });

    dbMock.getMailingAddress.mockResolvedValue("123 Main St");
    dbFixture.replyToEmail = null;
    c = await render();
    expect(c.reactivation!.missing).toEqual({ mailingAddress: false, replyTo: true });
  });

  it("a failed address read degrades to NO warning, never a false one — and says so in the log", async () => {
    // The warning is advice; the save and the pass are what enforce. Telling
    // an operator their address is missing when it was only unread would send
    // them to fix a field that is fine. Mutation: degrade to `true` → reds.
    dbMock.getMailingAddress.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let c = await render();
    expect(c.reactivation!.missing).toEqual({ mailingAddress: false, replyTo: false });
    expect(c.reactivation!.automation).toEqual(ROWS.reactivation);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    // …and the reply-to, read with the brand name: a failed branding read is
    // UNREAD, not "no reply-to". Mutation: drop the `!== undefined` guard on
    // `replyTo` → this half reds.
    dbMock.getMailingAddress.mockResolvedValue("123 Main St");
    dbMock.getBranding.mockRejectedValue(new Error("down"));
    c = await render();
    expect(c.reactivation!.missing).toEqual({ mailingAddress: false, replyTo: false });
    spy.mockRestore();
  });

  it("hands the quote follow-up card ITS OWN row, the SMS gate, and the account's stages flattened for the select", async () => {
    // Mutation: hand it `confirm` or `instant` (the two adjacent bindings in
    // the positional Promise.all) — this reds, because those rows are au5 and
    // au4 while `quote_followup` is au8. ONE pipeline, so the label is the
    // bare stage name; the "Sales · Quoted" form is the many-pipeline case
    // below.
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.quoteFollowup!.automation).toEqual(ROWS.quote_followup);
    expect(c.quoteFollowup!.brandName).toBe("Rio Roofing");
    expect(c.quoteFollowup!.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
    expect(c.quoteFollowup!.stages).toEqual([{ id: STAGE_ID, label: "Quoted" }]);
    expect(dbMock.getAutomation).toHaveBeenCalledWith(expect.anything(), "a1", "quote_followup");
  });

  it("prefixes a stage with its pipeline ONLY when the account has more than one pipeline", async () => {
    // Mutation: prefix unconditionally → the single-pipeline case above reds;
    // never prefix → this one reds. Two stages from two pipelines could
    // otherwise both read "Quoted" in the same select.
    dbMock.listPipelinesWithStages.mockResolvedValue([
      { id: "pl_1", name: "Sales", stages: [{ id: STAGE_ID, name: "Quoted", position: 2 }] },
      { id: "pl_2", name: "Service", stages: [{ id: "stg_b", name: "Quoted", position: 1 }] },
    ]);
    const c = await render();
    expect(c.quoteFollowup!.stages).toEqual([
      { id: STAGE_ID, label: "Sales · Quoted" }, { id: "stg_b", label: "Service · Quoted" },
    ]);
  });

  it("a failed pipeline read degrades to NO stages; the rest of the page still renders", async () => {
    dbMock.listPipelinesWithStages.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.quoteFollowup!.stages).toEqual([]);
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
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
  it("a failed settings read degrades to null — never the defaults, which would look like a saved window — and says so in the log, never a blank page", async () => {
    // Mutation: fall back to DEFAULT_QUIET_SETTINGS instead of null → FAILS.
    // Rendering the defaults as though they were the client's stored window
    // would let an agency press Save and silently overwrite a real
    // 22:30–06:15 with the platform default.
    dbMock.readQuietSettings.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { quiet } = await render();
    expect(quiet).toMatchObject({ settings: null });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });
});

/**
 * Part C cleanup item 1: every remaining unguarded read on this page (the
 * eight `getAutomation` calls, `listPipelinesWithStages`, `resolveSmsSender`, `getCalendarForAccount`,
 * and the `headers()`/origin lookup) degrades to the value its own card
 * already treats as "nothing configured" — a transient Supabase hiccup on
 * ANY one of these must not 500 the whole agency page. Each card already
 * renders its own empty/blocked state from that value, so the assertion is
 * always: the page still renders every card, and the ONE card whose read
 * failed got the degraded value.
 */
describe("guarded reads — one failed read degrades only its own card, never the page", () => {
  it("a failed review_request automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "review_request") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.review!.automation).toBeNull();
    expect(c.noShow!.automation).toEqual(ROWS.no_show_nudge);
    expect(c.instant!.automation).toEqual(ROWS.instant_reply);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed no_show_nudge automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "no_show_nudge") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.noShow!.automation).toBeNull();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed sms_reminder automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "sms_reminder") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.sms!.automation).toBeNull();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed appointment_confirm automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "appointment_confirm") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.confirm!.automation).toBeNull();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(c.instant!.automation).toEqual(ROWS.instant_reply);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed referral_ask automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "referral_ask") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.referral!.automation).toBeNull();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(c.noShow!.automation).toEqual(ROWS.no_show_nudge);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed reactivation automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "reactivation") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.reactivation!.automation).toBeNull();
    expect(c.referral!.automation).toEqual(ROWS.referral_ask);
    expect(c.noShow!.automation).toEqual(ROWS.no_show_nudge);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed instant_reply automation read degrades to null; the rest of the page still renders", async () => {
    dbMock.getAutomation.mockImplementation(async (_db: unknown, _a: unknown, key: string) => {
      if (key === "instant_reply") throw new Error("down");
      return ROWS[key] ?? null;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.instant!.automation).toBeNull();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed SMS-sender gate read degrades to the SAME refusal resolveSmsSender itself returns for a missing row", async () => {
    smsMock.resolveSmsSender.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    const refused = { ok: false, reason: "a2p_not_approved" };
    expect(c.review!.smsGate).toEqual(refused);
    expect(c.noShow!.smsGate).toEqual(refused);
    expect(c.sms!.smsGate).toEqual(refused);
    expect(c.confirm!.smsGate).toEqual(refused);
    expect(c.referral!.smsGate).toEqual(refused);
    expect(c.instant!.smsGate).toEqual(refused);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed calendar read degrades to null; the nudge card shows its own off state, not a 500", async () => {
    dbMock.getCalendarForAccount.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.noShow!.bookingUrl).toBe("");
    expect(c.noShow!.calendarEnabled).toBe(false);
    expect(c.review).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });

  it("a failed origin lookup degrades to an empty string; the booking link goes blank instead of 500ing the page", async () => {
    originMock.headers.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await render();
    expect(c.noShow!.bookingUrl).toBe("");
    expect(c.review).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    spy.mockRestore();
  });
});
