import { METER_KEYS, type MeterAmounts, type PlanTerms } from "@bis/db";
import { m } from "@/lib/messages";

/**
 * The Plans dialog's form, parsed into integer cents. The bounds are
 * 0051's CHECKs, repeated so the operator gets a sentence instead of a
 * 23514; the database stays the authority.
 */
export const PLAN_LIMITS = {
  nameMax: 60,
  monthlyMinCents: 50,
  monthlyMaxCents: 1_000_000,
  allowanceMax: 1_000_000,
  overageMaxCents: 10_000,
} as const;

const DOLLARS = /^\d{1,7}(\.\d{1,2})?$/;
const WHOLE = /^\d{1,7}$/;

/** "49", "49.5", "$1,049.00" → cents, by integer arithmetic: parseFloat
 *  would turn "0.29" into 28.999... cents. */
export function parseDollarsToCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!DOLLARS.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function parseWholeNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  return WHOLE.test(s) ? Number(s) : null;
}

/** The value an input shows: 4900 → "49.00", 3 → "0.03". */
export function centsToDollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** The value a reader sees: 104900 → "$1,049.00". */
export function formatCents(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

export type PlanFormResult = { ok: true; terms: PlanTerms } | { ok: false; error: string };

const fail = (error: string): PlanFormResult => ({ ok: false, error });
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export function parsePlanForm(form: FormData): PlanFormResult {
  const name = text(form, "name").trim();
  if (!name) return fail(m["plans.error.nameRequired"]);
  // Code points, as Postgres's char_length counts them, not UTF-16 units.
  if ([...name].length > PLAN_LIMITS.nameMax) return fail(m["plans.error.nameTooLong"]);

  const monthly = parseDollarsToCents(text(form, "monthlyPrice"));
  if (monthly === null || monthly < PLAN_LIMITS.monthlyMinCents || monthly > PLAN_LIMITS.monthlyMaxCents) {
    return fail(m["plans.error.monthlyPrice"]);
  }

  const allowances = {} as MeterAmounts;
  const overageCents = {} as MeterAmounts;
  for (const key of METER_KEYS) {
    const allowance = parseWholeNumber(text(form, `allowance.${key}`));
    if (allowance === null || allowance > PLAN_LIMITS.allowanceMax) return fail(m[`plans.error.allowance.${key}`]);
    const overage = parseDollarsToCents(text(form, `overage.${key}`));
    if (overage === null || overage > PLAN_LIMITS.overageMaxCents) return fail(m[`plans.error.overage.${key}`]);
    allowances[key] = allowance;
    overageCents[key] = overage;
  }

  return {
    ok: true,
    terms: {
      name, monthlyPriceCents: monthly,
      features: {
        voice_receptionist: form.get("feature.voice_receptionist") === "on",
        web_concierge: form.get("feature.web_concierge") === "on",
      },
      allowances, overageCents,
    },
  };
}
