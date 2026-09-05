import type { NewMessage } from "@bis/db";
import { m } from "./messages";

/** Opportunity `status` column -> display label. Shared so the pipeline drawer,
 *  contact detail page, and activity timeline never drift on wording (the raw
 *  DB value is lowercase, e.g. "won" — never render it directly). */
export const STATUS_LABEL: Record<string, string> = {
  open: m["pipeline.status.open"],
  won: m["pipeline.status.won"],
  lost: m["pipeline.status.lost"],
};

/** Account `status` column -> display label. */
export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: m["accounts.status.active"],
  paused: m["accounts.status.paused"],
  archived: m["accounts.status.archived"],
};

/** Message `status` column -> display label. */
export const MESSAGE_STATUS_LABEL: Record<string, string> = {
  queued: m["conversations.status.queued"],
  sent: m["conversations.status.sent"],
  delivered: m["conversations.status.delivered"],
  opened: m["conversations.status.opened"],
  bounced: m["conversations.status.bounced"],
  failed: m["conversations.status.failed"],
};

/** Form `status` column -> display label. */
export const FORM_STATUS_LABEL: Record<string, string> = {
  draft: m["forms.status.draft"],
  published: m["forms.status.published"],
  archived: m["forms.status.archived"],
};

/** Message `channel` column -> display label. A form submission must never be
 *  labelled "Note": the words are the contact's own, not the operator's.
 *
 *  Typed to the full channel union, not `Record<string, string>` — the
 *  previous shape let a call site fall through to `?? message.channel` and
 *  render the raw DB value (e.g. the literal string "sms") for any channel
 *  missing an entry here, with no compiler check that every channel has
 *  one. Dropping a key now is a compile error instead of a silent runtime
 *  gap. */
export const MESSAGE_CHANNEL_LABEL: Record<NewMessage["channel"], string> = {
  email: m["conversations.channel.email"],
  form: m["conversations.channel.form"],
  voice: m["conversations.channel.voice"],
  sms: m["conversations.channel.sms"],
};

/** The one place that widens an untyped DB `channel` string against
 *  MESSAGE_CHANNEL_LABEL. The Supabase client here is untyped (no generated
 *  schema types), so a raw `.select()` column comes back as `string`, not
 *  `NewMessage["channel"]` — every call site used to re-cast it locally
 *  (message-thread.tsx did, and activity-timeline.tsx was about to grow a
 *  second copy). One helper means the widening — and its fallback to the raw
 *  value for anything outside the known union — happens exactly once, while
 *  MESSAGE_CHANNEL_LABEL itself stays exhaustively typed and a dropped key is
 *  still a compile error. */
export function messageChannelLabel(channel: string): string {
  return MESSAGE_CHANNEL_LABEL[channel as NewMessage["channel"]] ?? channel;
}
