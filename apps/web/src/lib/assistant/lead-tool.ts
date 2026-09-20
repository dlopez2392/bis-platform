import { z } from "zod";
import type { FormField } from "@bis/db";

/**
 * The `capture_lead` tool's input schema is BUILT FROM THE FORM. The client's
 * published form already says which fields a lead has and which are
 * required; the assistant asks for exactly those and files exactly those, so
 * a client who adds "Best time to call" to their form gets an assistant that
 * asks for it, with no code change. Consent fields are never part of it — a
 * conversation cannot tick a box (see `lib/forms/intake.ts`).
 */
export const LEAD_VALUE_MAX = 500;

export function leadFields(fields: FormField[]): FormField[] {
  return fields.filter((f) => f.kind !== "consent");
}

export function leadInputSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of leadFields(fields)) {
    const base = z.string().max(LEAD_VALUE_MAX).describe(f.label);
    shape[f.key] = f.required ? base.min(1) : base.optional();
  }
  return z.object(shape);
}

/** One line per field for the prompt: "First name (required)". */
export function describeLeadFields(fields: FormField[]): string {
  return leadFields(fields)
    .map((f) => `${f.label}${f.required ? " (required)" : " (optional)"}`)
    .join("; ");
}
