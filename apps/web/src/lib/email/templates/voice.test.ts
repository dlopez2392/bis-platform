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
  it("leads with the call-back line when there is one, in html and text, escaped (mutation: drop the line → FAILS; put it after the summary → FAILS)", () => {
    const { html, text } = voiceCallAlertEmail({
      brand, outcome: "message", summary: "RECORDED — Messages: 1.",
      callerDisplay: "+19562921696", contactUrl: null,
      callback: "Call back at 9565061545: Leak <over> the garage",
    });
    expect(text.split("\n")[0]).toBe("Call back at 9565061545: Leak <over> the garage");
    expect(html).toContain("Call back at 9565061545: Leak &lt;over&gt; the garage");
    expect(html.indexOf("Call back at")).toBeLessThan(html.indexOf("Call — message"));
    expect(html).not.toContain("<over>");
  });

  it("no call-back line → the alert is exactly what it was (mutation: render an empty lead paragraph → FAILS)", () => {
    const base = { brand, outcome: "lead", summary: "RECORDED — Intake: captured.", callerDisplay: "+19562921696", contactUrl: null };
    expect(voiceCallAlertEmail({ ...base, callback: null })).toEqual(voiceCallAlertEmail(base));
    expect(voiceCallAlertEmail(base).text.split("\n")[0]).toBe("Call — lead");
    // Exactly ONE paragraph more when there is a line, so "no line" adds none.
    const paragraphs = (html: string) => html.split("<p").length;
    expect(paragraphs(voiceCallAlertEmail({ ...base, callback: "Call back at 9565061545: x" }).html)
      - paragraphs(voiceCallAlertEmail(base).html)).toBe(1);
  });

  it("escapes html in the summary", () => {
    const { html } = voiceCallAlertEmail({
      brand, outcome: "message", summary: "<script>alert(1)</script>", callerDisplay: "Unknown caller", contactUrl: null,
    });
    expect(html).not.toContain("<script>");
  });
});
