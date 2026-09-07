import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { bookingFollowupEmail, DEFAULT_FOLLOWUP_BODY } from "./followup";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });

describe("bookingFollowupEmail", () => {
  it("defaults the subject to 'Thanks from {brand.name}'", () => {
    const { subject } = bookingFollowupEmail({ brand, body: "Great seeing you." });
    expect(subject).toBe("Thanks from Rio Roofing");
  });

  // Was "uses the account name in the subject when the account carries no
  // brand name" — that fallback is gone: `brandDisplayName` takes the branding
  // and nothing else, so the subject carries no name rather than the agency's
  // internal label ("Rio Roofing — trial"). Unreachable through the product
  // (creation seeds a brand name, the Branding save refuses a blank, go-live
  // requires the step, 0028 backfilled the rest); pinned here so a
  // reintroduced `?? accountName` fallback shows up at the template layer too.
  it("carries NO name in the subject when the account has no brand name — never the agency's label", () => {
    const unbrandedBrand = emailBrand(UNBRANDED);
    const { subject } = bookingFollowupEmail({ brand: unbrandedBrand, body: "Thanks!" });
    expect(subject).toBe("Thanks from ");
  });

  it("splits the operator's body on blank lines into separate paragraphs, in both parts", () => {
    const body = "Great seeing you today.\n\nLet us know if you have questions.\n\nSee you soon!";
    const { html, text } = bookingFollowupEmail({ brand, body });

    expect(html).toContain("<p style=\"margin:0 0 12px;\">Great seeing you today.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">Let us know if you have questions.</p>");
    expect(html).toContain("<p style=\"margin:0 0 12px;\">See you soon!</p>");
    expect(text).toBe(
      "Great seeing you today.\n\nLet us know if you have questions.\n\nSee you soon!",
    );
  });

  it("escapes markup the operator typed into the follow-up body", () => {
    const { html } = bookingFollowupEmail({ brand, body: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to the default copy when the operator's body is empty", () => {
    const { html, text } = bookingFollowupEmail({ brand, body: "" });
    expect(text).toBe(DEFAULT_FOLLOWUP_BODY);
    expect(html).toContain(DEFAULT_FOLLOWUP_BODY);
  });

  it("falls back to the default copy when the operator's body is only whitespace", () => {
    const { html, text } = bookingFollowupEmail({ brand, body: "   \n  \n  " });
    expect(text).toBe(DEFAULT_FOLLOWUP_BODY);
    expect(html).toContain(DEFAULT_FOLLOWUP_BODY);
  });

  it("never returns an empty text part", () => {
    const { text } = bookingFollowupEmail({ brand, body: "hi" });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("adds no button and no footer (restrained, letter-like, same as outboundEmail)", () => {
    const { html } = bookingFollowupEmail({ brand, body: "hello" });
    expect(html).not.toContain("border-radius:6px;text-decoration:none");
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });
});
