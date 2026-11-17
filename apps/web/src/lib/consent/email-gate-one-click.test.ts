// Q5 of the daily-brief plan (owner answer, 2026-11-15): RFC 8058 List-Unsubscribe headers on operator mail for ONE
// kind, the daily brief, carrying a signed link the pass supplies. The gate sets those headers today only for
// customer kinds, from the consent token; this proves the new path is a per-kind opt-in in the registry and
// nothing else can reach it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  readConsentState: vi.fn(), readAccountTimezone: vi.fn(), getMailingAddress: vi.fn(),
  readEmailSuppression: vi.fn(), serviceDb: vi.fn(), isAccountOutboundSuppressed: vi.fn(),
  getInboundSettings: vi.fn(), ensureReplyToken: vi.fn(), readBillingStanding: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const factory = vi.hoisted(() => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<object>()), ...factory }));

// The REAL registry (which now holds `operator.daily_brief`, the one real kind that opts in) plus probe kinds that
// opt in wrongly or on their own.
vi.mock("./classes", async (importOriginal) => {
  const real = await importOriginal<typeof import("./classes")>();
  const kinds = { ...real.EMAIL_KINDS, "operator.probe_one_click": { class: "operator", hours: "any", footer: "none", oneClickUnsubscribe: true },
    // Misuse probes: the flag on a kind that keeps the unsubscribe footer, and on a non-operator kind.
    "operator.probe_footer_flagged": { class: "operator", hours: "any", footer: "unsubscribe", oneClickUnsubscribe: true },
    "staff.probe_class_flagged": { class: "staff_typed", hours: "any", footer: "none", oneClickUnsubscribe: true } };
  const known = (k: string) => Object.hasOwn(real.EMAIL_KINDS, k);
  return {
    ...real, EMAIL_KINDS: kinds,
    isEmailKind: (k: string) => Object.hasOwn(kinds, k),
    emailReadsLedger: (k: string) => (known(k) ? real.emailReadsLedger(k as never) : false),
    emailStopsWhilePaused: (k: string) => (known(k) ? real.emailStopsWhilePaused(k as never) : false),
  };
});

import { oneClickHeaders, sendEmail, type EmailRequest } from "./email-gate";
import { EMAIL_KINDS as MOCKED_KINDS, type EmailKind, type EmailKindSpec } from "./classes";
import { UNSUBSCRIBE_MARKER } from "@/lib/email/templates/shell";

const ONE_CLICK = "https://app.example.com/api/brief/off/1.abc.def";
const ACCOUNT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const ENV = { APP_ORIGIN: "https://app.example.com", CONSENT_TOKEN_SECRET: "gate-test-secret-0123456789abcdef-0123" } as unknown as NodeJS.ProcessEnv;
const send = vi.fn();
const req = (kind: string, over: Partial<EmailRequest> = {}): EmailRequest => ({
  accountId: ACCOUNT, kind: kind as EmailKind, to: "ana@example.com", fromName: "Rio Roofing", subject: "Your day",
  body: "text", html: `<p>hi</p>${UNSUBSCRIBE_MARKER}`, accountZone: "America/Chicago", now: new Date("2026-10-06T20:00:00Z"),
  oneClickUnsubscribe: ONE_CLICK, ...over,
});
const headersSent = () => (send.mock.calls[0]![0] as { headers?: Record<string, string> }).headers;

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(factory), send]) fn.mockReset();
  db.readConsentState.mockResolvedValue({ state: "allowed" });
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  db.getMailingAddress.mockResolvedValue(null);
  db.readEmailSuppression.mockResolvedValue(null);
  db.serviceDb.mockReturnValue({ service: true });
  db.isAccountOutboundSuppressed.mockResolvedValue(false);
  db.readBillingStanding.mockResolvedValue(null);
  db.getInboundSettings.mockResolvedValue({ mode: "off", domain: null });
  factory.getEmailProvider.mockReturnValue({ isFake: true, send });
  send.mockResolvedValue({ providerMessageId: "re_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("oneClickHeaders", () => {
  const optedIn: EmailKindSpec & { oneClickUnsubscribe: true } = { class: "operator", hours: "any", footer: "none", oneClickUnsubscribe: true };
  it("the RFC 8058 pair, around the one https url, for a kind that opted in", () => {
    expect(oneClickHeaders(optedIn, ONE_CLICK)).toEqual({
      "List-Unsubscribe": `<${ONE_CLICK}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
  it("nothing for an opted-in kind that is not operator mail", () => {
    expect(oneClickHeaders({ class: "staff_typed", hours: "any", footer: "none", oneClickUnsubscribe: true }, ONE_CLICK)).toBeNull();
    expect(oneClickHeaders({ class: "marketing", hours: "any", footer: "unsubscribe", oneClickUnsubscribe: true }, ONE_CLICK)).toBeNull();
  });
  it("nothing for a kind that did not opt in, however good the url", () => {
    expect(oneClickHeaders({ class: "operator", hours: "any", footer: "none" }, ONE_CLICK)).toBeNull();
    expect(oneClickHeaders({ class: "operator", hours: "any", footer: "none", oneClickUnsubscribe: false } as unknown as EmailKindSpec, ONE_CLICK)).toBeNull();
  });
  it("nothing for a url that is not one https URI: missing, http, relative, a line break, a space, angle brackets", () => {
    for (const bad of [undefined, "", "http://app.example.com/x", "/api/brief/off/t", `${ONE_CLICK}\r\nBcc: x@y.z`, `${ONE_CLICK} extra`, "https://a.com/<x>", "javascript:alert(1)"]) {
      expect(oneClickHeaders(optedIn, bad), String(bad)).toBeNull();
    }
  });
});

describe("the registry: who may carry the one-click link", () => {
  it("the real registry's opted-in list is exactly the daily brief; the probes below are the only others", () => {
    const optedIn = Object.entries(MOCKED_KINDS as Record<string, EmailKindSpec>).filter(([, s]) => s.oneClickUnsubscribe === true).map(([k]) => k);
    expect(optedIn.filter((k) => !k.includes(".probe_"))).toEqual(["operator.daily_brief"]);
    expect(optedIn.filter((k) => k.includes(".probe_"))).toEqual(["operator.probe_one_click", "operator.probe_footer_flagged", "staff.probe_class_flagged"]);
  });
});

describe("sendEmail: the headers reach the provider for the kind that opted in, and for no other", () => {
  it("the opted-in kind carries the pair, and the shell's footer marker is gone", async () => {
    const r = await sendEmail(req("operator.probe_one_click"), { env: ENV });
    expect(r).toEqual({ kind: "sent", providerMessageId: "re_1" });
    expect(headersSent()).toEqual({ "List-Unsubscribe": `<${ONE_CLICK}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect((send.mock.calls[0]![0] as { html: string }).html).not.toContain(UNSUBSCRIBE_MARKER);
  });

  it("the flag alone is not enough: not on a kind that keeps the unsubscribe footer, not on a non-operator kind", async () => {
    await sendEmail(req("operator.probe_footer_flagged", { contactId: "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }), { db: {} as never, env: ENV });
    const footerKind = headersSent();
    expect(footerKind?.["List-Unsubscribe"] ?? "").not.toContain("/api/brief/");
    send.mockClear();
    await sendEmail(req("staff.probe_class_flagged"), { db: {} as never, env: ENV });
    expect(headersSent()).toBeUndefined();
  });

  it("the same request on that kind WITHOUT a link sends no headers (the body link still ships)", async () => {
    await sendEmail(req("operator.probe_one_click", { oneClickUnsubscribe: undefined }), { env: ENV });
    expect(headersSent()).toBeUndefined();
  });

  it("the REAL daily brief kind carries both headers for the signed link it was handed (mutation: drop oneClickUnsubscribe from its registry row -> FAILS)", async () => {
    await sendEmail(req("operator.daily_brief"), { db: {} as never, env: ENV });
    expect(headersSent()).toEqual({ "List-Unsubscribe": `<${ONE_CLICK}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("the gate hands the caller's idempotencyKey to the provider, and a request without one carries none (the provider then mints a random key; mutation: drop it from sendFields -> FAILS)", async () => {
    await sendEmail(req("operator.daily_brief", { idempotencyKey: "daily-brief/a/u/2027-03-10" }), { db: {} as never, env: ENV });
    expect((send.mock.calls[0]![0] as { idempotencyKey?: string }).idempotencyKey).toBe("daily-brief/a/u/2027-03-10");
    send.mockClear();
    await sendEmail(req("operator.weekly_report"), { db: {} as never, env: ENV });
    expect(send.mock.calls[0]![0]).not.toHaveProperty("idempotencyKey");
  });

  it("every other OPERATOR kind ignores a link it was handed: no headers", async () => {
    const others = Object.entries(MOCKED_KINDS as Record<string, EmailKindSpec>)
      .filter(([k, s]) => s.class === "operator" && !k.startsWith("operator.probe_") && k !== "operator.daily_brief").map(([k]) => k);
    expect(others.length).toBeGreaterThan(5);
    for (const kind of others) {
      send.mockClear();
      await sendEmail(req(kind, { accountId: kind === "operator.agency_report" ? null : ACCOUNT }), { db: {} as never, env: ENV });
      expect(send, kind).toHaveBeenCalledTimes(1);
      expect(headersSent(), kind).toBeUndefined();
    }
  });

  it("a customer kind keeps ITS own consent-token headers; the handed link never replaces or joins them", async () => {
    await sendEmail(req("automation.reminder", { contactId: "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }), { db: {} as never, env: ENV });
    const h = headersSent()!;
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\/api\/unsubscribe\//);
    expect(h["List-Unsubscribe"]).not.toContain("/api/brief/");
    expect(Object.keys(h).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
  });
});
