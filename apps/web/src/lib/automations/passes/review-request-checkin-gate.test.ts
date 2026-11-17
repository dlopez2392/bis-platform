import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DueReviewRequest } from "@bis/db";

/**
 * The check-in through the REAL consent gate (F-072 PR 3; plan D4, D6): `ctx.email` here is the gate's own
 * `sendEmailOrThrow` bound to a stub database, with only the PROVIDER stubbed (a spy standing where Resend would).
 * No email leaves this file and no real provider is built. What the pass-level tests cannot show is shown here:
 * the opt-out, the suppressed account, and the footer, the headers and the mailing address the gate adds.
 */
const dbMocks = vi.hoisted(() => ({
  listDueReviewRequests: vi.fn(), stampReviewRequested: vi.fn(), countReviewRequestsSince: vi.fn(),
  recentReviewAsks: vi.fn(), recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn(),
  isAccountOutboundSuppressed: vi.fn(), readConsentState: vi.fn(), getMailingAddress: vi.fn(),
  readEmailSuppression: vi.fn(), readAccountTimezone: vi.fn(), getInboundSettings: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const provider = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ isFake: true, send: provider.send }) }));

import { fakeSmsGate } from "@/lib/consent/fake-gate";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import type { PassContext } from "../context";
import { NO_CLOSURES } from "../closures";
import { reviewRequestPass } from "./review-request";

const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const BK1 = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const COMPLETED = new Date("2026-09-09T19:00:00Z");              // Wed 14:00 CDT
const TICK = new Date(COMPLETED.getTime() + 2 * 60 * 60 * 1000); // 16:00 CDT, inside the sending hours
const DB = { tick: true } as never;
const ORIGIN = "https://app.example.com";
const POSTAL = "12 Main St\nMcAllen TX 78501";

function row(over: Partial<DueReviewRequest> = {}): DueReviewRequest {
  return {
    bookingId: BK1, accountId: ACCT, startsAt: "2026-09-09T17:00:00.000Z", closureKeptAt: null,
    endsAt: "2026-09-09T18:00:00.000Z", followupSentAt: null, completedAt: COMPLETED.toISOString(), smsFailedAt: null,
    contactId: "ct_1", contactEmail: "ana@example.com", contactPhone: null,
    brandName: "Rio Roofing",
    branding: { brandName: "Rio Roofing", brandLogoPath: "acct/logo.png", brandColor: "#1e3a8a", brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    accountTimezone: "America/Chicago", fromEmail: null, replyToEmail: "owner@rioroofing.com",
    body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review", checkin: true },
    language: "en", bodyEs: null, mailingAddress: "12 Main St, McAllen TX 78501",
    ...over,
  };
}
const ctx = (): PassContext => ({
  db: DB, now: TICK, origin: ORIGIN,
  email: { isFake: true, send: (req) => sendEmailOrThrow(req, { db: DB, env: process.env }) },
  sms: fakeSmsGate({ send: async () => ({ providerMessageId: "s" }) }), closures: NO_CLOSURES,
});
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,
};
const sent = () => provider.send.mock.calls[0]![0] as { to: string; subject: string; body: string; html: string; headers?: Record<string, string>; replyTo?: string };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  provider.send.mockReset().mockResolvedValue({ providerMessageId: "fake_1" });
  dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
  dbMocks.stampReviewRequested.mockResolvedValue(undefined);
  dbMocks.countReviewRequestsSince.mockResolvedValue(0);
  dbMocks.recentReviewAsks.mockResolvedValue(false);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  dbMocks.isAccountOutboundSuppressed.mockResolvedValue(false);
  dbMocks.readConsentState.mockResolvedValue({ state: "allowed" });
  dbMocks.getMailingAddress.mockResolvedValue(POSTAL);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("CONSENT_TOKEN_SECRET", "s".repeat(40));
  vi.stubEnv("APP_ORIGIN", ORIGIN);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("an opted-out address and a suppressed account get nothing (the check-in keeps the review request's kind)", () => {
  it("an address that stopped these emails is refused by the gate: blocked, nothing reaches the provider, nothing is stamped (mutation: send under a kind the ledger does not read -> FAILS)", async () => {
    dbMocks.readConsentState.mockResolvedValue({ state: "stopped", method: "unsubscribe_link" });
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, blocked: 1 });
    expect(dbMocks.readConsentState).toHaveBeenCalledWith(DB, ACCT, "email", "ana@example.com");
    expect(provider.send).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("an address on hold is refused the same way", async () => {
    dbMocks.readConsentState.mockResolvedValue({ state: "held" });
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, blocked: 1 });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("an outbound-suppressed account with checkin: true sends nothing: blocked, the provider never called (mutation: bypass the gate for the check-in -> FAILS)", async () => {
    dbMocks.isAccountOutboundSuppressed.mockResolvedValue(true);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, blocked: 1 });
    expect(dbMocks.isAccountOutboundSuppressed).toHaveBeenCalledWith(DB, ACCT);
    expect(provider.send).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });
});

describe("what the customer receives, subject through footer", () => {
  for (const [language, subject, question, button, unsubscribe] of [
    ["en", "How did we do, Rio Roofing?", "Thanks for choosing Rio Roofing. One quick question: how did we do?", "Tell us how we did", "unsubscribe"],
    ["es", "¿Cómo le fue con Rio Roofing?", "Gracias por elegir a Rio Roofing. Una pregunta rápida: ¿cómo le fue?", "Cuéntenos cómo nos fue", "cancelar"],
  ] as const) {
    it(`${language}: the brand's logo and name, ONE check-in link in both parts, and the gate's unsubscribe footer and postal address`, async () => {
      dbMocks.listDueReviewRequests.mockResolvedValue([row({ language })]);
      expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
      const mail = sent();
      expect(mail.subject).toBe(subject);
      expect(mail.body).toContain(question);
      expect(mail.html).toContain(question);
      expect(mail.html).toContain(`>${button}</a>`);
      expect(mail.html).toContain("https://proj.supabase.co/storage/v1/object/public/"); // the brand's own logo
      expect(mail.html).toContain("acct/logo.png");
      // The check-in link: one, the same, in both parts.
      const link = /https:\/\/app\.example\.com\/r\/1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}/.exec(mail.body)?.[0];
      expect(link).toBeTruthy();
      expect(mail.body.split(link!).length - 1).toBe(1);
      expect(mail.html.split(`href="${link}"`).length - 1).toBe(1);
      // The footer the GATE adds: the way off, and where the business is.
      expect(mail.body).toMatch(new RegExp(unsubscribe, "i"));
      expect(mail.body).toContain("https://app.example.com/u/");
      expect(mail.body).toContain("12 Main St");
      expect(mail.body).toContain("McAllen TX 78501");
      expect(mail.html).toContain("12 Main St");
      expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\/api\/unsubscribe\//);
      expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(mail.replyTo).toBe("owner@rioroofing.com");
    });
  }

  it("is branded with the brand name, never the internal label, in the subject, the body and the From name (mutation: draw {name} from accounts.name -> FAILS)", async () => {
    // The due row has no accounts.name field to draw from; the guard is that the brand name is what appears.
    await reviewRequestPass.run(ctx());
    const mail = provider.send.mock.calls[0]![0] as { subject: string; body: string; fromName: string };
    expect(`${mail.subject}\n${mail.body}`).toContain("Rio Roofing");
    expect(mail.fromName).toBe("Rio Roofing");
    expect(`${mail.subject}\n${mail.body}`).not.toMatch(/trial|internal/i);
  });
});
