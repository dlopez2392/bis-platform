import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { defaultReferralAskBody, referralAskSubject } from "./referral-ask-copy";

describe("the referral ask's copy", () => {
  it("names the brand and asks for a NAME", () => {
    const body = defaultReferralAskBody("Rio Roofing");
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("name and number");
  });

  it("the subject names the brand, and names nothing at all when there is none", () => {
    expect(referralAskSubject("Rio Roofing")).toBe("One favor, from Rio Roofing");
    // Mutation: delete the `if (!brandName.trim())` branch from
    // `referralAskSubject` → the second line reds with "One favor, from    ".
    // `brandDisplayName` returns "" for an account with no brand name
    // (`branding.ts:197-199`), so this is reachable, not theoretical.
    //
    // NOT "hard-code the subject in referralAskEmail again": this file never
    // calls that function, so that mutation leaves every case here GREEN and
    // reds `referral-ask.test.ts`'s own pass-through case instead. A
    // mutation comment naming a test it cannot fail is the same defect as a
    // `-t` filter matching nothing — measured, not assumed.
    expect(referralAskSubject("   ")).toBe(m["automations.referral.emailSubjectNoName"]);
    expect(referralAskSubject("A $& B")).toContain("A $& B");
  });

  it("contains NO LINK, because this is not a review request", () => {
    // The distinction is enforced, not hoped for: the config has no url field
    // and the body has no link. Mutation: paste a review URL into
    // automations.referral.defaultBody → this reds BY NAME.
    for (const name of ["Rio Roofing", ""]) {
      expect(defaultReferralAskBody(name)).not.toContain("http");
      expect(defaultReferralAskBody(name)).not.toContain("www.");
    }
  });

  it("never asks for a rating or a review", () => {
    const body = defaultReferralAskBody("Rio Roofing").toLowerCase();
    expect(body).not.toContain("review");
    expect(body).not.toContain("star");
  });

  it("drops the naming clause when there is no brand name", () => {
    // THE EXACT STRING, not `not.toContain("undefined")` + a substring:
    // deleting the blank-name branch yields "Thanks again from    . If you
    // know someone…", which satisfies both of those and reds nothing.
    // Mutation: delete the `if (!brandName.trim())` branch → this reds BY NAME.
    expect(defaultReferralAskBody("   ")).toBe(m["automations.referral.defaultBodyNoName"]);
    expect(defaultReferralAskBody("")).toBe(m["automations.referral.defaultBodyNoName"]);
  });

  it("survives a company name containing a String.replace special", () => {
    expect(defaultReferralAskBody("A $& B")).toContain("A $& B");
  });

  it("carries no internal milestone code and no template syntax", () => {
    const body = defaultReferralAskBody("Rio Roofing");
    expect(body).not.toMatch(/\bM[0-9][a-z]?\b/);
    expect(body).not.toContain("{{");
  });

  /**
   * THE DISCLOSED BODY, because that is the one the customer receives and the
   * client is billed for: `sendAutomationSms` appends `withOptOut`
   * unconditionally (send-sms.ts:82), 23 septets in English. Measuring the
   * composed body alone would claim one segment over a text that bills two —
   * the defect the appointment-confirm CARD shipped and review caught, in the
   * copy layer this time.
   *
   * ENCODING AND SEGMENTS, never `chars` (the plan's Global Constraint): a
   * character count rots on the first word anyone rewrites, while the
   * encoding is what costs money. One character outside GSM-7 (an em dash, a
   * curly apostrophe) drops the WHOLE body to UCS-2 at 70 characters a
   * segment (segments.ts:15-19). The measured septet counts are recorded in
   * the comments below rather than asserted.
   *
   * THE BUDGET, stated once: the template is 110 septets, the disclosure 23,
   * and GSM-7's single-segment bound is 160 — so one segment holds a brand
   * name of 27 characters or fewer. Every name below is a real Valley shape.
   */
  it("bills ONE segment for an ordinary Valley company name, disclosure included", () => {
    // Mutation: put an em dash in `automations.referral.defaultBody` (or a
    // curly apostrophe in "we'll") → encoding flips to ucs2 and this reds.
    const measure = (name: string) => {
      const { encoding, segments } = segmentsFor(withOptOut(defaultReferralAskBody(name)));
      return { encoding, segments };
    };
    expect(measure("Rio Roofing")).toEqual({ encoding: "gsm7", segments: 1 });              // 144 septets
    // SIXTEEN CHARACTERS, the case that motivated shortening this copy: the
    // first draft's template was 124 septets, which left a 13-character
    // budget, and this name alone billed TWO segments (163) on every referral
    // ask the client ever sent. Mutation: restore the longer default body →
    // this reds at `segments: 2`.
    expect(measure("Sunrise Plumbing")).toEqual({ encoding: "gsm7", segments: 1 });         // 149 septets
    // And the two names at the top of the budget, so the 27 above is a
    // measured bound rather than a claim: 23 and 25 characters.
    expect(measure("Valley Air Conditioning")).toEqual({ encoding: "gsm7", segments: 1 });  // 156 septets
    expect(measure("Rio Grande Valley Roofing")).toEqual({ encoding: "gsm7", segments: 1 });// 158 septets
    // The blank-name variant, which drops the naming clause entirely.
    expect(measure("")).toEqual({ encoding: "gsm7", segments: 1 });                         // 127 septets
  });

  it("an accented company name is UCS-2 and three segments — unavoidable, and measured rather than wished away", () => {
    // Valley client names are heavily Hispanic and "García" is the common
    // case, not an edge case (review-request-copy.test.ts:42-48 says the same
    // for the same reason). The í is outside GSM7_BASE, so the WHOLE body
    // becomes UCS-2 at 67 units a part: 147 units, three parts, and no
    // shortening of this copy can change that — only removing the customer's
    // own company name from it could, which is not a trade anyone would make.
    // The card's counter renders the same number, so an agency sees the cost
    // before they turn the recipe on.
    //
    // THIS is also the case that keeps `withOptOut` honest here: 124 UTF-16
    // units composed is TWO parts, 147 disclosed is THREE. Mutation: measure
    // `defaultReferralAskBody(name)` without the disclosure → this reds at
    // `segments: 2`, where the GSM-7 case above could not tell the two apart
    // (144 and 121 are both one segment).
    const { encoding, segments } = segmentsFor(withOptOut(defaultReferralAskBody("García Roofing")));
    expect({ encoding, segments }).toEqual({ encoding: "ucs2", segments: 3 });
  });
});
