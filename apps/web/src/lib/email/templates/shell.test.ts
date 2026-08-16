import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand, escapeHtml, shell, button } from "./shell";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

describe("emailBrand", () => {
  // accounts.name is the agency's internal label ("Rio Roofing — trial"), which
  // M3 established is not for the client's eyes — let alone their customer's.
  it("prefers the brand name over the agency's internal label", () => {
    expect(emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Rio Roofing — trial").name)
      .toBe("Rio Roofing");
  });

  it("falls back to the account name when no brand name is set", () => {
    expect(emailBrand(UNBRANDED, "Rio Roofing — trial").name).toBe("Rio Roofing — trial");
  });

  /**
   * The reason this goes through the resolver at all.
   *
   * #8b5cf6 sits in the dead luminance band — too light to carry white text,
   * too dark to carry black — so it must be LIFTED before it can be a button.
   * Painting the raw hex is the AA defect M4b already fixed once, and an email
   * is a surface nobody sweeps.
   *
   * ⚠️ The lift is CONDITIONAL, not blanket, and the second case is what says
   * so: a dark navy already carries white text at ~12:1 on this white card, so
   * it passes through untouched. An assertion that every colour changes would
   * be asserting a bug.
   */
  it("lifts a brand colour that cannot carry a label", () => {
    const { accent } = emailBrand({ ...UNBRANDED, brandColor: "#8b5cf6" }, "Acme");
    expect(accent.accent.toLowerCase()).not.toBe("#8b5cf6");
    expect(accent.accentForeground).toBeTruthy();
  });

  it("leaves a colour that already carries one alone", () => {
    const { accent } = emailBrand({ ...UNBRANDED, brandColor: "#1e3a8a" }, "Acme");
    expect(accent.accent.toLowerCase()).toBe("#1e3a8a");
  });
});

describe("escapeHtml", () => {
  it("neutralises the characters that end an attribute or open a tag", () => {
    expect(escapeHtml('<b>"&"</b>')).toBe("&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;");
  });
});

describe("shell", () => {
  it("prints the brand name as TEXT, so a blocked image still identifies the sender", () => {
    const html = shell(emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Acme"), "<p>hi</p>");
    expect(html).toContain("Rio Roofing");
    expect(html).not.toContain("<img");
  });

  it("escapes a brand name that contains markup", () => {
    const html = shell(emailBrand({ ...UNBRANDED, brandName: "<script>x</script>" }, "Acme"), "<p>hi</p>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps layout in tables and styles inline, because email clients demand it", () => {
    const html = shell(emailBrand(UNBRANDED, "Acme"), "<p>hi</p>");
    expect(html).toContain("<table");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
  });
});

describe("button", () => {
  it("paints the resolved accent and its readable foreground", () => {
    const brand = emailBrand({ ...UNBRANDED, brandColor: "#1e3a8a" }, "Acme");
    const html = button(brand, "https://example.com/x", "Open");
    expect(html).toContain(`background-color:${brand.accent.accent}`);
    expect(html).toContain(`color:${brand.accent.accentForeground}`);
    expect(html).toContain('href="https://example.com/x"');
  });
});
