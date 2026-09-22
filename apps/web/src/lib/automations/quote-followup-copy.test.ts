import { describe, it, expect } from "vitest";
import { QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS } from "@bis/db";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { defaultQuoteFollowupBody, quoteFollowupSubject } from "./quote-followup-copy";

describe("the quote follow-up's copy", () => {
  it("names the brand and asks about the quote", () => {
    const body = defaultQuoteFollowupBody("Rio Roofing");
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("quote");
  });

  it("the subject names the brand, and names nothing at all when there is none", () => {
    expect(quoteFollowupSubject("Rio Roofing")).toBe("About your quote from Rio Roofing");
    // Mutation: delete the `if (!brandName.trim())` branch from
    // `quoteFollowupSubject` -> the second line reds with
    // "About your quote from    ". `brandDisplayName` returns "" for an
    // account that never set a brand name (`branding.ts:197-199`), so this is
    // reachable, not theoretical.
    expect(quoteFollowupSubject("   ")).toBe(m["automations.quoteFollowup.emailSubjectNoName"]);
    expect(quoteFollowupSubject("A $& B")).toContain("A $& B");
  });

  it("NEVER carries a price: no currency symbol and no digits at all", () => {
    // The price is left out for the same reason a quote is a document: a
    // number in a text invites a negotiation nobody prepared for. Mutation:
    // add "for $4,200" to `automations.quoteFollowup.defaultBody` -> this reds
    // BY NAME.
    for (const name of ["Rio Roofing", ""]) {
      expect(defaultQuoteFollowupBody(name)).not.toContain("$");
      expect(defaultQuoteFollowupBody(name)).not.toMatch(/[0-9]/);
    }
  });

  it("carries NO LINK: the quote is a document the operator already sent", () => {
    for (const name of ["Rio Roofing", ""]) {
      expect(defaultQuoteFollowupBody(name)).not.toContain("http");
      expect(defaultQuoteFollowupBody(name)).not.toContain("www.");
    }
  });

  it("drops the naming clause when there is no brand name", () => {
    // THE EXACT STRING, not `not.toContain("undefined")` plus a substring:
    // deleting the blank-name branch yields "Hi, it's    . Just checking...",
    // which satisfies a substring check and reds nothing. Mutation: delete
    // the `if (!brandName.trim())` branch -> this reds BY NAME.
    expect(defaultQuoteFollowupBody("   ")).toBe(m["automations.quoteFollowup.defaultBodyNoName"]);
    expect(defaultQuoteFollowupBody("")).toBe(m["automations.quoteFollowup.defaultBodyNoName"]);
  });

  it("survives a company name containing a String.replace special", () => {
    expect(defaultQuoteFollowupBody("A $& B")).toContain("A $& B");
  });

  it("carries no internal milestone code and no template syntax", () => {
    const body = defaultQuoteFollowupBody("Rio Roofing");
    expect(body).not.toMatch(/\bM[0-9][a-z]?\b/);
    expect(body).not.toContain("{{");
  });

  /**
   * THE DISCLOSED BODY, because that is the one the customer receives and the
   * client is billed for: `sendAutomationSms` appends `withOptOut`
   * unconditionally (send-sms.ts:82), 23 septets in English. Measuring the
   * composed body alone would claim one segment over a text that bills two.
   *
   * ENCODING AND SEGMENTS, never `chars`: a character count rots on the first
   * word anyone rewrites, while the encoding is what costs money. ONE
   * character outside GSM-7 (an em dash, a curly apostrophe) drops the WHOLE
   * body to UCS-2 at 70 characters a segment (segments.ts:15-19).
   *
   * THE BUDGET, computed for THIS template and not borrowed from a sibling:
   * the template is 105 septets with `{name}` removed, the disclosure 23, and
   * GSM-7's single-segment bound is 160 - so one segment holds a brand name
   * of 32 characters or fewer. Every name below is a real Valley shape.
   */
  it("bills ONE segment for an ordinary Valley company name, disclosure included", () => {
    // Mutation: put an em dash in `automations.quoteFollowup.defaultBody` (or
    // a curly apostrophe in "it's") -> encoding flips to ucs2 and this reds.
    const measure = (name: string) => {
      const { encoding, segments } = segmentsFor(withOptOut(defaultQuoteFollowupBody(name)));
      return { encoding, segments };
    };
    expect(measure("Rio Roofing")).toEqual({ encoding: "gsm7", segments: 1 });              // 139 septets
    expect(measure("Sunrise Plumbing")).toEqual({ encoding: "gsm7", segments: 1 });         // 144 septets
    // The two names at the top of the budget, so the 32 above is a measured
    // bound rather than a claim: 23 and 25 characters.
    expect(measure("Valley Air Conditioning")).toEqual({ encoding: "gsm7", segments: 1 });  // 151 septets
    expect(measure("Rio Grande Valley Roofing")).toEqual({ encoding: "gsm7", segments: 1 });// 153 septets
    // The blank-name variant, which drops the naming clause entirely.
    expect(measure("")).toEqual({ encoding: "gsm7", segments: 1 });                         // 117 septets
  });

  it("an accented company name is UCS-2 and three segments - unavoidable, and measured rather than wished away", () => {
    // Valley client names are heavily Hispanic and "García" is the common
    // case, not an edge case (review-request-copy.test.ts:42-48 says the same
    // for the same reason). The accented i is outside GSM7_BASE, so the WHOLE
    // body becomes UCS-2 at 67 units a part.
    //
    // THIS is also the case that keeps `withOptOut` honest here: without the
    // disclosure the composed body is TWO parts, disclosed it is THREE.
    // Mutation: measure `defaultQuoteFollowupBody(name)` without the
    // disclosure -> this reds at `segments: 2`, where the GSM-7 case above
    // could not tell the two apart.
    const { encoding, segments } = segmentsFor(withOptOut(defaultQuoteFollowupBody("García Roofing")));
    expect({ encoding, segments }).toEqual({ encoding: "ucs2", segments: 3 });
  });

  it("the day-range copy names the range the parser actually enforces", () => {
    const range = `between ${QUOTE_FOLLOWUP_MIN_QUIET_DAYS} and ${QUOTE_FOLLOWUP_MAX_QUIET_DAYS}`;
    for (const key of ["automations.quoteFollowup.quietDaysHint", "automations.quoteFollowup.quietDaysInvalid"] as const) {
      expect(m[key].toLowerCase(), key).toContain(range);
    }
    // Mutation: set QUOTE_FOLLOWUP_MAX_QUIET_DAYS to 21 -> both keys still read
    // "between 1 and 30" and this reds. It is the only guard against that
    // drift: copy is a static catalogue and cannot interpolate a constant.
  });
});
