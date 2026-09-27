import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { composerBlockedLine, composerStateLine } from "./composer-state";

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
