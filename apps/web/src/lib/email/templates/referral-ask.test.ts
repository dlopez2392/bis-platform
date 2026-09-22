import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { referralAskEmail } from "./referral-ask";

/**
 * `followup.test.ts`'s assertions for the same shell and the same restraint —
 * matched rather than reinvented: the subject, the paragraph split in BOTH
 * parts, escaping, and no button. The one thing this template does that the
 * follow-up does not is take its subject from the CALLER, so the blank-brand
 * branch lives once in `referral-ask-copy.ts` instead of here.
 */
const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });
const SUBJECT = "One favour, from Rio Roofing";

describe("referralAskEmail", () => {
  it("passes the CALLER's subject through unchanged, including the unbranded one", () => {
    // Mutation: build the subject inside the template from `brand.name` →
    // the second line reds with "One favour, from " for an account that has
    // never set a brand name. The copy module owns that branch.
    expect(referralAskEmail({ brand, subject: SUBJECT, body: "Thanks again." }).subject).toBe(SUBJECT);
    expect(referralAskEmail({ brand: emailBrand(UNBRANDED), subject: "One favour", body: "Thanks again." }).subject)
      .toBe("One favour");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "Thanks again for the work.\n\nIf you know someone, reply with a name.\n\nWe'll look after them.";
    const { html, text } = referralAskEmail({ brand, subject: SUBJECT, body });
    expect(html).toContain("<p style=\"margin:0 0 12px;\">Thanks again for the work.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">If you know someone, reply with a name.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">We'll look after them.</p>");
    expect(text).toBe("Thanks again for the work.\n\nIf you know someone, reply with a name.\n\nWe'll look after them.");
  });

  it("escapes markup the operator typed into the body", () => {
    const { html } = referralAskEmail({ brand, subject: SUBJECT, body: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries NO LINK OF ANY KIND — no button, no href, no footer", () => {
    // The action is "reply to this email with a name", so a button would need
    // somewhere to point. Mutation: add the review request's button markup →
    // the href assertion reds. `not.toContain("href=")` covers the whole
    // document, logo included: `shell` renders the logo as an <img>, never an
    // anchor, so there is no legitimate href in this template's output.
    const { html } = referralAskEmail({ brand, subject: SUBJECT, body: "Know anyone else?" });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("never returns an empty text part, and the text part carries no HTML", () => {
    const { text } = referralAskEmail({ brand, subject: SUBJECT, body: "hi\n\nthere" });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("<p");
  });
});
