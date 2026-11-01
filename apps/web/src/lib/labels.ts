import type { NewMessage } from "@bis/db";
import type { Locale } from "./i18n/locale";
import { t, type CatalogueKey } from "./i18n/t";
import { m, type MessageKey } from "./messages";

// S-10 T1: each table maps a DB value to its catalogue KEY, so a label can be
// read in either language (`labelIn`); the English `*_LABEL` constants are
// kept, word for word, for the callers that have not moved yet (a test pins
// each constant to its key table, so the two cannot drift).

/** Opportunity `status` column -> its key. Shared so the pipeline drawer,
 *  contact detail page, and activity timeline never drift on wording (the raw
 *  DB value is lowercase, e.g. "won" — never render it directly). */
export const OPPORTUNITY_STATUS_KEY = {
  open: "pipeline.status.open",
  won: "pipeline.status.won",
  lost: "pipeline.status.lost",
} as const satisfies Record<string, MessageKey>;

/** Account `status` column -> its key. */
export const ACCOUNT_STATUS_KEY = {
  active: "accounts.status.active",
  paused: "accounts.status.paused",
  archived: "accounts.status.archived",
} as const satisfies Record<string, MessageKey>;

/** Message `status` column -> its key. */
export const MESSAGE_STATUS_KEY = {
  queued: "conversations.status.queued",
  sent: "conversations.status.sent",
  delivered: "conversations.status.delivered",
  opened: "conversations.status.opened",
  bounced: "conversations.status.bounced",
  failed: "conversations.status.failed",
} as const satisfies Record<string, MessageKey>;

/** Form `status` column -> its key. */
export const FORM_STATUS_KEY = {
  draft: "forms.status.draft",
  published: "forms.status.published",
  archived: "forms.status.archived",
} as const satisfies Record<string, MessageKey>;

/** A DB value's label in the reader's language, through the table's key;
 *  a value the table does not know comes back as itself, the same fallback
 *  `messageChannelLabel` has always had. */
export function labelIn<C extends Readonly<Record<string, string>> = typeof m>(
  table: Readonly<Record<string, CatalogueKey<C>>>, value: string, locale: Locale = "en",
  catalogue: C = m as unknown as C,
): string {
  return Object.hasOwn(table, value) ? t(catalogue, table[value]!, locale) : value;
}

// The English constants below stay as direct reads ON PURPOSE (S-10 review
// I-1): each is English whatever the reader's language, so the G3 ratchet
// keeps counting them until every caller has moved to `labelIn`.
export const STATUS_LABEL: Record<string, string> = {
  open: m["pipeline.status.open"],
  won: m["pipeline.status.won"],
  lost: m["pipeline.status.lost"],
};

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: m["accounts.status.active"],
  paused: m["accounts.status.paused"],
  archived: m["accounts.status.archived"],
};

export const MESSAGE_STATUS_LABEL: Record<string, string> = {
  queued: m["conversations.status.queued"],
  sent: m["conversations.status.sent"],
  delivered: m["conversations.status.delivered"],
  opened: m["conversations.status.opened"],
  bounced: m["conversations.status.bounced"],
  failed: m["conversations.status.failed"],
};

export const FORM_STATUS_LABEL: Record<string, string> = {
  draft: m["forms.status.draft"],
  published: m["forms.status.published"],
  archived: m["forms.status.archived"],
};

/** Message `channel` column -> its catalogue key (S-06 part 3, spec G8), so a label can be read in
 *  either language; exhaustive over the union for the same reason as the map below. */
const CHANNEL_KEY: Record<NewMessage["channel"], MessageKey> = {
  email: "conversations.channel.email",
  form: "conversations.channel.form",
  voice: "conversations.channel.voice",
  sms: "conversations.channel.sms",
  // S-06 part 3: a lead's website chat on the thread.
  webchat: "conversations.channel.webchat",
};

/** Message `channel` column -> display label. A form submission must never be
 *  labelled "Note": the words are the contact's own, not the operator's.
 *
 *  Typed to the full channel union, not `Record<string, string>` — the
 *  previous shape let a call site fall through to `?? message.channel` and
 *  render the raw DB value (e.g. the literal string "sms") for any channel
 *  missing an entry here, with no compiler check that every channel has
 *  one. Dropping a key now is a compile error instead of a silent runtime
 *  gap. S-06 part 3: these are the English labels; a reader in another
 *  language goes through `messageChannelLabel(channel, locale)`. */
export const MESSAGE_CHANNEL_LABEL: Record<NewMessage["channel"], string> = {
  email: m["conversations.channel.email"],
  form: m["conversations.channel.form"],
  voice: m["conversations.channel.voice"],
  sms: m["conversations.channel.sms"],
  webchat: m["conversations.channel.webchat"],
};

/** The one place that widens an untyped DB `channel` string against
 *  MESSAGE_CHANNEL_LABEL. The Supabase client here is untyped (no generated
 *  schema types), so a raw `.select()` column comes back as `string`, not
 *  `NewMessage["channel"]` — every call site used to re-cast it locally
 *  (message-thread.tsx did, and activity-timeline.tsx was about to grow a
 *  second copy). One helper means the widening — and its fallback to the raw
 *  value for anything outside the known union — happens exactly once, while
 *  MESSAGE_CHANNEL_LABEL itself stays exhaustively typed and a dropped key is
 *  still a compile error. S-06 part 3 (spec G8): in the reader's `locale` (English by default, so
 *  every existing caller reads exactly what it did), through the catalogue's `.es` twins. */
export function messageChannelLabel(channel: string, locale: Locale = "en"): string {
  return labelIn(CHANNEL_KEY, channel, locale);
}
