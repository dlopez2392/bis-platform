import { m } from "@/lib/messages";

/**
 * The /u page's words (spec §6), client-safe. English and Spanish are always
 * shown together: the token carries no language. {Business} is the brand
 * name exactly as the business wrote it; a blank one becomes "the business" /
 * "el negocio", capitalised where it starts a sentence, and "de el" contracts
 * to "del" (the fallback only — a brand name is never rewritten).
 */
/** `ask` is the question with its one primary "Stop emails" (decisions Q1, P2). */
export type UnsubscribeState = "ask" | "stopped" | "resubscribed" | "bad_link" | "failed";

export function fillBusiness(template: string, brandName: string | null, lang: "en" | "es"): string {
  const brand = brandName?.trim();
  if (brand) return template.split("{Business}").join(brand);
  const fallback = m[`unsubscribe.business.${lang}`];
  const capital = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  let out = "";
  const parts = template.split("{Business}");
  parts.forEach((part, i) => {
    out += part;
    if (i === parts.length - 1) return;
    const startsSentence = out.trim() === "" || /[.?!]\s*$/.test(out);
    out += startsSentence ? capital : fallback;
  });
  return lang === "es" ? out.split(" de el ").join(" del ") : out;
}

export function pageLines(state: UnsubscribeState, brandName: string | null): {
  en: string; es: string; detailEn: string | null; detailEs: string | null;
} {
  const both = (key: "confirm" | "done" | "resubscribed" | "badLink" | "failed") => ({
    en: fillBusiness(m[`unsubscribe.${key}.en`], brandName, "en"),
    es: fillBusiness(m[`unsubscribe.${key}.es`], brandName, "es"),
  });
  switch (state) {
    case "ask":
      return {
        ...both("confirm"),
        detailEn: fillBusiness(m["unsubscribe.confirmBody.en"], brandName, "en"),
        detailEs: fillBusiness(m["unsubscribe.confirmBody.es"], brandName, "es"),
      };
    case "stopped": return { ...both("done"), detailEn: null, detailEs: null };
    case "resubscribed": return { ...both("resubscribed"), detailEn: null, detailEs: null };
    case "bad_link": return { ...both("badLink"), detailEn: null, detailEs: null };
    case "failed": return { ...both("failed"), detailEn: null, detailEs: null };
  }
}
