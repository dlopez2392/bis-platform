import { m } from "@/lib/messages";

/**
 * Accepts only a value that is one of the listed options (an enum column,
 * e.g. `accounts.language`'s "en"/"es"), never a free-typed string — the
 * control's own option list is the only source of valid values, so a value
 * that is not among them cannot have come from the control working
 * normally. Exact comparison: no trimming, no case folding.
 *
 * A plain module, not inline-field.tsx: that file is "use client", and a
 * server action importing from it gets a client REFERENCE, not a callable
 * function. Living here, the SAME check runs in InlineField's `options` arm
 * (the optimistic client check) and in `setAccountLanguageAction` (the
 * authoritative server one), so the two can never disagree about a value —
 * the reasoning `normalizeRequired`'s own doc gives for `setup.rename.empty`.
 */
export function validateEnumValue<V extends string>(
  options: readonly { value: V; label: string }[], raw: string,
): { ok: true; value: V } | { ok: false; error: string } {
  const hit = options.find((o) => o.value === raw);
  return hit ? { ok: true, value: hit.value } : { ok: false, error: m["inline.invalidOption"] };
}
