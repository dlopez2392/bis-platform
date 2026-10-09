import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_CLIENT = { service: true } as never;
const db = vi.hoisted(() => ({
  readConsentState: vi.fn(), readAccountTimezone: vi.fn(), getMailingAddress: vi.fn(),
  readEmailSuppression: vi.fn(), serviceDb: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const factory = vi.hoisted(() => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<object>()), ...factory }));

import { sendEmail, sendEmailOrThrow, EmailNotSent, emailSenderFor, operatorMailer, type EmailRequest } from "./email-gate";
import { openConsentToken } from "./token";
import { EMAIL_KINDS, type EmailKind } from "./classes";
import { shell, emailBrand, UNSUBSCRIBE_MARKER } from "@/lib/email/templates/shell";

const CLIENT = {} as never;
const SECRET = "gate-test-secret-0123456789abcdef-0123";
const ENV = { APP_ORIGIN: "https://app.example.com", CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const CONTACT = "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
// Tue 2026-10-06 15:00 in Chicago (CDT): inside the automated window.
const DAY = new Date("2026-10-06T20:00:00Z");
// Tue 2026-10-06 22:30 in Chicago: outside it; it opens at 08:00 on the 7th.
const NIGHT = new Date("2026-10-07T03:30:00Z");
const HTML = shell(emailBrand({ brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null }), "<p>See you at 3</p>");
const base = (over: Partial<EmailRequest> = {}): EmailRequest => ({
  accountId: ACCOUNT, kind: "automation.reminder", to: "  Ana.Lopez@Example.com ", contactId: CONTACT,
  fromName: "Rio Roofing", subject: "Reminder", body: "See you at 3", html: HTML,
  accountZone: "America/Chicago", now: DAY, ...over,
});
const send = vi.fn();
const provider = (over: Record<string, unknown> = {}) => ({ isFake: true, send, ...over });
const sent = () => send.mock.calls[0]![0] as Record<string, unknown> & { headers?: Record<string, string>; html?: string; body: string };

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(factory), send]) fn.mockReset();
  db.readConsentState.mockResolvedValue({ state: "allowed" });
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  db.getMailingAddress.mockResolvedValue(null);
  db.readEmailSuppression.mockResolvedValue(null);
  db.serviceDb.mockReturnValue(SERVICE_CLIENT);
  factory.getEmailProvider.mockReturnValue(provider());
  send.mockResolvedValue({ providerMessageId: "re_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(console.error).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("sendEmail: the registry and the address", () => {
  it("throws on a kind the registry does not hold, and on a customer kind with no account (mutation: drop the isEmailKind check → resolves, FAILS)", async () => {
    await expect(sendEmail(base({ kind: "automation.reminders" as EmailKind }), { db: CLIENT, env: ENV })).rejects.toThrow(/unknown email kind "automation.reminders"/);
    await expect(sendEmail(base({ accountId: null, kind: "booking.confirmation" }), { env: ENV })).rejects.toThrow(/needs its account/);
  });

  it("an address the ledger cannot key is blocked no_address before any read or provider (mutation: skip emailLedgerAddress → the provider is asked, FAILS)", async () => {
    expect(await sendEmail(base({ to: "not an address" }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "no_address" });
    expect(db.readConsentState).not.toHaveBeenCalled();
    expect(factory.getEmailProvider).not.toHaveBeenCalled();
  });
});

describe("sendEmail: what an unsubscribe stops (decision 7)", () => {
  it.each(["automation.reminder", "automation.followup", "automation.review_request", "automation.referral_ask",
    "automation.reactivation", "automation.quote_followup", "automation.no_show_nudge"] as const)(
    "%s to a stopped address is blocked `stopped`, read on the LEDGER KEY (mutation: read the raw `to` → the mixed-case address is asked, FAILS)", async (kind) => {
      db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "one_click", eventId: "e1" });
      expect(await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "stopped" });
      expect(db.readConsentState).toHaveBeenCalledWith(CLIENT, ACCOUNT, "email", "ana.lopez@example.com");
      expect(send).not.toHaveBeenCalled();
    });

  // Review item 1 (D-016): every automation.* email kind reads the LEDGER
  // (the branch above), never the new readEmailSuppression check (item 3,
  // which only runs for kinds the ledger read skips) — so a bounce or a
  // complaint reaches THIS branch as a plain `revoked`/"stopped" row, and
  // without this fix it would be told apart from a real "they asked not to"
  // stop nowhere upstream of the Activity page's reason text.
  it.each(["automation.reminder", "automation.review_request"] as const)(
    "%s to an address the LEDGER's OWN bounce/complaint row stopped is blocked `suppressed`, never the generic `stopped` (mutation: drop the method check → FAILS)", async (kind) => {
      db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T00:00:00Z", method: "email_bounce", eventId: "e1" });
      expect(await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "suppressed" });
      db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T00:00:00Z", method: "email_complaint", eventId: "e2" });
      expect(await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "suppressed" });
      // A REAL customer stop on the same branch is untouched.
      db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T00:00:00Z", method: "one_click", eventId: "e3" });
      expect(await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "stopped" });
    });

  it.each(["booking.confirmation", "forms.receipt", "voice.booked", "voice.moved", "voice.cancelled",
    "staff.composer_email", "operator.booking_alert"] as const)(
    "%s is NOT subject to the ledger: it never reads it and sends to a stopped address (decision 7, choices 22 and 23; mutation: read the ledger for every kind → FAILS)", async (kind) => {
      db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "one_click", eventId: "e1" });
      expect((await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).kind).toBe("sent");
      expect(db.readConsentState).not.toHaveBeenCalled();
    });

  it("a held address is blocked `held`; an unreadable ledger is blocked `ledger_unavailable`, logged, never sent (fails closed, spec §5; mutation: treat a read error as allowed → FAILS)", async () => {
    db.readConsentState.mockResolvedValueOnce({ state: "held", since: "2026-10-01T00:00:00Z", method: "free_text", eventId: "h1" });
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "held" });
    db.readConsentState.mockRejectedValueOnce(new Error("readConsentState failed: timeout"));
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/automation\.reminder .*blocked, consent state unreadable/);
    expect(send).not.toHaveBeenCalled();
  });

  it("a ledger kind with no client is a programming error, not a silent send (mutation: skip the read when db is missing → sends, FAILS)", async () => {
    await expect(sendEmail(base(), { env: ENV })).rejects.toThrow(/reads the ledger and needs a client/);
  });
});

describe("sendEmail: a hard-bounced or complained address (D-016 item 3) — nothing stops it but the customer's own resubscribe", () => {
  it.each(["booking.confirmation", "forms.receipt", "voice.booked", "voice.moved", "voice.cancelled", "staff.composer_email"] as const)(
    "%s to a suppressed address is blocked `suppressed`, read on the LEDGER KEY (mutation: skip the suppression check for these kinds → FAILS)", async (kind) => {
      db.readEmailSuppression.mockResolvedValue({ method: "email_bounce", since: "2026-10-03T00:00:00Z", eventId: "s1" });
      expect(await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "suppressed" });
      expect(db.readEmailSuppression).toHaveBeenCalledWith(CLIENT, ACCOUNT, "ana.lopez@example.com");
      expect(send).not.toHaveBeenCalled();
    });

  it("operator mail is NEVER checked against the suppression ledger — it goes to the business owner's own address, not the customer's (mutation: check it for every kind → FAILS)", async () => {
    db.readEmailSuppression.mockResolvedValue({ method: "email_complaint", since: "2026-10-03T00:00:00Z", eventId: "s1" });
    expect((await sendEmail(base({ kind: "operator.lead_alert" }), { db: CLIENT, env: ENV })).kind).toBe("sent");
    expect(db.readEmailSuppression).not.toHaveBeenCalled();
  });

  it.each(["automation.reminder", "automation.review_request"] as const)(
    "%s never calls the NEW suppression read — a bounce/complaint row is ALSO a `revoked` row the existing ledger read already sees (mutation: call it for every kind → FAILS)", async (kind) => {
      db.readConsentState.mockResolvedValue({ state: "allowed" });
      expect((await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).kind).toBe("sent");
      expect(db.readEmailSuppression).not.toHaveBeenCalled();
    });

  it("an unreadable suppression check fails closed: blocked ledger_unavailable, logged, never sent (mutation: treat a throw as not-suppressed → FAILS)", async () => {
    db.readEmailSuppression.mockRejectedValueOnce(new Error("readEmailSuppression failed: timeout"));
    expect(await sendEmail(base({ kind: "booking.confirmation" }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/booking\.confirmation .*blocked, suppression unreadable/);
    expect(send).not.toHaveBeenCalled();
  });

  it("with no client in deps, the gate reads the suppression ledger through serviceDb() rather than throwing (mutation: never fall back → a programming error where a graceful check belongs, FAILS)", async () => {
    db.readEmailSuppression.mockResolvedValue({ method: "email_bounce", since: "2026-10-03T00:00:00Z", eventId: "s1" });
    expect(await sendEmail(base({ kind: "staff.composer_email" }), { env: ENV })).toEqual({ kind: "blocked", reason: "suppressed" });
    expect(db.serviceDb).toHaveBeenCalled();
    expect(db.readEmailSuppression).toHaveBeenCalledWith(SERVICE_CLIENT, ACCOUNT, "ana.lopez@example.com");
  });
});

describe("sendEmail: the automated hours (choice 31)", () => {
  it("outside 08:00-21:00 in the account's zone an automated kind is deferred to the opening, and a customer kind is not (mutation: drop the hours step → sent at 22:30, FAILS)", async () => {
    expect(await sendEmail(base({ now: NIGHT }), { db: CLIENT, env: ENV }))
      .toEqual({ kind: "deferred", until: new Date("2026-10-07T13:00:00Z"), zone: "America/Chicago" });
    expect((await sendEmail(base({ kind: "booking.confirmation", now: NIGHT }), { env: ENV })).kind).toBe("sent");
  });

  it("a deadline before the opening is blocked window_after_deadline (choice 21; mutation: ignore the deadline → deferred, FAILS)", async () => {
    expect(await sendEmail(base({ now: NIGHT, deadline: new Date("2026-10-07T12:00:00Z") }), { db: CLIENT, env: ENV }))
      .toEqual({ kind: "blocked", reason: "window_after_deadline" });
  });

  it("with no accountZone the zone is READ, and an unreadable zone fails closed (mutation: fall back to Chicago on a read error → deferred, FAILS)", async () => {
    db.readAccountTimezone.mockResolvedValueOnce("America/Los_Angeles");
    expect(await sendEmail(base({ accountZone: undefined, now: new Date("2026-10-06T14:30:00Z") }), { db: CLIENT, env: ENV }))
      .toEqual({ kind: "deferred", until: new Date("2026-10-06T15:00:00Z"), zone: "America/Los_Angeles" });
    db.readAccountTimezone.mockRejectedValueOnce(new Error("down"));
    expect(await sendEmail(base({ accountZone: undefined }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
  });
});

describe("sendEmail: the footer and the RFC 8058 headers (spec §4.3, plan G7)", () => {
  it("a customer kind carries the two headers exactly, and ONE token in both links that opens to this account, channel, LEDGER address, contact and kind (RFC 8058, X2; mutation: put the page URL in List-Unsubscribe → FAILS; mutation: seal the raw `to` → t mismatches, FAILS)", async () => {
    await sendEmail(base(), { db: CLIENT, env: ENV });
    const out = sent();
    expect(Object.keys(out.headers!).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
    expect(out.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const oneClick = /^<https:\/\/app\.example\.com\/api\/unsubscribe\/([A-Za-z0-9_.-]+)>$/.exec(out.headers!["List-Unsubscribe"]!);
    expect(oneClick).not.toBeNull();
    const token = oneClick![1]!;
    expect(out.body).toBe(`See you at 3\n\nDon't want these emails? Unsubscribe: https://app.example.com/u/${token}`);
    expect(out.html).toContain(`href="https://app.example.com/u/${token}"`);
    expect(openConsentToken(token, [SECRET])).toEqual({
      v: 1, a: ACCOUNT, c: "email", t: "ana.lopez@example.com", i: DAY.getTime(), n: CONTACT, k: "automation.reminder",
    });
  });

  it("the footer row replaces the marker, under the message, and says the spec's words (mutation: append the row after </html> → FAILS)", async () => {
    await sendEmail(base(), { db: CLIENT, env: ENV });
    const html = sent().html!;
    expect(html).not.toContain(UNSUBSCRIBE_MARKER);
    expect(html).toMatch(/<tr><td style="[^"]*">Don&#39;t want these emails\? <a href="[^"]+"[^>]*>Unsubscribe<\/a>\.<\/td><\/tr>|<tr><td style="[^"]*">Don't want these emails\? <a href="[^"]+"[^>]*>Unsubscribe<\/a>\.<\/td><\/tr>/);
    expect(html.indexOf("Unsubscribe</a>")).toBeGreaterThan(html.indexOf("See you at 3"));
    expect(html.indexOf("Unsubscribe</a>")).toBeLessThan(html.indexOf("</body>"));
  });

  it("in Spanish when the email is Spanish (mutation: always English → FAILS)", async () => {
    await sendEmail(base({ kind: "booking.confirmation", language: "es" }), { env: ENV });
    expect(sent().body).toMatch(/\n\n¿No quiere recibir estos correos\? Cancelar suscripción: https:\/\/app\.example\.com\/u\//);
    expect(sent().html).toContain(">Cancelar suscripción</a>");
  });

  it("operator mail and staff-typed mail carry no link and no headers, and the marker is removed ((decision Q4), choice 23; mutation: give staff kinds the footer → FAILS)", async () => {
    for (const kind of ["operator.booking_alert", "staff.composer_email"] as const) {
      send.mockClear();
      await sendEmail(base({ kind }), { env: ENV });
      expect(sent().headers).toBeUndefined();
      expect(sent().body).toBe("See you at 3");
      expect(sent().html).not.toContain(UNSUBSCRIBE_MARKER);
      expect(sent().html).not.toContain("/u/");
    }
  });

  it("the provider gets the send fields ONLY — never the gate's own (mutation: spread the whole request → accountId reaches Resend, FAILS)", async () => {
    await sendEmail(base({ replyTo: "office@rio.example", fromAddress: "hello@rio.example" }), { db: CLIENT, env: ENV });
    expect(Object.keys(sent()).sort()).toEqual(["body", "fromAddress", "fromName", "headers", "html", "replyTo", "subject", "tags", "to"]);
    expect(sent().to).toBe("  Ana.Lopez@Example.com ");
  });

  it("the request's origin is used when APP_ORIGIN is unset, with trailing slashes dropped; APP_ORIGIN wins when set (origin.ts's rule; mutation: prefer the request's origin → FAILS)", async () => {
    await sendEmail(base({ origin: "https://rio.example.com//" }), { db: CLIENT, env: { CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv });
    expect(sent().headers!["List-Unsubscribe"]).toMatch(/^<https:\/\/rio\.example\.com\/api\/unsubscribe\//);
    send.mockClear();
    await sendEmail(base({ origin: "https://rio.example.com" }), { db: CLIENT, env: ENV });
    expect(sent().headers!["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\//);
  });

  it("a contact id that is not a uuid is left out of the token rather than minting one the opener refuses (mutation: pass it through → openConsentToken answers null, FAILS)", async () => {
    await sendEmail(base({ contactId: "ct_1" }), { db: CLIENT, env: ENV });
    const token = /\/api\/unsubscribe\/([^>]+)>/.exec(sent().headers!["List-Unsubscribe"]!)![1]!;
    expect(openConsentToken(token, [SECRET])?.n).toBeNull();
  });

  it("a customer email whose html has no marker is a programming error (plan G7; mutation: skip the check → sent without a footer, FAILS)", async () => {
    await expect(sendEmail(base({ html: "<p>hand-made</p>" }), { db: CLIENT, env: ENV })).rejects.toThrow(/has no unsubscribe marker/);
  });

  it("a text-only customer email gets the footer line and the headers (mutation: require html → FAILS)", async () => {
    await sendEmail(base({ html: undefined }), { db: CLIENT, env: ENV });
    expect(sent().html).toBeUndefined();
    expect(sent().body).toMatch(/Unsubscribe: https:\/\/app\.example\.com\/u\//);
    expect(sent().headers).toBeDefined();
  });
});

describe("sendEmail: Resend tags (D-016 item 1 — so the webhook can attribute a bounce/complaint)", () => {
  it("carries the account id and the contact id when it is a uuid (mutation: drop the tags → FAILS)", async () => {
    await sendEmail(base(), { db: CLIENT, env: ENV });
    expect(sent().tags).toEqual([{ name: "account_id", value: ACCOUNT }, { name: "contact_id", value: CONTACT }]);
  });

  it("carries only the account id when the contact id is not a uuid, or is absent (mutation: pass the raw contactId through → a non-uuid tag value, FAILS)", async () => {
    await sendEmail(base({ contactId: "ct_1" }), { db: CLIENT, env: ENV });
    expect(sent().tags).toEqual([{ name: "account_id", value: ACCOUNT }]);
    send.mockClear();
    await sendEmail(base({ contactId: null }), { db: CLIENT, env: ENV });
    expect(sent().tags).toEqual([{ name: "account_id", value: ACCOUNT }]);
  });

  it("carries no tags at all for operator mail with no account — the agency roll-up (mutation: always send the account_id tag → FAILS)", async () => {
    await sendEmail(base({ kind: "operator.agency_report", accountId: null, contactId: null }), { env: ENV });
    expect(sent().tags).toBeUndefined();
    expect("tags" in sent()).toBe(false);
  });
});

describe("sendEmail: the postal address on the three follow-ups whose templates print none (decision P1, G18; spec §10)", () => {
  it.each(["automation.review_request", "automation.quote_followup", "automation.no_show_nudge"] as const)(
    "%s carries the account's mailing_address under the unsubscribe line, one line per stored line, in the html and the text part (mutation: drop the address step → FAILS)", async (kind) => {
      db.getMailingAddress.mockResolvedValue("  120 S Main St\r\nMcAllen, TX 78501 \n\n");
      expect((await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).kind).toBe("sent");
      expect(db.getMailingAddress).toHaveBeenCalledWith(CLIENT, ACCOUNT);
      expect(sent().html).toContain("120 S Main St<br>McAllen, TX 78501");
      expect(sent().html!.indexOf("120 S Main St")).toBeGreaterThan(sent().html!.indexOf("Unsubscribe</a>"));
      expect(sent().body).toMatch(/Unsubscribe: https:\/\/app\.example\.com\/u\/\S+\n\n120 S Main St\nMcAllen, TX 78501$/);
    });

  it("a stored address carrying `$` patterns is printed literally, never read as a replace() pattern (mutation: replace the marker with the row string instead of a function → FAILS)", async () => {
    db.getMailingAddress.mockResolvedValue("Unit $$ 5, $& $` 9\nMcAllen, TX 78501");
    expect((await sendEmail(base({ kind: "automation.review_request" }), { db: CLIENT, env: ENV })).kind).toBe("sent");
    expect(sent().html).toContain("Unit $$ 5, $&amp; $` 9<br>McAllen, TX 78501");
    expect(sent().html).not.toContain("Unit $ 5");
  });

  it("a blank or unset address never blocks them: sent, with no address lines (P1: unlike the check-in and the referral ask; mutation: block when blank → FAILS)", async () => {
    for (const blank of [null, "  \n "]) {
      send.mockClear();
      db.getMailingAddress.mockResolvedValueOnce(blank);
      expect((await sendEmail(base({ kind: "automation.review_request" }), { db: CLIENT, env: ENV })).kind).toBe("sent");
      expect(sent().body).toMatch(/Unsubscribe: https:\/\/app\.example\.com\/u\/\S+$/);
    }
  });

  it("the check-in, the referral ask and every other kind never read it (their templates print their own, or they carry none; mutation: read it for every marketing kind → FAILS)", async () => {
    for (const kind of ["automation.reactivation", "automation.referral_ask", "automation.reminder", "booking.confirmation", "operator.lead_alert"] as const) {
      await sendEmail(base({ kind }), { db: CLIENT, env: ENV });
    }
    expect(db.getMailingAddress).not.toHaveBeenCalled();
  });

  it("an unreadable address is a re-hold, never a send without it (fails closed; mutation: treat a read error as blank → sent, FAILS)", async () => {
    db.getMailingAddress.mockRejectedValueOnce(new Error("getMailingAddress failed: timeout"));
    expect(await sendEmail(base({ kind: "automation.quote_followup" }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/automation\.quote_followup .*blocked, mailing address unreadable/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendEmail: with no secret or no origin (plan G8)", () => {
  it("in PRODUCTION a customer kind is blocked unsubscribe_unavailable and never sent; operator mail still goes (mutation: send without the link in production → FAILS)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = { VERCEL_ENV: "production", APP_ORIGIN: "https://app.example.com" } as unknown as NodeJS.ProcessEnv;
    expect(await sendEmail(base(), { db: CLIENT, env: prod })).toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(await sendEmail(base(), { db: CLIENT, env: { VERCEL_ENV: "production", CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv }))
      .toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect((await sendEmail(base({ kind: "operator.lead_alert" }), { env: prod })).kind).toBe("sent");
  });

  it("in PRODUCTION an origin that is not https, or a secret under 32 characters, blocks a customer kind; 32 characters and https send (RFC 8058's one HTTPS URI; reviews R1-M3, R1-M4, R2-m7; mutation: drop the https check → an http List-Unsubscribe goes out, FAILS; mutation: `< 32` → `< 31` → the 31-character secret seals, FAILS)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const env = (o: Record<string, string>) => ({ VERCEL_ENV: "production", ...o }) as unknown as NodeJS.ProcessEnv;
    const S32 = "s".repeat(32);
    expect(await sendEmail(base(), { db: CLIENT, env: env({ APP_ORIGIN: "http://app.example.com", CONSENT_TOKEN_SECRET: S32 }) }))
      .toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(await sendEmail(base({ origin: "http://rio.example.com" }), { db: CLIENT, env: env({ CONSENT_TOKEN_SECRET: S32 }) }))
      .toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(await sendEmail(base(), { db: CLIENT, env: env({ APP_ORIGIN: "https://app.example.com", CONSENT_TOKEN_SECRET: "s".repeat(31) }) }))
      .toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect((await sendEmail(base(), { db: CLIENT, env: env({ APP_ORIGIN: "https://app.example.com", CONSENT_TOKEN_SECRET: S32 }) })).kind).toBe("sent");
    expect(sent().headers!["List-Unsubscribe"]).toMatch(/^<https:\/\//);
  });

  it("OUTSIDE production an http origin still carries the link (local dev; mutation: apply the https rule everywhere → FAILS)", async () => {
    await sendEmail(base(), { db: CLIENT, env: { APP_ORIGIN: "http://localhost:3000", CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv });
    expect(sent().headers!["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3000\/api\/unsubscribe\//);
  });

  it("OUTSIDE production a customer kind goes without the link or headers (nothing real is delivered there; mutation: block outside production too → FAILS)", async () => {
    expect((await sendEmail(base(), { db: CLIENT, env: {} as NodeJS.ProcessEnv })).kind).toBe("sent");
    expect(sent().headers).toBeUndefined();
    expect(sent().body).toBe("See you at 3");
    expect(sent().html).not.toContain(UNSUBSCRIBE_MARKER);
  });
});

describe("sendEmail: the provider", () => {
  it("a provider that throws is failed/provider with its own words; a factory that throws is failed/provider_unavailable (mutation: rethrow → rejects, FAILS)", async () => {
    send.mockRejectedValueOnce(new Error("The rio.example domain is not verified."));
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({ kind: "failed", stage: "provider", error: "The rio.example domain is not verified." });
    factory.getEmailProvider.mockImplementationOnce(() => { throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production"); });
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({
      kind: "failed", stage: "provider_unavailable", error: "RESEND_API_KEY and EMAIL_FROM are required in production",
    });
  });
});

describe("sendEmailOrThrow, emailSenderFor, operatorMailer", () => {
  it("sendEmailOrThrow answers the id, or throws EmailNotSent carrying the result, with the provider's own words as its message (G11; mutation: wrap the message → the sending-address check loses Resend's wording, FAILS)", async () => {
    expect(await sendEmailOrThrow(base(), { db: CLIENT, env: ENV })).toEqual({ providerMessageId: "re_1" });
    send.mockRejectedValueOnce(new Error("The rio.example domain is not verified."));
    const e = await sendEmailOrThrow(base(), { db: CLIENT, env: ENV }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EmailNotSent);
    expect((e as Error).message).toBe("The rio.example domain is not verified.");
    db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "staff", eventId: "e1" });
    const b = await sendEmailOrThrow(base(), { db: CLIENT, env: ENV }).catch((x: unknown) => x);
    expect((b as EmailNotSent).result).toEqual({ kind: "blocked", reason: "stopped" });
  });

  it("emailSenderFor builds the provider EAGERLY (a production tick with Resend unset fails before any query) and sends with its client (mutation: build lazily → no throw at construction, FAILS)", async () => {
    factory.getEmailProvider.mockImplementationOnce(() => { throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production"); });
    expect(() => emailSenderFor(CLIENT, ENV)).toThrow(/required in production/);
    const sender = emailSenderFor(CLIENT, ENV);
    expect(sender.isFake).toBe(true);
    await sender.send(base());
    expect(db.readConsentState).toHaveBeenCalledWith(CLIENT, ACCOUNT, "email", "ana.lopez@example.com");
  });

  it("operatorMailer is provider-shaped, bound to ONE operator kind: no ledger, no footer, the provider's words on failure (G11; mutation: bind a customer kind's rules → a footer appears, FAILS)", async () => {
    const mailer = operatorMailer("operator.sender_check", ACCOUNT, ENV);
    expect(mailer.isFake).toBe(true);
    await mailer.send({ to: "admin@rio.example", fromName: "BIS Platform", fromAddress: "hello@rio.example", subject: "Sending address check", body: "ok" });
    expect(sent().headers).toBeUndefined();
    expect(db.readConsentState).not.toHaveBeenCalled();
    send.mockRejectedValueOnce(new Error("The rio.example domain is not verified."));
    await expect(mailer.send({ to: "admin@rio.example", fromName: "BIS Platform", subject: "x", body: "y" }))
      .rejects.toThrow("The rio.example domain is not verified.");
  });

  it("every registry kind is handled by the footer step one way or the other (a guard for a new kind; mutation: a new footer value → the switch falls through, FAILS)", async () => {
    for (const kind of Object.keys(EMAIL_KINDS) as EmailKind[]) {
      send.mockClear();
      const r = await sendEmail(base({ kind, accountId: kind.startsWith("operator.") ? null : ACCOUNT, now: DAY }), { db: CLIENT, env: ENV });
      expect(r.kind, kind).toBe("sent");
      expect(Boolean(sent().headers), kind).toBe(EMAIL_KINDS[kind].footer === "unsubscribe");
    }
  });
});

describe("the two operator paths that take a provider are handed operatorMailer (G11)", () => {
  const read = (p: string) => readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), p), "utf8");
  it("the sending-address check sends as operator.sender_check (mutation: getEmailProvider() back → FAILS)", () => {
    expect(read("app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts"))
      .toMatch(/saveVerifiedFromAddress\(\s*operatorMailer\("operator\.sender_check", accountId\)/);
  });
  it("the billing link sends as operator.billing_link (mutation: getEmailProvider() back → FAILS)", () => {
    expect(read("app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts"))
      .toMatch(/email: operatorMailer\("operator\.billing_link", accountId\)/);
  });
});
