import { describe, it, expect } from "vitest";
import { loggableError } from "./loggable-error";

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

  it("keeps the class, Stripe code and status prefix untouched", () => {
    const e = Object.assign(new Error("No such phone +15551234567"), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 });
    expect(loggableError(e)).toBe("StripeInvalidRequestError code=resource_missing status=404: No such phone [phone]");
  });
});
