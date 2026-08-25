import { describe, it, expect } from "vitest";
import { voiceCallAlertEmail } from "./voice";

const brand = { name: "Rio Roofing", logoUrl: null, accent: { accent: "violet", accentForeground: "#ffffff" } };

describe("voiceCallAlertEmail", () => {
  it("carries outcome, summary and caller in both html and text", () => {
    const { html, text } = voiceCallAlertEmail({
      brand, outcome: "lead", summary: "RECORDED — Intake: captured.",
      callerDisplay: "+19562921696", contactUrl: "https://x/dashboard/accounts/a1/contacts/ct1",
    });
    for (const out of [html, text]) {
      expect(out).toContain("lead");
      expect(out).toContain("RECORDED");
      expect(out).toContain("+19562921696");
    }
    expect(html).toContain("https://x/dashboard/accounts/a1/contacts/ct1");
  });
  it("escapes html in the summary", () => {
    const { html } = voiceCallAlertEmail({
      brand, outcome: "message", summary: "<script>alert(1)</script>", callerDisplay: "Unknown caller", contactUrl: null,
    });
    expect(html).not.toContain("<script>");
  });
});
