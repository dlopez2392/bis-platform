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
 *  labelled "Note": the words are the contact's own, not the operator's. */
export const MESSAGE_CHANNEL_LABEL: Record<string, string> = {
  email: m["conversations.channel.email"],
  form: m["conversations.channel.form"],
  note: m["conversations.channel.note"],
};
