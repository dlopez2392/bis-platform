// apps/web/src/lib/dashboard/relative-time.ts
//
// "10m" / "3h" / "2d" — the activity feed's per-row timestamp (Task 7).
// Purely instant-to-instant arithmetic (epoch milliseconds in, a bucket
// label out) — no Intl, no timezone, unlike every OTHER date helper in this
// directory (day-label.ts, greeting.ts, metrics.ts all read the account's
// zone). "10 minutes ago" is the same fact in every zone; there is nothing
// here for the recorded Americas-previous-day class of bug to hide in.

import type { Locale } from "@/lib/i18n/locale";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * `createdAtIso` is the event's own timestamp; `nowMs` is caller-injected —
 * never read from `Date.now()` in here — so a test can pin an exact diff,
 * the same discipline `booking.ts`'s own `nowIso` doc comment requires of
 * every "how long ago" helper in this codebase. Clamped at 0: an event
 * timestamped slightly in the future (clock skew between the DB and the
 * rendering server) reads "now" rather than a nonsensical negative bucket.
 *
 * `locale` (I-2, S-10 review): optional, default "en", so every existing
 * call site (activity-card.tsx, and the contact drawer) is unaffected. Only
 * "now"/"ahora" is a full word that needs translating; the m/h/d suffixes
 * stay — minuto, hora and día all start with the same letter in Spanish as
 * their English twins, so there is no catalogue read to add here.
 */
export function relativeTime(createdAtIso: string, nowMs: number, locale: Locale = "en"): string {
  const createdAtMs = new Date(createdAtIso).getTime();
  // An unparseable timestamp must not fall through to `${NaN}d` — every
  // comparison against NaN is false, so without this guard a bad ISO string
  // silently renders as the literal text "NaNd". Callers (contact-drawer.tsx,
  // activity-card.tsx) drop this straight into a <span>, so an empty string
  // is the honest "nothing to show" rather than invented copy.
  if (Number.isNaN(createdAtMs)) return "";
  const diff = Math.max(0, nowMs - createdAtMs);
  if (diff < MINUTE_MS) return locale === "es" ? "ahora" : "now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h`;
  return `${Math.floor(diff / DAY_MS)}d`;
}
