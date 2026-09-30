import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import { composerBlockedLine, composerStateLine, composerEmailNotice } from "./composer-state";

/**
 * The text composer's one line (consent chain spec §6). The render-time line
 * and the after-attempt line come from this one module, so the two can never
 * say different things.
 */
describe("composerStateLine", () => {
  it("ok is null: the form shows", () => {
    expect(composerStateLine({ kind: "ok" }, "America/Chicago")).toBeNull();
  });

  it("stopped: the spec's sentence with the stop's calendar day IN THE ZONE (mutation: format in UTC → 'Oct 4', FAILS)", () => {
    const line = composerStateLine({ kind: "stopped", since: "2026-10-04T02:30:00.000Z" }, "America/Chicago");
    expect(line).toMatch(/^They stopped texts on Oct 3, 2026\. You can't text this number until they text START\.$/);
  });

  it("stopped with a date that will not format: the undated line, never a throw inside a render", () => {
    expect(composerStateLine({ kind: "stopped", since: "not a date" }, "America/Chicago")).toBe(m["compose.smsStoppedUndated"]);
  });

  it("held, unconfirmed and unknown each say their own line (mutation: swap held and unconfirmed → FAILS)", () => {
    expect(composerStateLine({ kind: "held", since: "2026-10-03T00:00:00Z" }, "UTC")).toBe(m["compose.smsHeld"]);
    expect(composerStateLine({ kind: "unconfirmed_number" }, "UTC")).toBe(m["compose.smsCheckNumber"]);
    expect(composerStateLine({ kind: "unknown" }, "UTC")).toBe(m["compose.smsStateUnknown"]);
  });
});

describe("composerBlockedLine — what the action says after a refused attempt", () => {
  it("says the same thing the render would, undated (the action has no date to hand)", () => {
    expect(composerBlockedLine("stopped")).toBe(m["compose.smsStoppedUndated"]);
    expect(composerBlockedLine("held")).toBe(m["compose.smsHeld"]);
    expect(composerBlockedLine("unconfirmed_number")).toBe(m["compose.smsCheckNumber"]);
  });

  it("the spec's §6 example sentence, verbatim, is the dated line's shape", () => {
    expect(m["compose.smsStopped"]).toBe("They stopped texts on {date}. You can't text this number until they text START.");
  });
});

describe("composerBlockedLine: the stop confirmation's own refusal", () => {
  it("a staff text never meets stop_confirmation_stale, but if it did it would read as a plain failure, never a stop (mutation: map it to the stopped line → FAILS)", () => {
    expect(composerBlockedLine("stop_confirmation_stale")).toBe(m["compose.smsFailed"]);
  });
});

describe("composerEmailNotice — the email composer's one line (spec §6, choice 22, G15)", () => {
  it("no line when they can get email (mutation: always a line → FAILS)", () => {
    expect(composerEmailNotice({ kind: "ok" }, "America/Chicago")).toBeNull();
  });

  it("the customer's own stop: the spec's words with the date in the ACCOUNT's zone (mutation: format in UTC → Oct 4, FAILS)", () => {
    expect(composerEmailNotice({ kind: "stopped", since: "2026-10-04T02:30:00Z", byCustomer: true }, "America/Chicago"))
      .toBe(m["compose.emailUnsubscribed"].replace("{date}", formatDateInZone("2026-10-04T02:30:00Z", "America/Chicago")));
    expect(formatDateInZone("2026-10-04T02:30:00Z", "America/Chicago")).toMatch(/Oct 3/);
  });

  it("a staff or folded stop says 'You stopped', never 'They unsubscribed' (G15; mutation: one line for both → FAILS)", () => {
    expect(composerEmailNotice({ kind: "stopped", since: "2026-10-01T15:00:00Z", byCustomer: false }, "America/Chicago"))
      .toMatch(/^You stopped emails to them on /);
  });

  it("an unreadable state says so, and a date that will not format drops the date rather than throwing in a render (mutation: return null for unknown → the operator is told nothing, FAILS)", () => {
    expect(composerEmailNotice({ kind: "unknown" }, "America/Chicago")).toBe(m["compose.emailStateUnknown"]);
    expect(composerEmailNotice({ kind: "stopped", since: "garbage", byCustomer: true }, "America/Chicago"))
      .toBe("They unsubscribed from your emails. Write only about something they asked you for.");
  });
});
