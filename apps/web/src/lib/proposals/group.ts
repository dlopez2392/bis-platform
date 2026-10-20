import type { Proposal } from "@bis/db/proposal-rules";
import type { Tr } from "@/lib/record/copy";
import { callDay, type SuggestionView } from "./view";

/**
 * The tray's groups (item 8b-2, spec 5.1): by customer, then by the source that produced the suggestion
 * (today always a call). Pure: the names, the calls and the views are passed in.
 *
 * The customer is the ROW's `contact_id` (P14's customer, plan ambiguity 8), never the call's caller: the
 * card's own source label still names the caller. A row with no contact is "No customer yet". A customer
 * whose name the page could not resolve reads "(no name)", never "No customer yet", which would be untrue.
 *
 * Groups are ordered by their newest card; cards inside a group keep the read's order (newest first).
 */
export type SuggestionGroup = { key: string; heading: string; views: SuggestionView[] };

export type GroupCtx = {
  tr: Tr; zone: string;
  contactNames: Readonly<Record<string, string>>;
  callsById: ReadonlyMap<string, { startedAt: string | null }>;
};

export function groupSuggestions(
  rows: readonly Proposal[], views: ReadonlyMap<string, SuggestionView>, ctx: GroupCtx,
): SuggestionGroup[] {
  const groups = new Map<string, { group: SuggestionGroup; newest: number }>();
  for (const row of rows) {
    const view = views.get(row.id);
    if (!view) continue;
    const key = `${row.contactId ?? "none"}:${row.source}:${row.callId ?? "none"}`;
    const at = Date.parse(row.createdAt);
    const held = groups.get(key);
    if (held) {
      held.group.views.push(view);
      if (at > held.newest) held.newest = at;
      continue;
    }
    const name = row.contactId === null
      ? ctx.tr.text("suggestions.group.noCustomer")
      : (Object.hasOwn(ctx.contactNames, row.contactId) ? ctx.contactNames[row.contactId] : undefined) || ctx.tr.text("contact.noName");
    const startedAt = row.callId ? (ctx.callsById.get(row.callId)?.startedAt ?? null) : null;
    // The day exactly as the card's source label formats it (`buildSuggestionView`): the call's start, else the row's.
    const date = callDay(ctx.tr.locale, ctx.zone, startedAt ?? row.createdAt);
    groups.set(key, { group: { key, heading: ctx.tr.text("suggestions.group.call", { name, date }), views: [view] }, newest: at });
  }
  // `sort` is stable, so groups whose newest cards tie keep the read's order.
  return [...groups.values()].sort((a, b) => b.newest - a.newest).map((g) => g.group);
}

export type AccountSuggestions<T> = {
  accountId: string; brandName: string; timezone: string; accountCapped: boolean; rows: T[];
};

/**
 * The agency Work page's sections (spec 5.2): the agency read's rows by account, accounts ordered by their
 * newest card (the read itself orders by account id, which means nothing to a reader), each account's rows
 * in the read's order, with its brand name, zone and whether it had more than are shown.
 */
export function groupByAccount<T extends { accountId: string; createdAt: string; brandName: string; timezone: string; accountCapped: boolean }>(
  rows: readonly T[],
): AccountSuggestions<T>[] {
  const accounts = new Map<string, { section: AccountSuggestions<T>; newest: number }>();
  for (const row of rows) {
    const at = Date.parse(row.createdAt);
    const held = accounts.get(row.accountId);
    if (held) {
      held.section.rows.push(row);
      if (at > held.newest) held.newest = at;
      continue;
    }
    accounts.set(row.accountId, {
      section: { accountId: row.accountId, brandName: row.brandName, timezone: row.timezone, accountCapped: row.accountCapped, rows: [row] },
      newest: at,
    });
  }
  return [...accounts.values()].sort((a, b) => b.newest - a.newest).map((a) => a.section);
}
