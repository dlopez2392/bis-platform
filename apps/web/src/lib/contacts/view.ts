import type { ArchivedFilter } from "@bis/db";

/** The contacts list (`active`), its Archived view (contact archive, plan Task 10) or its Possible
 *  duplicates view (F-006 part 1, plan Task 10). */
export type ContactsView = "active" | "archived" | "duplicates";

/** `?view=archived`/`?view=duplicates` pick those views; anything else (absent, another word, a
 *  duplicated key that arrives as an array) is the list. */
export function parseView(raw: unknown): ContactsView {
  return raw === "archived" ? "archived" : raw === "duplicates" ? "duplicates" : "active";
}

/** Carries the view on every link the list builds (pager, sort, search), so paging the Archived or the
 *  duplicates view stays in it. The list adds nothing, so its links read exactly as they did before. */
export function withView(params: Record<string, string>, view: ContactsView): Record<string, string> {
  return view === "active" ? params : { ...params, view };
}

/** What `listContacts` / `countContacts` read for a view: only archived contacts, or none of them (the
 *  duplicates view is never archived contacts either — it reads through the pair functions, not this). */
export function archivedFilterOf(view: ContactsView): ArchivedFilter {
  return view === "archived" ? "only" : "exclude";
}
