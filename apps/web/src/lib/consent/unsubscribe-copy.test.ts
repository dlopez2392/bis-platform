import { describe, it, expect } from "vitest";
import { pageLines, fillBusiness } from "./unsubscribe-copy";
import { m } from "@/lib/messages";

describe("fillBusiness", () => {
  it("puts the brand name in as it is written, and a blank brand becomes 'the business' / 'el negocio', capitalised where it starts a sentence (mutation: capitalise the brand too → 'rio roofing' becomes 'Rio roofing', FAILS)", () => {
    expect(fillBusiness("{Business} will stop.", "rio roofing", "en")).toBe("rio roofing will stop.");
    expect(fillBusiness("{Business} will stop.", null, "en")).toBe("The business will stop.");
    expect(fillBusiness("Stop emails from {Business}?", "  ", "en")).toBe("Stop emails from the business?");
    expect(fillBusiness("Listo. {Business} ya no le enviará.", null, "es")).toBe("Listo. El negocio ya no le enviará.");
    expect(fillBusiness("Volverá a recibir correos de {Business}.", null, "es")).toBe("Volverá a recibir correos del negocio.");
    expect(fillBusiness("Volverá a recibir correos de {Business}.", "El Taller", "es")).toBe("Volverá a recibir correos de El Taller.");
  });
});

describe("pageLines — spec §6, English and Spanish stacked", () => {
  it("stopped: the spec's unsubscribed lines, the business named (mutation: show the confirm question → FAILS)", () => {
    expect(pageLines("stopped", "Rio Roofing")).toEqual({
      en: m["unsubscribe.done.en"].replace("{Business}", "Rio Roofing"),
      es: m["unsubscribe.done.es"].replace("{Business}", "Rio Roofing"),
      detailEn: null, detailEs: null,
    });
  });

  it("ask (decision Q1): the question and what it means, in both languages", () => {
    const l = pageLines("ask", "Rio Roofing");
    expect([l.en, l.es]).toEqual(["Stop emails from Rio Roofing?", "¿Dejar de recibir correos de Rio Roofing?"]);
    expect(l.detailEn).toMatch(/^Rio Roofing will stop sending you automated emails\./);
    expect(l.detailEs).toMatch(/^Rio Roofing dejará de enviarle correos automáticos\./);
  });

  it("resubscribed, bad_link and failed say the spec's (or this plan's) words (mutation: bad_link shows 'failed' → FAILS)", () => {
    expect(pageLines("resubscribed", "Rio Roofing").en).toBe("You'll get emails from Rio Roofing again.");
    // A bad link names no business: the fallback, mid-sentence (review R1-M2's line).
    expect(pageLines("bad_link", null)).toMatchObject({
      en: "This unsubscribe link doesn't work. Contact the business directly and ask them to stop.",
      es: "Este enlace no funciona. Comuníquese directamente con el negocio y pida que dejen de escribirle.",
    });
    expect(pageLines("failed", null)).toMatchObject({ en: m["unsubscribe.failed.en"], es: m["unsubscribe.failed.es"] });
  });
});
