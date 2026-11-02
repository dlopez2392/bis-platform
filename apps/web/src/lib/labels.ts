import type { NewMessage } from "@bis/db";
import type { Locale } from "./i18n/locale";
import { t, type CatalogueKey } from "./i18n/t";
import { m, type MessageKey } from "./messages";

// S-10 T1: each table maps a DB value to its catalogue KEY, so a label can be
// read in either language (`labelIn`). S-10 T9b deleted the English-only
// `*_LABEL` constants T1 had kept "for the callers that have not moved
// yet" — every real caller had, by then.

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

// S-10 T9b: the five English-only `*_LABEL` constants that used to live
// here (STATUS_LABEL, ACCOUNT_STATUS_LABEL, MESSAGE_STATUS_LABEL,
// FORM_STATUS_LABEL, MESSAGE_CHANNEL_LABEL — T1's own comment called them
// "kept, word for word, for the callers that have not moved yet") are
// gone: every real caller had already moved to `labelIn`/
// `messageChannelLabel` (confirmed by grep — the few remaining mentions of
// their names were doc comments, not imports), except `accounts/page.tsx`
// (the agency's own Companies list), which now calls `labelIn` directly
// with its own English-literal locale, same as that page's own role
// default. Deleting the dead constants, not just their last caller, is
// what actually zeroes this file's direct-read count: the reads lived in
// the CONSTANTS' own initializers, not in who imported them.

/** Message `channel` column -> its catalogue key (S-06 part 3, spec G8), so a label can be read in
 *  either language; exhaustive over the union for the same reason
 *  `messageChannelLabel` is typed to the full union, not `Record<string, string>` —
 *  a dropped channel is a compile error here, never a silent runtime gap. */
const CHANNEL_KEY: Record<NewMessage["channel"], MessageKey> = {
  email: "conversations.channel.email",
  form: "conversations.channel.form",
  voice: "conversations.channel.voice",
  sms: "conversations.channel.sms",
  // S-06 part 3: a lead's website chat on the thread.
  webchat: "conversations.channel.webchat",
};

/** The one place that widens an untyped DB `channel` string against
 *  CHANNEL_KEY. The Supabase client here is untyped (no generated
 *  schema types), so a raw `.select()` column comes back as `string`, not
 *  `NewMessage["channel"]` — every call site used to re-cast it locally
 *  (message-thread.tsx did, and activity-timeline.tsx was about to grow a
 *  second copy). One helper means the widening — and its fallback to the raw
 *  value for anything outside the known union — happens exactly once, while
 *  CHANNEL_KEY itself stays exhaustively typed and a dropped key is
 *  still a compile error. S-06 part 3 (spec G8): in the reader's `locale` (English by default, so
 *  every existing caller reads exactly what it did), through the catalogue's `.es` twins. */
export function messageChannelLabel(channel: string, locale: Locale = "en"): string {
  return labelIn(CHANNEL_KEY, channel, locale);
}
