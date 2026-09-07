import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { outboundEmail } from "./outbound";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });

describe("outboundEmail", () => {
  // The operator typed this. Nothing may rewrite it.
  it("keeps the typed body verbatim in the text part", () => {
    const body = "Hi Maria,\n\nQuote attached.\n\nThanks";
    expect(outboundEmail({ brand, body }).text).toBe(body);
  });

  it("preserves line breaks in the html part", () => {
    const { html } = outboundEmail({ brand, body: "line one\nline two" });
    expect(html).toContain("line one<br />line two");
  });

  it("escapes markup a sender pasted in", () => {
    const { html } = outboundEmail({ brand, body: "<script>x</script>" });
    expect(html).not.toContain("<script>");
  });

  /**
   * Restraint is the design, not an omission.
   *
   * A heavily branded 1:1 email from a contractor to a customer reads as
   * marketing, which costs trust and inbox placement — so no button, no
   * footer, no campaign chrome. The button's own style string is the marker:
   * if it ever appears here, someone has added a CTA to a personal email.
   */
  it("adds no button and no footer", () => {
    const { html } = outboundEmail({ brand, body: "hello" });
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });
});
