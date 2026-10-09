import { channelOf, aiAssistantNameOf } from "@/lib/website/channel";
import { m } from "@/lib/messages";

/**
 * F-157 (docs/crm-features.md §4.3 rider 6): the drawer's one Source line.
 * Two parts, deliberately not merged into one editable string: `source`
 * (the raw column, EDITABLE_FIELDS — see lib/contacts/field-input.ts) is
 * whatever an operator typed or a creation path recorded ("voice",
 * "booking", "form: Contact us", a CSV import's own free text, or the
 * owner's own note once they edit it), and `contactSourceHint` below is the
 * system's own OBSERVED fact next to it — never something to overwrite by
 * hand, which is why it has no `save` path of its own.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `contacts.custom`'s `referred_by` key — the source question's answer
 *  (F-018, folded into F-157), written by `enrich.ts` when a form carries a
 *  `core.referral_source` field and the visitor answered it. Never trusted
 *  shape: this jsonb column also holds whatever a form's OWN custom fields
 *  put there, attacker- and operator-influenced either way. */
function referredByFrom(custom: unknown): string | null {
  if (!isRecord(custom)) return null;
  const value = custom.referred_by;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * The first-touch `ref` (document.referrer, forwarded by embed.js or a
 * form/booking page's own `?ref=`) classified for a human line: the
 * SPECIFIC assistant name when `aiAssistantNameOf` recognises the
 * hostname, else the Website section's own bucket — "Direct" excluded,
 * since saying "Found through Direct" states nothing a visitor couldn't
 * already guess, and empty attribution must read the same as no signal at
 * all, never as a real channel.
 */
function channelFrom(attribution: unknown): string | null {
  if (!isRecord(attribution)) return null;
  const first = attribution.first;
  if (!isRecord(first)) return null;
  const ref = first.ref;
  if (typeof ref !== "string" || !ref) return null;
  let host: string;
  try {
    host = new URL(ref).hostname;
  } catch {
    return null;
  }
  const specific = aiAssistantNameOf(host);
  if (specific) return specific;
  const channel = channelOf(host);
  return channel === "Direct" ? null : channel;
}

export function contactSourceHint(input: {
  source: string | null;
  /** `contacts.custom` as stored — unchecked jsonb. */
  custom: unknown;
  /** `contacts.attribution` as stored — unchecked jsonb,
   *  `{ first?: Record<string,string>; last?: Record<string,string> }`
   *  when it was `setAttribution` that wrote it. */
  attribution: unknown;
}): string | null {
  const referredBy = referredByFrom(input.custom);
  if (referredBy) return m["contact.source.referredBy"].replace("{name}", referredBy);

  const channel = channelFrom(input.attribution);
  if (channel) return m["contact.source.foundThrough"].replace("{channel}", channel);

  if (!input.source) return m["contact.source.unknown"];
  return null;
}
