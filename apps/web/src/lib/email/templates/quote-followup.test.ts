import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { quoteFollowupEmail } from "./quote-followup";

/**
 * `referral-ask.test.ts`'s assertions for the same shell and the same
 * restraint — matched rather than reinvented: the caller's subject, the
 * paragraph split in BOTH parts, escaping, and no button.
 */
const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });
const SUBJECT = "About your quote from Rio Roofing";

describe("quoteFollowupEmail", () => {
  it("passes the CALLER's subject through unchanged, including the unbranded one", () => {
    // Mutation: build the subject inside the template from `brand.name` ->
    // the second line reds with "About your quote from " for an account that
    // has never set a brand name. The copy module owns that branch.
    expect(quoteFollowupEmail({ brand, subject: SUBJECT, body: "Any questions?" }).subject).toBe(SUBJECT);
    expect(quoteFollowupEmail({ brand: emailBrand(UNBRANDED), subject: "About your quote", body: "Any questions?" }).subject)
      .toBe("About your quote");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "Just checking you got the quote.\n\nHappy to adjust it.\n\nAny questions?";
    const { html, text } = quoteFollowupEmail({ brand, subject: SUBJECT, body });
    expect(html).toContain("<p style=\"margin:0 0 12px;\">Just checking you got the quote.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">Happy to adjust it.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">Any questions?</p>");
    expect(text).toBe("Just checking you got the quote.\n\nHappy to adjust it.\n\nAny questions?");
  });

  it("escapes markup the operator typed into the body", () => {
    const { html } = quoteFollowupEmail({ brand, subject: SUBJECT, body: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries NO LINK OF ANY KIND — no button, no href, no footer", () => {
    // The action is "reply to this email", so a button would need somewhere to
    // point: the quote is a document the operator already sent and this app
    // never held a copy of. Mutation: add the review request's button markup
    // -> the href assertion reds. `not.toContain("href=")` covers the whole
    // document, logo included: `shell` renders the logo as an <img>, never an
    // anchor, so there is no legitimate href in this template's output.
    const { html } = quoteFollowupEmail({ brand, subject: SUBJECT, body: "Any questions?" });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("never returns an empty text part, and the text part carries no HTML", () => {
    const { text } = quoteFollowupEmail({ brand, subject: SUBJECT, body: "hi\n\nthere" });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("<p");
  });
});
