// S-47c (spec section 5.1; C2, C16, C18): the ONE place a price becomes words. Sofía reads only these sentences,
// so every template here is model input that reaches a live call. The twelve are the owner's read of 2026-10-23;
// changing one means bumping KNOWLEDGE_RENDERER_VERSION in ./payload.ts (spec 4.2), and price-sentence.test.ts
// pins every one as a literal. Pure; relative imports only (the corpus runner loads this under tsx).

/** The twin of voice_services_price_kind_check (0095), owned by the db package. A TYPE-only import: erased at
 *  run time, so the corpus runner's tsx graph never loads @bis/db. */
import type { PriceKind } from "@bis/db";
export type { PriceKind };
/** In the order the Voice page's Select lists them. */
export const PRICE_KINDS = ["fixed", "from", "range", "per_unit", "free", "after_visit"] as const satisfies readonly PriceKind[];

export type PricedService = {
  name_en: string; name_es: string | null; price_kind: PriceKind;
  amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};

/** US dollars, the same en-US form in both languages (the RGV market writes and says "$1,200"): whole dollars
 *  without cents, otherwise two decimals. Integer arithmetic, no locale lookup. */
export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`formatUsd: not a whole number of cents: ${String(cents)}`);
  const dollars = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}

function need<T>(v: T | null, what: string, kind: PriceKind): T {
  if (v === null || v === undefined) throw new Error(`priceSentence: a ${kind} price needs ${what}`);
  return v;
}

/** "The price for {N} …": the frame avoids articles, so no name ever needs a gender (spec 5.1). Throws on any shape
 *  voice_services_price_shape_check refuses; a stored row can never reach that (the CHECK), and the Voice page's
 *  preview never calls this on an incomplete row (Task 8). */
export function priceSentence(s: PricedService, lang: "en" | "es"): string {
  const en = lang === "en";
  const name = en ? s.name_en : (s.name_es ?? s.name_en);
  switch (s.price_kind) {
    case "fixed": {
      const a = formatUsd(need(s.amount_cents, "an amount", s.price_kind));
      return en ? `The price for ${name} is ${a}.` : `El precio de ${name} es ${a}.`;
    }
    case "from": {
      const a = formatUsd(need(s.amount_cents, "an amount", s.price_kind));
      return en ? `The price for ${name} starts at ${a}.` : `El precio de ${name} es desde ${a}.`;
    }
    case "range": {
      const lo = need(s.amount_cents, "an amount", s.price_kind);
      const hi = need(s.amount_max_cents, "a maximum", s.price_kind);
      if (hi <= lo) throw new Error("priceSentence: a range needs its maximum above its amount");
      return en ? `The price for ${name} is between ${formatUsd(lo)} and ${formatUsd(hi)}.`
        : `El precio de ${name} es de ${formatUsd(lo)} a ${formatUsd(hi)}.`;
    }
    case "per_unit": {
      const a = formatUsd(need(s.amount_cents, "an amount", s.price_kind));
      // C16: both units are required; the Spanish never falls back to the English unit.
      const u = need(en ? s.unit_en : s.unit_es, en ? "an English unit" : "a Spanish unit", s.price_kind);
      return en ? `The price for ${name} is ${a} per ${u}.` : `El precio de ${name} es ${a} por ${u}.`;
    }
    case "free":
      return en ? `There is no charge for ${name}.` : `${name} no tiene costo.`;
    case "after_visit":
      return en ? `The price for ${name} is given after a visit.` : `El precio de ${name} se lo damos después de una visita.`;
  }
}
