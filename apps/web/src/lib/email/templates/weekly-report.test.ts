import { describe, expect, it } from "vitest";
import { emailBrandNamed } from "./shell";
import { deltaPhrase, weeklyReportEmail, weeklyReportSubject } from "./weekly-report";
import type { Branding } from "@bis/db";

const branding: Branding = {
  brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#6D28D9",
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrandNamed(branding, "Rio Roofing");

const week = { calls: 12, leads: 4, bookings: 2, visitors: 86 };
const quiet = { calls: 0, leads: 0, bookings: 0, visitors: null };
const nothingOn = { receptionist: false, textBack: false };

describe("deltaPhrase", () => {
  it("says more, fewer or same IN WORDS — never an arrow", () => {
    expect(deltaPhrase(12, 9)).toBe("3 more than the week before");
    expect(deltaPhrase(2, 3)).toBe("1 fewer than the week before");
    expect(deltaPhrase(4, 4)).toBe("same as the week before");
  });

  /**
   * An account eight days old has no honest "week before", and a delta
   * measured against a window that predates it would be fabricated. Empty is
   * the answer; the number ships alone.
   */
  it("is EMPTY when there is no prior week", () => {
    expect(deltaPhrase(12, null)).toBe("");
  });
});

describe("weeklyReportEmail", () => {
  it("omits the website line ENTIRELY when visitors were not measured", () => {
    const { html, text } = weeklyReportEmail({
      brand, now: { ...week, visitors: null }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    });
    // A zero we did not measure must not look like a zero we did.
    expect(html).not.toMatch(/visitors/i);
    expect(text).not.toMatch(/visitors/i);
  });

  it("includes the website line when there IS a site", () => {
    const { text } = weeklyReportEmail({
      brand, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toMatch(/86/);
    expect(text).toMatch(/visitors/i);
  });

  it("renders a quiet week as its own message, not four zero rows", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: true },
    });
    expect(text).toContain("Nothing came in last week");
    expect(text).not.toMatch(/0 calls answered/);
  });

  // D-064 (review round 2): a metric we DID measure (real website traffic)
  // must never be swallowed by the quiet-week copy just because the
  // pipeline metrics (calls/leads/bookings) all read zero — but the fix is
  // NOT to abandon the quiet-week body for the four-zero-row table (the
  // first pass's mistake): DESIGN.md's own rule is that a quiet week gets
  // its OWN body, not four zero rows, and that still holds when the
  // pipeline itself is quiet — only the WEBSITE wasn't. The quiet body
  // keeps "Nothing came in" (true: no calls, no leads, no bookings) and
  // its reassurance, and gains one more true sentence about the website.
  // EXACT lines pinned, not a loose match, because the earlier version of
  // this test (`.not.toContain`) could not have caught the wrong fix
  // either — it only proved the quiet body was gone, not what replaced it.
  it("a week with no calls, leads or bookings but real website visitors keeps the quiet-week body AND adds a visitors sentence (mutation: drop the visitors line, or switch to the four-zero-row table → FAILS)", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 50 }, prior: null,
      dashboardUrl: null, reassurance: { receptionist: true, textBack: true },
    });
    expect(text).toBe(
      "Nothing came in last week — no calls, no leads, no bookings.\n\n"
      + "Your website had 50 visitors last week.\n\n"
      + "Sofía is still answering, and your missed-call text-back is still on.",
    );
    expect(text).not.toMatch(/0 calls answered/);
  });

  it("singular: 1 visitor, not 1 visitors", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 1 }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toContain("Your website had 1 visitor last week.");
    expect(text).not.toContain("1 visitors");
  });

  it("a week with zero visitors (measured, genuinely none) and nothing else is still the quiet-week message", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 0 }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toContain("Nothing came in last week");
  });

  it("claims the receptionist only when the account actually has one", () => {
    const off = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    expect(off.text).not.toMatch(/still answering/i);

    const on = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: false },
    });
    expect(on.text).toMatch(/still answering/i);
  });

  // D-063: the quiet-week reassurance names whichever persona THIS account
  // configured, not a hard-coded "Sofía" — some clients rename their
  // receptionist on the voice profile (persona_name).
  it("names the account's OWN configured receptionist persona, not a hard-coded 'Sofía'", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: false, receptionistName: "Max" },
    });
    expect(text).toMatch(/Max is still answering/);
    expect(text).not.toMatch(/Sofía/);
  });

  it("falls back to 'Sofía' when no persona name is given (e.g. a null voice profile)", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: false },
    });
    expect(text).toMatch(/Sofía is still answering/);
  });

  it("carries both an html and a text part — never html alone", () => {
    const out = weeklyReportEmail({
      brand, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    // The text alternative is what keeps a branded message out of the spam
    // bucket; SendEmailInput.html's own comment says never send it without body.
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.html).toContain("<");
    expect(out.text).not.toContain("<td");
  });

  it("escapes the brand name — it reaches an inbox", () => {
    const hostile = emailBrandNamed(branding, 'Rio "Best" <Roofing>');
    const { html } = weeklyReportEmail({
      brand: hostile, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    expect(html).not.toContain("<Roofing>");
  });

  it("renders the deltas when a prior week exists", () => {
    const { text } = weeklyReportEmail({
      brand, now: week, prior: { calls: 9, leads: 4, bookings: 3, visitors: 74 },
      dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toContain("3 more than the week before");
    expect(text).toContain("same as the week before");
    expect(text).toContain("1 fewer than the week before");
  });
});

describe("weeklyReportSubject (D-064, review round 2)", () => {
  it("says quiet when the pipeline AND the website (if measured) are both empty", () => {
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 0 })).toBe("Last week was quiet");
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: null })).toBe("Last week was quiet");
  });

  // The pipeline is still quiet (no calls, no leads, no bookings) — the
  // subject leads with the one true number that week actually had,
  // instead of claiming "quiet" over a week that had real visitors, or
  // falling back to "0 calls, 0 new leads" (review round 1's mistake).
  it("leads with the visitors count when the pipeline is quiet but the website had real visitors (mutation: fall back to the quiet or the 0-calls subject → FAILS)", () => {
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 50 }))
      .toBe("Last week: 50 website visitors");
  });

  it("leads with calls/leads, unaffected, when the pipeline itself is not quiet", () => {
    expect(weeklyReportSubject({ calls: 12, leads: 4, bookings: 2, visitors: 86 }))
      .toBe("Last week: 12 calls, 4 new leads");
  });
});
