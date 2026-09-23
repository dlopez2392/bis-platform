import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { m } from "@/lib/messages";
import { emailBrand } from "./shell";
import { reactivationEmail } from "./reactivation";

/**
 * `followup.test.ts`'s and `referral-ask.test.ts`'s assertions for the same
 * shell and the same restraint — matched rather than reinvented: the
 * caller's subject, the paragraph split in BOTH parts, escaping, and no
 * button. The blank-brand branches live once, in `reactivation-copy.ts`.
 *
 * Plus the one thing this template has that its siblings do not (decision A,
 * 2026-09-22): a FOOTER — why they are getting it, how to stop it (reply),
 * and the business's postal address — because this is the one recipe that
 * emails someone who did not just interact with the business.
 */
const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });
const SUBJECT = "A note from Rio Roofing";
const ADDRESS = "123 Main St\nMcAllen, TX 78501";
const REASON = "You're getting this because you've been a customer of Rio Roofing. "
  + "If you'd rather not hear from us, reply and let us know.";

describe("reactivationEmail", () => {
  it("passes the CALLER's subject through unchanged, including the unbranded one", () => {
    // Mutation: build the subject inside the template from `brand.name` →
    // the second line reds with "A note from " for an account that has never
    // set a brand name. The copy module owns that branch.
    expect(reactivationEmail({ brand, subject: SUBJECT, body: "It's been a while.", mailingAddress: ADDRESS }).subject)
      .toBe(SUBJECT);
    expect(reactivationEmail({
      brand: emailBrand(UNBRANDED), subject: "Checking in", body: "It's been a while.", mailingAddress: ADDRESS,
    }).subject).toBe("Checking in");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "It's been a while since we were out at your place.\n\nIf anything needs looking at, just reply.\n\nWe'll get you on the schedule.";
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body, mailingAddress: ADDRESS });
    expect(html).toContain("<p style=\"margin:0 0 12px;\">It's been a while since we were out at your place.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">If anything needs looking at, just reply.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">We'll get you on the schedule.</p>");
    expect(text.startsWith("It's been a while since we were out at your place.\n\nIf anything needs looking at, just reply.\n\nWe'll get you on the schedule.\n\n"))
      .toBe(true);
  });

  it("escapes markup the operator typed into the body", () => {
    const { html } = reactivationEmail({ brand, subject: SUBJECT, body: "<script>alert(1)</script>", mailingAddress: ADDRESS });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries NO LINK OF ANY KIND — no button, no href, and the way out is a reply, not an unsubscribe link", () => {
    // The action is "reply to this email", so a button would need somewhere
    // to point — and the footer's opt-out is a reply for the same reason.
    // Mutation: add the review request's button markup to
    // `reactivationEmail` → the href assertion reds BY NAME.
    // `not.toContain("href=")` covers the whole document, logo and footer
    // included: `shell` renders the logo as an <img>, never an anchor, so
    // there is no legitimate href in this template's output.
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body: "Anything need looking at?", mailingAddress: ADDRESS });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
    expect(text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("the footer — why they got it, how to stop it, then the postal address — is in BOTH parts, after the body", () => {
    // Mutation: drop the footer from the HTML (or from the text part) → this
    // reds BY NAME. The text part carries it after a blank line, the address
    // on its own lines below the reason.
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body: "Anything need looking at?", mailingAddress: ADDRESS });
    expect(text).toBe(`Anything need looking at?\n\n${REASON}\n\n123 Main St\nMcAllen, TX 78501`);
    // HTML: the reason (apostrophes pass through escapeHtml untouched), then
    // the address — both AFTER the body paragraph, in the muted small style.
    const bodyAt = html.indexOf("Anything need looking at?");
    const reasonAt = html.indexOf(REASON);
    const addressAt = html.indexOf("123 Main St<br>McAllen, TX 78501");
    expect(bodyAt).toBeGreaterThan(-1);
    expect(reasonAt).toBeGreaterThan(bodyAt);
    expect(addressAt).toBeGreaterThan(reasonAt);
    expect(html).toContain("font-size:13px;color:#71717a;");
  });

  it("the unbranded footer uses the no-name line, never 'a customer of .'", () => {
    const { html, text } = reactivationEmail({
      brand: emailBrand(UNBRANDED), subject: "Checking in", body: "Hi.", mailingAddress: ADDRESS,
    });
    expect(text).toContain(m["automations.reactivation.footerReasonNoName"]);
    expect(html).toContain(m["automations.reactivation.footerReasonNoName"]);
    expect(html).not.toContain("customer of .");
  });

  it("escapes the address, and newlines become <br> in HTML ONLY — CRLF from a browser textarea included", () => {
    // A textarea submits CRLF, so a stored address may carry "\r\n".
    // Mutation: skip `escapeHtml` on the address → the markup line reds;
    // join the lines with "<br>" in the text part too → the text line reds.
    const typed = "Rio <Roofing> & Sons\r\n123 Main St\r\n\r\nMcAllen, TX 78501  ";
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body: "Hi.", mailingAddress: typed });
    expect(html).not.toContain("<Roofing>");
    expect(html).toContain("Rio &lt;Roofing&gt; &amp; Sons<br>123 Main St<br>McAllen, TX 78501</p>");
    expect(text.endsWith("\n\nRio <Roofing> & Sons\n123 Main St\nMcAllen, TX 78501")).toBe(true);
    expect(text).not.toContain("<br>");
    expect(text).not.toContain("\r");
  });

  it("never returns an empty text part, and the text part carries no HTML", () => {
    const { text } = reactivationEmail({ brand, subject: SUBJECT, body: "hi\n\nthere", mailingAddress: ADDRESS });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("<p");
  });
});
