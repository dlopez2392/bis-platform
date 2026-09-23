import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { m } from "@/lib/messages";
import { emailBrand } from "./shell";
import { referralAskEmail } from "./referral-ask";
import { reactivationEmail } from "./reactivation";

/**
 * `followup.test.ts`'s assertions for the same shell and the same restraint —
 * matched rather than reinvented: the subject, the paragraph split in BOTH
 * parts, escaping, and no button. The one thing this template does that the
 * follow-up does not is take its subject from the CALLER, so the blank-brand
 * branch lives once in `referral-ask-copy.ts` instead of here.
 *
 * Plus the FOOTER (B21, danlo, 2026-09-23): the referral ask is the second
 * marketing email, so it carries the check-in's footer — why they got it,
 * how to stop it (reply), the business's postal address — through the ONE
 * helper both templates share. The footer cases below mirror
 * `reactivation.test.ts`'s, and the last one pins that the two are the same.
 */
const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });
const SUBJECT = "One favor, from Rio Roofing";
const ADDRESS = "123 Main St\nMcAllen, TX 78501";
const REASON = "You're getting this because you've been a customer of Rio Roofing. "
  + "If you'd rather not hear from us, reply and let us know.";
const FOOTER = { mailingAddress: ADDRESS, footerReason: REASON };

describe("referralAskEmail", () => {
  it("passes the CALLER's subject through unchanged, including the unbranded one", () => {
    // Mutation: build the subject inside the template from `brand.name` →
    // the second line reds with "One favor, from " for an account that has
    // never set a brand name. The copy module owns that branch.
    expect(referralAskEmail({ brand, subject: SUBJECT, body: "Thanks again.", ...FOOTER }).subject).toBe(SUBJECT);
    expect(referralAskEmail({ brand: emailBrand(UNBRANDED), subject: "One favor", body: "Thanks again.", ...FOOTER }).subject)
      .toBe("One favor");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "Thanks again for the work.\n\nIf you know someone, reply with a name.\n\nWe'll look after them.";
    const { html, text } = referralAskEmail({ brand, subject: SUBJECT, body, ...FOOTER });
    expect(html).toContain("<p style=\"margin:0 0 12px;\">Thanks again for the work.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">If you know someone, reply with a name.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">We'll look after them.</p>");
    expect(text.startsWith("Thanks again for the work.\n\nIf you know someone, reply with a name.\n\nWe'll look after them.\n\n"))
      .toBe(true);
  });

  it("escapes markup the operator typed into the body", () => {
    const { html } = referralAskEmail({ brand, subject: SUBJECT, body: "<script>alert(1)</script>", ...FOOTER });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries NO LINK OF ANY KIND — no button, no href, and the way out is a reply, not an unsubscribe link", () => {
    // The action is "reply to this email with a name", so a button would need
    // somewhere to point — and the footer's opt-out is a reply for the same
    // reason. Mutation: add the review request's button markup → the href
    // assertion reds. `not.toContain("href=")` covers the whole document,
    // logo and footer included: `shell` renders the logo as an <img>, never
    // an anchor, so there is no legitimate href in this template's output.
    const { html, text } = referralAskEmail({ brand, subject: SUBJECT, body: "Know anyone else?", ...FOOTER });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
    expect(text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("the footer — why they got it, how to stop it, then the postal address — is in BOTH parts, after the body", () => {
    // Mutation: drop the footer from the HTML (or from the text part) → this
    // reds BY NAME. The text part carries it after a blank line, the address
    // on its own lines below the reason.
    const { html, text } = referralAskEmail({ brand, subject: SUBJECT, body: "Know anyone else?", ...FOOTER });
    expect(text).toBe(`Know anyone else?\n\n${REASON}\n\n123 Main St\nMcAllen, TX 78501`);
    const bodyAt = html.indexOf("Know anyone else?");
    const reasonAt = html.indexOf(REASON);
    const addressAt = html.indexOf("123 Main St<br>McAllen, TX 78501");
    expect(bodyAt).toBeGreaterThan(-1);
    expect(reasonAt).toBeGreaterThan(bodyAt);
    expect(addressAt).toBeGreaterThan(reasonAt);
    expect(html).toContain("font-size:13px;color:#71717a;");
  });

  it("prints the CALLER's footer line verbatim, and composes none of its own — the unbranded one included", () => {
    // The pass composes the line with `marketingFooterReason(row.brandName)`
    // and the template prints what it is given; the blank-brand branch is the
    // copy module's. Mutation: compose the line inside the template from
    // `brand.name` → the distinctive line below is missing and this reds.
    const line = "CALLER-SUPPLIED footer line.";
    const { html, text } = referralAskEmail({
      brand: emailBrand(UNBRANDED), subject: "One favor", body: "Hi.", mailingAddress: ADDRESS, footerReason: line,
    });
    expect(text).toBe(`Hi.\n\n${line}\n\n123 Main St\nMcAllen, TX 78501`);
    expect(html).toContain(`<p style="margin:16px 0 0;font-size:13px;color:#71717a;">${line}</p>`);
    expect(html).not.toContain(m["automations.reactivation.footerReasonNoName"]);
  });

  it("escapes the footer line — a brand name carrying markup reaches the HTML as text", () => {
    // Mutation: print the footer line without `escapeHtml` in the shared
    // helper → this reds BY NAME (and reactivation.test.ts's twin with it).
    const line = "You're getting this because you've been a customer of Rio <Roofing> & Sons. "
      + "If you'd rather not hear from us, reply and let us know.";
    const { html, text } = referralAskEmail({
      brand, subject: SUBJECT, body: "Hi.", mailingAddress: ADDRESS, footerReason: line,
    });
    expect(html).toContain("a customer of Rio &lt;Roofing&gt; &amp; Sons.");
    expect(html).not.toContain("<Roofing>");
    expect(text).toContain("a customer of Rio <Roofing> & Sons.");
  });

  it("escapes the address, and newlines become <br> in HTML ONLY — CRLF from a browser textarea included", () => {
    // Mutation: skip `escapeHtml` on the address → the markup line reds;
    // join the lines with "<br>" in the text part too → the text line reds.
    const typed = "Rio <Roofing> & Sons\r\n123 Main St\r\n\r\nMcAllen, TX 78501  ";
    const { html, text } = referralAskEmail({ brand, subject: SUBJECT, body: "Hi.", mailingAddress: typed, footerReason: REASON });
    expect(html).not.toContain("<Roofing>");
    expect(html).toContain("Rio &lt;Roofing&gt; &amp; Sons<br>123 Main St<br>McAllen, TX 78501</p>");
    expect(text.endsWith("\n\nRio <Roofing> & Sons\n123 Main St\nMcAllen, TX 78501")).toBe(true);
    expect(text).not.toContain("<br>");
    expect(text).not.toContain("\r");
  });

  it("ONE FOOTER, TWO EMAILS: the referral ask's footer is byte-for-byte the check-in's", () => {
    // Same body, same footer inputs: everything after the body must match in
    // both parts. Mutation: change the footer markup in ONE template (say,
    // inline a copy of it into referral-ask.ts and drop the address's
    // `<br>`) → this reds BY NAME, which is what the shared helper is for.
    const input = { brand, subject: SUBJECT, body: "Hi.", ...FOOTER };
    const referral = referralAskEmail(input);
    const checkIn = reactivationEmail(input);
    expect(referral.text).toBe(checkIn.text);
    expect(referral.html).toBe(checkIn.html);
  });

  it("never returns an empty text part, and the text part carries no HTML", () => {
    const { text } = referralAskEmail({ brand, subject: SUBJECT, body: "hi\n\nthere", ...FOOTER });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("<p");
  });
});
