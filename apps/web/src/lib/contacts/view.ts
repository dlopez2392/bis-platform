import type { ArchivedFilter } from "@bis/db";

/** The contacts list (`active`) or its Archived view (contact archive, plan Task 10). */
export type ContactsView = "active" | "archived";

/** `?view=archived` is the Archived view; anything else (absent, another word, a duplicated key that
 *  arrives as an array) is the list. */
export function parseView(raw: unknown): ContactsView {
  return raw === "archived" ? "archived" : "active";
}

/** Carries the view on every link the list builds (pager, sort, search), so paging the Archived view
 *  stays in it. The list adds nothing, so its links read exactly as they did before archive existed. */
export function withView(params: Record<string, string>, view: ContactsView): Record<string, string> {
  return view === "archived" ? { ...params, view: "archived" } : params;
}

/** What `listContacts` / `countContacts` read for a view: only archived contacts, or none of them. */
export function archivedFilterOf(view: ContactsView): ArchivedFilter {
  return view === "archived" ? "only" : "exclude";
}
