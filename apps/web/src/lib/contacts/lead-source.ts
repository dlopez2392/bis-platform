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

/** Lowercased, with a leading "www." stripped — "www.example.com" and
 *  "example.com" are the same site for this comparison. */
function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
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
function channelFromRef(first: Record<string, unknown>): string | null {
  const ref = first.ref;
  if (typeof ref !== "string" || !ref) return null;
  let host: string;
  try {
    host = new URL(ref).hostname;
  } catch {
    return null;
  }
  // Review round 1, I2: a referrer on the CLIENT'S OWN site — the visitor
  // merely clicked from one of the client's own pages to the one carrying
  // the embedded form (embed-script.ts's `document.referrer` is the HOST
  // page's own referrer; it is not asking what sent the WIDGET its visit)
  // — states nothing about where the LEAD came from and must read the
  // same as no signal at all, never as a real channel ("Other websites").
  // `page` is the SAME touch's host-page URL (embed-script.ts's own
  // `window.location.href`), so the two hostnames are directly comparable.
  const page = first.page;
  if (typeof page === "string" && page) {
    try {
      if (normaliseHost(host) === normaliseHost(new URL(page).hostname)) return null;
    } catch {
      // A malformed `page` is not this function's problem — classify `ref`
      // on its own, same as if `page` had been absent.
    }
  }
  const specific = aiAssistantNameOf(host);
  if (specific) return specific;
  const channel = channelOf(host);
  return channel === "Direct" ? null : channel;
}

/**
 * Review round 1, m7. ASSUMPTION, unverified against any real traffic in
 * this repo or its docs: some AI assistants are commonly reported to
 * append `utm_source` to shared links (e.g. `utm_source=chatgpt.com`).
 * `parseAttribution` (lib/forms/guards.ts) already lifts `utm_source` off
 * the host page's own query string exactly like every other UTM key
 * (embed-script.ts forwards it the same way it forwards `ref`), so the
 * value, when present, is read here as a hostname-SHAPED string — the
 * SAME `aiAssistantNameOf` list channel.ts carries for this rider, not an
 * independently confirmed set of real values AI assistants actually send.
 * Checked ONLY once `ref` itself gave no signal (channelFromRef above
 * returned null) — a real referrer always outranks a marketing tag.
 */
function channelFromUtmSource(first: Record<string, unknown>): string | null {
  const utmSource = first.utm_source;
  if (typeof utmSource !== "string" || !utmSource) return null;
  return aiAssistantNameOf(utmSource);
}

function channelFrom(attribution: unknown): string | null {
  if (!isRecord(attribution)) return null;
  const first = attribution.first;
  if (!isRecord(first)) return null;
  return channelFromRef(first) ?? channelFromUtmSource(first);
}

/**
 * Review round 1, m3: the raw machine values `source` stores at creation
 * — "voice" (a call), "booking" (the booking page), "form: {name}" (a
 * form's own submission) — each gets a humanized caption beside the
 * (still raw, still editable) value, never replacing it. An owner's own
 * typed note (anything else — a CSV import's free text, a manual
 * correction) matches none of these and gets no caption: there is nothing
 * machine-made to translate.
 */
function machineSourceCaption(source: string): string | null {
  if (source === "voice") return m["contact.source.machine.voice"];
  if (source === "booking") return m["contact.source.machine.booking"];
  const formMatch = /^form: (.+)$/.exec(source);
  if (formMatch) return m["contact.source.machine.form"].replace("{name}", () => formMatch[1]!);
  return null;
}

/**
 * Review round 1, m2: the drawer's DISPLAYED hint, clamped — an operator's
 * own typed `custom.referred_by` answer (or `source`, via CSV import) can
 * be arbitrarily long, and `contactSourceHint` itself carries no limit
 * (its return value is the full fact; `source-field.tsx` keeps that full
 * text for `title`/`aria-label` and shows this clamped form in the line
 * itself). `<=`, not `<`: a hint exactly at the limit is not clamped.
 */
const HINT_DISPLAY_LIMIT = 120;

export function clampHint(hint: string): string {
  if (hint.length <= HINT_DISPLAY_LIMIT) return hint;
  return `${hint.slice(0, HINT_DISPLAY_LIMIT)}…`;
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
  // Function replacements, not string ones (review round 1, m1):
  // `String.prototype.replace` treats a STRING replacement's `$&`/`$1`/`$$`
  // specially — a referral answer or a channel name containing a literal
  // "$&" would otherwise have it swapped for the matched placeholder text
  // itself. A function's return value is inserted verbatim.
  const referredBy = referredByFrom(input.custom);
  if (referredBy) return m["contact.source.referredBy"].replace("{name}", () => referredBy);

  const channel = channelFrom(input.attribution);
  if (channel) return m["contact.source.foundThrough"].replace("{channel}", () => channel);

  if (input.source) return machineSourceCaption(input.source);
  return m["contact.source.unknown"];
}
