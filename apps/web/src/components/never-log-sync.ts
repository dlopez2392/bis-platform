import type { NeverLogView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions";

/**
 * NeverLogList's local list, kept in step with the server's `entries` prop (review fix round 1,
 * Important 1). `seen` is the last prop value the list was reset from; when the server sends a new
 * one (a revalidation after any Save on the page, an add made in another tab, a re-read that now
 * succeeds after a failed first read), the list is reset to it during render, React's "adjust state
 * when a prop changes" pattern. Local adds and removes edit `list` only, until the server's next
 * value replaces it. A plain module (no directive): pure, and unit-tested without a DOM.
 */
export type NeverLogState = { seen: NeverLogView[] | null; list: NeverLogView[] };

export function initNeverLogState(entries: NeverLogView[] | null): NeverLogState {
  return { seen: entries, list: entries ?? [] };
}

/** The same state object when the prop has not changed, so the caller can compare by identity. */
export function syncNeverLogState(state: NeverLogState, entries: NeverLogView[] | null): NeverLogState {
  return state.seen === entries ? state : initNeverLogState(entries);
}
