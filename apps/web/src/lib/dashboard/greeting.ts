// apps/web/src/lib/dashboard/greeting.ts
//
// Pure helpers for the in-account dashboard's greeting header (Task 5). Same
// discipline as metrics.ts: no React, no I/O, zone-correct via the sanctioned
// `partsInZone` primitive (booking/slots.ts) — never an un-pinned
// `Intl.DateTimeFormat` reading the SYSTEM zone.
import { partsInZone } from "@/lib/booking/slots";
import { tag } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";

export type GreetingPeriod = "morning" | "afternoon" | "evening";

/**
 * Time-of-day bucket for "Good {period}, {name}", read from the ACCOUNT's
 * local wall clock — never the system zone. Boundaries: 05:00-11:59 local is
 * morning, 12:00-16:59 is afternoon, everything else (17:00-04:59, including
 * the small hours) is evening. There is no fourth "night" bucket to greet
 * with — an owner opening the dashboard at 2am still reads "good evening" as
 * the closer of the two options, not a wrong one.
 */
export function greetingPeriod(now: Date, timezone: string): GreetingPeriod {
  const { hh } = partsInZone(now, timezone);
  if (hh >= 5 && hh < 12) return "morning";
  if (hh >= 12 && hh < 17) return "afternoon";
  return "evening";
}

/**
 * The greeting sub-line's local long date ("Monday, August 31, 2026",
 * "sábado, 3 de julio de 2027" in Spanish) — zone-pinned per `formatWhen`'s
 * own pattern (booking/time.ts): an explicit `timeZone` on the
 * `Intl.DateTimeFormat` call, never the system zone. `locale` was pinned to
 * "en-US" (S-10 T2, spec §3.1 row 2); optional, defaulting to "en" so every
 * existing call site is unaffected.
 */
export function formatLocalLongDate(now: Date, timezone: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}
