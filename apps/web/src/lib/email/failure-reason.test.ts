import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { messageFailureReason, COMPLAINT_ERROR_MARKER } from "./failure-reason";

/**
 * D-017 (what gets shown) and D-016 (what the webhook records to be shown).
 *
 * `messages.error` holds TWO very different kinds of text depending on how
 * the row got there: the resend webhook's own, deliberately curated
 * COMPLAINT_ERROR_MARKER for a spam complaint (the only marker this fix
 * writes — see route.ts), or raw, uncontrolled text from every other
 * failure path (a provider's own error string, this app's own
 * `EmailNotSent` message, a Telnyx failure). This function must render a
 * plain-language reason for the first and NEVER echo the second verbatim —
 * DESIGN.md's "no provider jargon/codes in client-facing copy" — falling
 * back to one generic, status-keyed line instead.
 */
describe("messageFailureReason", () => {
  it("returns null for a message that never failed or bounced", () => {
    expect(messageFailureReason({ status: "sent", error: null })).toBeNull();
    expect(messageFailureReason({ status: "delivered", error: null })).toBeNull();
  });

  it("recognises the complaint marker and says so in plain language, never the marker itself (mutation: drop the marker check → FAILS)", () => {
    const reason = messageFailureReason({ status: "bounced", error: COMPLAINT_ERROR_MARKER });
    expect(reason).toBe(m["conversations.failureReason.complained"]);
    expect(reason).not.toContain(COMPLAINT_ERROR_MARKER);
  });

  it("a plain bounce with no marker gets the generic bounce line, not the complaint one", () => {
    expect(messageFailureReason({ status: "bounced", error: null }))
      .toBe(m["conversations.failureReason.bounced"]);
  });

  it("NEVER echoes a raw provider string, whatever status it is attached to — falls back to the generic line for that status", () => {
    const raw = "550 5.1.1 The email account that you tried to reach does not exist (Google)";
    expect(messageFailureReason({ status: "failed", error: raw }))
      .toBe(m["conversations.failureReason.failed"]);
    expect(messageFailureReason({ status: "bounced", error: raw }))
      .toBe(m["conversations.failureReason.bounced"]);
  });

  // The marker check is an EXACT match, not a substring test — a raw
  // provider string that merely happens to CONTAIN the word "complained"
  // (one did complain about something unrelated to spam, say) must not be
  // mistaken for the webhook's own curated marker (mutation: match with
  // `.includes(COMPLAINT_ERROR_MARKER)` instead of `===` → FAILS).
  it("a provider string merely CONTAINING the word \"complained\" is not the marker, and gets the generic bounce line", () => {
    const raw = "the customer complained to support about an unrelated billing issue";
    expect(raw.includes(COMPLAINT_ERROR_MARKER)).toBe(true); // the trap this guards
    expect(messageFailureReason({ status: "bounced", error: raw }))
      .toBe(m["conversations.failureReason.bounced"]);
  });

  // D-016 review item 4: a staff-typed email the gate blocked `suppressed`
  // (an address a PRIOR bounce or complaint already suppressed) throws
  // EmailNotSent with the exact message `email not sent: suppressed`
  // (email-gate.ts's own format), which the staff composer's catch writes
  // verbatim into `messages.error`. That is tellable apart from a generic
  // failure, same spirit as the complaint marker above.
  it("a staff send blocked `suppressed` by the gate gets its own line, never the generic 'didn't go through' (mutation: drop the suppressed check → FAILS)", () => {
    expect(messageFailureReason({ status: "failed", error: "email not sent: suppressed" }))
      .toBe(m["conversations.failureReason.suppressed"]);
  });

  // Same exact-match discipline as the complaint marker: a raw provider
  // string that merely contains the word "suppressed" must not be mistaken
  // for the gate's own block message (mutation: `.includes` instead of
  // `===` → FAILS).
  it("a provider string merely CONTAINING the word \"suppressed\" is not the gate's block message, and gets the generic failed line", () => {
    const raw = "delivery suppressed by an upstream spam filter, unrelated to our own ledger";
    expect(raw.includes("suppressed")).toBe(true); // the trap this guards
    expect(messageFailureReason({ status: "failed", error: raw }))
      .toBe(m["conversations.failureReason.failed"]);
  });

  // D-061 review follow-up: a row written before the action-level pre-check
  // existed (conversations/actions.ts now refuses before writing one at
  // all) still has to render plainly, not the raw gate string, and never
  // confused with the DIFFERENT, address-level `suppressed` block above
  // (mutation: match `.includes("suppressed")` instead of the exact
  // account-level string → FAILS, since that would also catch the plain
  // "suppressed" block tested above).
  it("a staff send blocked `suppressed_account` by the gate reads the same 'isn't sending yet' line the Activity page uses, never the raw reason or the address-level suppressed line", () => {
    expect(messageFailureReason({ status: "failed", error: "email not sent: suppressed_account" }))
      .toBe(m["automations.reason.accountSuppressed"]);
  });
});
