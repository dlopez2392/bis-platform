import { describe, it, expect } from "vitest";
import { reviewCheckinEmail } from "./review-checkin";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: "https://cdn.example.com/rio.png",
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const LINK = "https://app.bis-rgv.com/r/1.abc.def";
const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("reviewCheckinEmail (F-072, plan D6)", () => {
  it("English: the subject, the one question and the one button, exactly as decided", () => {
    const { subject, html, text } = reviewCheckinEmail({ brand, checkinUrl: LINK });
    expect(subject).toBe("How did we do, Rio Roofing?");
    expect(html).toContain('<p style="margin:0 0 12px;">Thanks for choosing Rio Roofing. One quick question: how did we do?</p>');
    expect(html).toContain(">Tell us how we did</a>");
    expect(text).toBe(`Thanks for choosing Rio Roofing. One quick question: how did we do?\n\n${LINK}`);
  });

  it("Spanish, usted: the subject, the question and the button, exactly as decided, subject through button", () => {
    const { subject, html, text } = reviewCheckinEmail({ brand, checkinUrl: LINK, locale: "es" });
    expect(subject).toBe("¿Cómo le fue con Rio Roofing?");
    expect(html).toContain("Gracias por elegir a Rio Roofing. Una pregunta rápida: ¿cómo le fue?");
    expect(html).toContain(">Cuéntenos cómo nos fue</a>");
    expect(text).toBe(`Gracias por elegir a Rio Roofing. Una pregunta rápida: ¿cómo le fue?\n\n${LINK}`);
  });

  it("carries the brand: its name in the subject and body, its logo in the shell (rule 9), never an internal label", () => {
    const { subject, html } = reviewCheckinEmail({ brand, checkinUrl: LINK });
    expect(subject).toContain("Rio Roofing");
    expect(html).toContain("https://cdn.example.com/rio.png");
    expect(html).not.toContain("Rio Roofing — trial");
  });

  for (const locale of ["en", "es"] as const) {
    describe(locale, () => {
      const { subject, html, text } = reviewCheckinEmail({ brand, checkinUrl: LINK, locale });

      it("has ONE link, the same one, in both the html and the text part", () => {
        expect(hrefsOf(html)).toEqual([LINK]);
        expect(text.match(/https?:\/\/\S+/g)).toEqual([LINK]);
      });

      it("never mentions a review: the check-in is not a filter in front of one (plan D1)", () => {
        const all = `${subject}\n${html}\n${text}`;
        expect(all).not.toMatch(/review|reseña|calific|stars|estrellas|google/i);
      });

      it("carries no template syntax and no internal milestone code", () => {
        const all = `${subject}\n${html}\n${text}`;
        expect(all).not.toMatch(/\{\{|\}\}|\{name\}|\$\{/);
        expect(all).not.toMatch(INTERNAL_MILESTONE);
      });
    });
  }

  it("escapes a brand name with markup (it is the client's text, not ours)", () => {
    const { html } = reviewCheckinEmail({ brand: { ...brand, name: "A <b>&</b> B" }, checkinUrl: LINK });
    expect(html).toContain("A &lt;b&gt;&amp;&lt;/b&gt; B");
    expect(html).not.toContain("<b>&</b>");
  });
});
