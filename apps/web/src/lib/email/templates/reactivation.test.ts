import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { reactivationEmail } from "./reactivation";

/**
 * `followup.test.ts`'s and `referral-ask.test.ts`'s assertions for the same
 * shell and the same restraint — matched rather than reinvented: the
 * caller's subject, the paragraph split in BOTH parts, escaping, and no
 * button. The blank-brand branch lives once, in `reactivation-copy.ts`.
 */
const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });
const SUBJECT = "A note from Rio Roofing";

describe("reactivationEmail", () => {
  it("passes the CALLER's subject through unchanged, including the unbranded one", () => {
    // Mutation: build the subject inside the template from `brand.name` →
    // the second line reds with "A note from " for an account that has never
    // set a brand name. The copy module owns that branch.
    expect(reactivationEmail({ brand, subject: SUBJECT, body: "It's been a while." }).subject).toBe(SUBJECT);
    expect(reactivationEmail({ brand: emailBrand(UNBRANDED), subject: "Checking in", body: "It's been a while." }).subject)
      .toBe("Checking in");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "It's been a while since we were out at your place.\n\nIf anything needs looking at, just reply.\n\nWe'll get you on the schedule.";
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body });
    expect(html).toContain("<p style=\"margin:0 0 12px;\">It's been a while since we were out at your place.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">If anything needs looking at, just reply.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">We'll get you on the schedule.</p>");
    expect(text).toBe("It's been a while since we were out at your place.\n\nIf anything needs looking at, just reply.\n\nWe'll get you on the schedule.");
  });

  it("escapes markup the operator typed into the body", () => {
    const { html } = reactivationEmail({ brand, subject: SUBJECT, body: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries NO LINK OF ANY KIND — no button, no href, no footer", () => {
    // The action is "reply to this email", so a button would need somewhere
    // to point. Mutation: add the review request's button markup to
    // `reactivationEmail` → the href assertion reds BY NAME.
    // `not.toContain("href=")` covers the whole document, logo included:
    // `shell` renders the logo as an <img>, never an anchor, so there is no
    // legitimate href in this template's output.
    const { html } = reactivationEmail({ brand, subject: SUBJECT, body: "Anything need looking at?" });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("never returns an empty text part, and the text part carries no HTML", () => {
    const { text } = reactivationEmail({ brand, subject: SUBJECT, body: "hi\n\nthere" });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("<p");
  });
});
