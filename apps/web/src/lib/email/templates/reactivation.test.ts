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
    expect(reactivationEmail({ brand, subject: SUBJECT, body: "It's been a while.", mailingAddress: ADDRESS, footerReason: REASON }).subject)
      .toBe(SUBJECT);
    expect(reactivationEmail({
      brand: emailBrand(UNBRANDED), subject: "Checking in", body: "It's been a while.", mailingAddress: ADDRESS, footerReason: REASON,
    }).subject).toBe("Checking in");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "It's been a while since we were out at your place.\n\nIf anything needs looking at, just reply.\n\nWe'll get you on the schedule.";
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body, mailingAddress: ADDRESS, footerReason: REASON });
    expect(html).toContain("<p style=\"margin:0 0 12px;\">It's been a while since we were out at your place.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">If anything needs looking at, just reply.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">We'll get you on the schedule.</p>");
    expect(text.startsWith("It's been a while since we were out at your place.\n\nIf anything needs looking at, just reply.\n\nWe'll get you on the schedule.\n\n"))
      .toBe(true);
  });

  it("escapes markup the operator typed into the body", () => {
    const { html } = reactivationEmail({ brand, subject: SUBJECT, body: "<script>alert(1)</script>", mailingAddress: ADDRESS, footerReason: REASON });
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
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body: "Anything need looking at?", mailingAddress: ADDRESS, footerReason: REASON });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
    expect(text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("the footer — why they got it, how to stop it, then the postal address — is in BOTH parts, after the body", () => {
    // Mutation: drop the footer from the HTML (or from the text part) → this
    // reds BY NAME. The text part carries it after a blank line, the address
    // on its own lines below the reason.
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body: "Anything need looking at?", mailingAddress: ADDRESS, footerReason: REASON });
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

  it("prints the CALLER's footer line verbatim, and composes none of its own — the unbranded one included", () => {
    // The subject's shape (review minor M6, 2026-09-22): the pass composes
    // the line with `marketingFooterReason(row.brandName)` and the
    // template prints what it is given. The blank-brand branch is the copy
    // module's (reactivation-copy.test.ts). Mutation: compose the line inside
    // the template from `brand.name` again → the distinctive line below is
    // missing from both parts and this reds BY NAME.
    const line = "CALLER-SUPPLIED footer line.";
    const { html, text } = reactivationEmail({
      brand: emailBrand(UNBRANDED), subject: "Checking in", body: "Hi.", mailingAddress: ADDRESS, footerReason: line,
    });
    expect(text).toBe(`Hi.\n\n${line}\n\n123 Main St\nMcAllen, TX 78501`);
    expect(html).toContain(`<p style="margin:16px 0 0;font-size:13px;color:#71717a;">${line}</p>`);
    expect(html).not.toContain(m["automations.reactivation.footerReasonNoName"]);
  });

  it("escapes the footer line — a brand name carrying markup reaches the HTML as text", () => {
    // Review minor M1 (2026-09-22): `escapeHtml(reason)` survived its own
    // removal because no case put markup in the brand. Mutation: print the
    // footer line without `escapeHtml` → this reds BY NAME. The address here
    // is the plain one, so the escaped name can only have come from the line.
    const line = "You're getting this because you've been a customer of Rio <Roofing> & Sons. "
      + "If you'd rather not hear from us, reply and let us know.";
    const { html, text } = reactivationEmail({
      brand, subject: SUBJECT, body: "Hi.", mailingAddress: ADDRESS, footerReason: line,
    });
    expect(html).toContain("a customer of Rio &lt;Roofing&gt; &amp; Sons.");
    expect(html).not.toContain("<Roofing>");
    // The text part is plain text and is NOT escaped.
    expect(text).toContain("a customer of Rio <Roofing> & Sons.");
  });

  it("escapes the address, and newlines become <br> in HTML ONLY — CRLF from a browser textarea included", () => {
    // A textarea submits CRLF, so a stored address may carry "\r\n".
    // Mutation: skip `escapeHtml` on the address → the markup line reds;
    // join the lines with "<br>" in the text part too → the text line reds.
    const typed = "Rio <Roofing> & Sons\r\n123 Main St\r\n\r\nMcAllen, TX 78501  ";
    const { html, text } = reactivationEmail({ brand, subject: SUBJECT, body: "Hi.", mailingAddress: typed, footerReason: REASON });
    expect(html).not.toContain("<Roofing>");
    expect(html).toContain("Rio &lt;Roofing&gt; &amp; Sons<br>123 Main St<br>McAllen, TX 78501</p>");
    expect(text.endsWith("\n\nRio <Roofing> & Sons\n123 Main St\nMcAllen, TX 78501")).toBe(true);
    expect(text).not.toContain("<br>");
    expect(text).not.toContain("\r");
  });

  it("never returns an empty text part, and the text part carries no HTML", () => {
    const { text } = reactivationEmail({ brand, subject: SUBJECT, body: "hi\n\nthere", mailingAddress: ADDRESS, footerReason: REASON });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("<p");
  });
});
