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
