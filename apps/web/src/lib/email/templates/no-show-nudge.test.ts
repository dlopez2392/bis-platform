import { describe, it, expect } from "vitest";
import { noShowNudgeEmail } from "./no-show-nudge";
import { reviewRequestEmail } from "./review-request";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: null,
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const URL = "https://app.example.com/b/cal_pub_1";

describe("noShowNudgeEmail", () => {
  it("asks in the subject, in the brand's name, never the internal label", () => {
    expect(noShowNudgeEmail({ brand, body: "We missed you.", bookingUrl: URL }).subject)
      .toBe("Want to pick a new time with Rio Roofing?");
  });

  it("renders the body as paragraphs, then the booking page as the ONE button, in both parts", () => {
    const { html, text } = noShowNudgeEmail({ brand, body: "We missed you.\n\nPick a new time:", bookingUrl: URL });
    expect(html).toContain('<p style="margin:0 0 12px;">We missed you.</p>');
    expect(html).toContain('<p style="margin:0 0 12px;">Pick a new time:</p>');
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain(">Pick a new time</a>");
    expect(text).toBe(`We missed you.\n\nPick a new time:\n\n${URL}`);
  });

  it("escapes markup the operator typed, and escapes the url in the href", () => {
    const { html } = noShowNudgeEmail({ brand, body: "<b>hi</b>", bookingUrl: "https://x.example/?a=1&b=2" });
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).not.toContain("<b>hi</b>");
  });

  it("shares its body with the review request: same paragraphs, same button markup, different label and subject", () => {
    // The review template's own tests stay the proof for its side; this pins
    // that the shared renderer is the same one.
    const a = noShowNudgeEmail({ brand, body: "Same body", bookingUrl: URL }).html;
    const b = reviewRequestEmail({ brand, body: "Same body", reviewUrl: URL }).html;
    expect(a.replace(">Pick a new time</a>", ">Leave a review</a>")).toBe(b);
  });
});
