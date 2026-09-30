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

// A comma is accepted ONLY as a proper thousands group (exactly 3 digits per
// group, first group 1-3 digits) — otherwise plain digits with no comma at
// all. Stripping every comma before validating (the earlier shape of this
// regex) let "49,00" read as 4,900 dollars: a decimal comma or a fat-fingered
// key next to the period would have silently billed 100x.
const DOLLAR_MAGNITUDE = /^(?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{1,2})?$/;
const WHOLE_MAGNITUDE = /^(?:\d{1,3}(?:,\d{3})+|\d{1,7})$/;

/** "49", "49.5", "$1,049.00" → cents, by integer arithmetic: parseFloat
 *  would turn "0.29" into 28.999... cents. */
export function parseDollarsToCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "");
  if (!DOLLAR_MAGNITUDE.test(s)) return null;
  const digits = s.replace(/,/g, "");
  const [whole = "0", frac = ""] = digits.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function parseWholeNumber(raw: string): number | null {
  const s = raw.trim();
  return WHOLE_MAGNITUDE.test(s) ? Number(s.replace(/,/g, "")) : null;
}

function assertCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`cents must be a non-negative integer, got ${cents}`);
  }
}

/** The value an input shows: 4900 → "49.00", 3 → "0.03". */
export function centsToDollars(cents: number): string {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** The value a reader sees: 104900 → "$1,049.00". */
export function formatCents(cents: number): string {
  assertCents(cents);
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

export type PlanFormResult = { ok: true; terms: PlanTerms } | { ok: false; error: string };

const fail = (error: string): PlanFormResult => ({ ok: false, error });
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

// Blank after trim, OR nothing but whitespace/format characters (e.g. a
// zero-width space, ​): both read as "no name" to a human, so both get
// the same message the empty-string case already uses.
const BLANK_NAME = /^[\s\p{Cf}]*$/u;

export function parsePlanForm(form: FormData): PlanFormResult {
  const name = text(form, "name").trim();
  if (BLANK_NAME.test(name)) return fail(m["plans.error.nameRequired"]);
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
