import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultReferralAskBody, referralAskSubject } from "./referral-ask-copy";

describe("the referral ask's copy", () => {
  it("names the brand and asks for a NAME", () => {
    const body = defaultReferralAskBody("Rio Roofing");
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("name and number");
  });

  it("the subject names the brand, and names nothing at all when there is none", () => {
    expect(referralAskSubject("Rio Roofing")).toBe("One favour, from Rio Roofing");
    // Mutation: hard-code the subject in referralAskEmail again (the shape
    // this plan started with) → the second line reds, because an unbranded
    // account's subject becomes "One favour, from " with nothing after the
    // comma. `brandDisplayName` returns "" for an account with no brand name
    // (`branding.ts:197-199`), so this is reachable, not theoretical.
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
   * THE ENCODING, not the character count. This recipe's channel is
   * configurable, so the default body CAN be sent as a text: one character
   * outside GSM-7 (an em dash, a curly apostrophe) drops the WHOLE body to
   * UCS-2 at 70 characters a segment and doubles the bill on every send
   * (segments.ts:15-19; the plan's standing rule after Task 3 shipped one).
   * `encoding` and `segments` are pinned and `chars` deliberately is not —
   * a character count rots on the first word anyone rewrites, while the
   * encoding is the property that costs money.
   */
  it("stays inside GSM-7 and inside ONE segment, both with a brand name and without", () => {
    // Mutation: put an em dash in `automations.referral.defaultBody` (or a
    // curly apostrophe in "we'll") → encoding flips to ucs2 and this reds.
    for (const name of ["Rio Roofing", ""]) {
      const s = segmentsFor(defaultReferralAskBody(name));
      expect(s.encoding, name).toBe("gsm7");
      expect(s.segments, name).toBe(1);
    }
  });
});
