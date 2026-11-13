import { describe, it, expect } from "vitest";
import { loggableError, loggablePhone } from "./loggable-error";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The message part of a line, after the "<kind>: " prefix. */
const msg = (text: string): string => loggableError(new Error(text)).slice("Error: ".length);

describe("loggableError: phone numbers", () => {
  // Telnyx and the SMS send path quote the customer's number in their errors
  // ("Invalid 'to' number: +15551234567"); a log is no place for it.
  it("redacts an E.164 number (mutation: drop the phone replace → FAILS)", () => {
    expect(msg("Invalid 'to' number: +15551234567 (code 40310)")).toBe("Invalid 'to' number: [phone] (code 40310)");
  });

  it("redacts an E.164 number in JSON and in a URL-encoded query", () => {
    expect(msg('{"to":"+525512345678","errors":[]}')).toBe('{"to":"[phone]","errors":[]}');
    expect(msg("POST /v2/messages?to=%2B15551234567 failed")).toBe("POST /v2/messages?to=[phone] failed");
  });

  it("redacts the common US shapes: (555) 123-4567, 555-123-4567, 555.123.4567, 555 123 4567, +1 (555) 123-4567, 1-555-123-4567", () => {
    expect(msg("from (555) 123-4567 to 555-123-4567")).toBe("from [phone] to [phone]");
    expect(msg("number 555.123.4567 rejected")).toBe("number [phone] rejected");
    expect(msg("number 555 123 4567 rejected")).toBe("number [phone] rejected");
    expect(msg("call +1 (555) 123-4567 failed")).toBe("call [phone] failed");
    expect(msg("call 1-555-123-4567 failed")).toBe("call [phone] failed");
    expect(msg("could not reach 555-123-4567.")).toBe("could not reach [phone].");
  });

  it("redacts the email first, then the phone, before the 300-character cut", () => {
    expect(msg("sms to 15551234567@txt.example or +15551234567")).toBe("sms to [email] or [phone]");
    const long = loggableError(new Error(`${"x".repeat(290)} +15551234567`));
    expect(long).toBe(`Error: ${"x".repeat(290)} [phone]`);
  });

  it("leaves the numbers a log line needs: a status, a uuid, an ISO timestamp, a 6-digit code, an epoch, a carrier code, an IP", () => {
    const keep = [
      "Request failed with status 404",
      "account 3f2a1b4c-1234-4abc-8def-123456789012 not found",
      "account 12345678-1234-1234-1234-123456789012 not found",
      "at 2026-11-07T10:15:30.123+00:00 retrying",
      "verification code 123456 expired",
      "epoch 1730000000 and 1730000000123 ms",
      "Telnyx error 40310 on attempt 3 of 5",
      "connect ECONNREFUSED 10.0.0.12:5432",
      "dates 11-07-2026 and 11.07.2026",
      "rate 1,234,567 per day",
    ];
    for (const line of keep) expect(msg(line)).toBe(line);
  });

  it("packages/db's contact-import copy of PHONE_LIKE stays byte-identical to this one", () => {
    // packages/db cannot import from apps/web, so contact-import.ts keeps a copy.
    const block = (path: string) => {
      const src = readFileSync(resolve(__dirname, path), "utf8").replace(/\r\n/g, "\n");
      const m = src.match(/const PHONE_LIKE = new RegExp\([\s\S]*?\n\);/);
      expect(m, `${path} has no PHONE_LIKE block`).not.toBeNull();
      return m![0];
    };
    expect(block("../../../../packages/db/src/contact-import.ts")).toBe(block("./loggable-error.ts"));
    expect(readFileSync(resolve(__dirname, "../../../../packages/db/src/contact-import.ts"), "utf8"))
      .toMatch(/\.replace\(PHONE_LIKE, "\[phone\]"\)/);
  });

  it("every SMS-sending path logs its errors through loggableError, never raw (mutation: put String(e) back in one console.error → FAILS)", () => {
    // A Telnyx failure's message quotes the customer's number; these are the
    // paths it reaches. A raw String(e) or e.message in their console.error
    // lines would print that number.
    const sendPaths = [
      "./automations/passes/sms-reminder.ts",
      "./automations/passes/appointment-confirm.ts",
      "./automations/passes/no-show-nudge.ts",
      "./automations/passes/quote-followup.ts",
      "./automations/passes/referral-ask.ts",
      "./automations/passes/review-request.ts",
      "./automations/instant-reply.ts",
      "./voice/textback.ts",
    ];
    for (const path of sendPaths) {
      const src = readFileSync(resolve(__dirname, path), "utf8");
      const errorLines = src.split(/\r?\n/).filter((l) => l.includes("console.error("));
      expect(errorLines.length, `${path} has no console.error lines`).toBeGreaterThan(0);
      for (const line of errorLines) {
        expect(line, `${path}: ${line.trim()}`).not.toMatch(/\$\{String\(e\)\}|\$\{\(?e as Error\)?\.message\}|\$\{e\.message\}|\$\{error\}/);
      }
      expect(src, `${path} never calls loggableError`).toMatch(/loggableError\(e\)/);
    }
  });

  it("keeps the class, Stripe code and status prefix untouched", () => {
    const e = Object.assign(new Error("No such phone +15551234567"), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 });
    expect(loggableError(e)).toBe("StripeInvalidRequestError code=resource_missing status=404: No such phone [phone]");
  });
});

describe("loggablePhone: a number as a log line may carry it", () => {
  it("keeps +1 and the last two digits of a US number, one dot per hidden digit", () => {
    expect(loggablePhone("+19565550999")).toBe("+1••••••••99");
  });

  it("hides every digit but the last two of a number outside +1, since its country code's length is not known here", () => {
    expect(loggablePhone("+525512345678")).toBe("+••••••••••78");
  });

  it("says unknown for no number at all", () => {
    expect(loggablePhone(null)).toBe("unknown");
    expect(loggablePhone(undefined)).toBe("unknown");
    expect(loggablePhone("")).toBe("unknown");
  });

  it("never echoes a value that is not a plain number (a SIP URI, a forged log line, a short code)", () => {
    expect(loggablePhone("sip:+19565550999@sip.example")).toBe("[phone]");
    expect(loggablePhone("+1956\nfake line")).toBe("[phone]");
    expect(loggablePhone("911")).toBe("[phone]");
  });

  it("never leaves more than the last two digits of any accepted number in the result", () => {
    for (const n of ["+19565550999", "19565550999", "+447911123456", "+12345678"]) {
      const shown = loggablePhone(n).replace(/\D/g, "");
      expect(shown.length).toBeLessThanOrEqual(n.startsWith("+1") ? 3 : 2);
      expect(n.endsWith(shown.slice(-2))).toBe(true);
    }
  });
});
