import { describe, it, expect } from "vitest";
import { reviewRequestEmail } from "./review-request";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: null,
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const URL = "https://g.page/r/CXyZ123abc/review";

describe("reviewRequestEmail", () => {
  it("asks in the subject, in the brand's name, never the internal label", () => {
    expect(reviewRequestEmail({ brand, body: "Thanks!", reviewUrl: URL }).subject)
      .toBe("Would you leave Rio Roofing a review?");
  });

  it("renders the body as paragraphs, then the review link as the ONE button, in both parts", () => {
    const { html, text } = reviewRequestEmail({ brand, body: "Thanks for choosing us!\n\nWe'd love a review:", reviewUrl: URL });
    expect(html).toContain('<p style="margin:0 0 12px;">Thanks for choosing us!</p>');
    // escapeHtml leaves apostrophes alone (it escapes & < > " only).
    expect(html).toContain('<p style="margin:0 0 12px;">We\'d love a review:</p>');
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain(">Leave a review</a>");
    expect(text).toBe(`Thanks for choosing us!\n\nWe'd love a review:\n\n${URL}`);
  });

  it("escapes markup the operator typed, and escapes the url in the href", () => {
    const { html } = reviewRequestEmail({ brand, body: "<b>hi</b>", reviewUrl: "https://x.example/?a=1&b=2" });
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).not.toContain("<b>hi</b>");
  });
});
