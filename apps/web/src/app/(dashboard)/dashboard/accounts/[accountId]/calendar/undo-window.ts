/**
 * F-048: how long the Calendar page's Cancel can be undone before the
 * customer is told. Shared by the toast (`cancel-booking.ts`, in the
 * browser) and the notice (`cancel-notice.ts`, on the server), so the two
 * cannot drift apart.
 *
 * UNDO_WINDOW_MS is the toast's life: it carries Undo that long and is then
 * closed. NOTICE_GRACE_MS is extra server-side wait so an Undo clicked in the
 * last instant, still on the wire, lands before the notice tries to claim the
 * cancel. The grace is UX only: correctness does not rest on timing, because
 * the Undo and the notice are conditional writes on the same row version
 * (`claimCancelNotice`), and exactly one of them can win.
 */
export const UNDO_WINDOW_MS = 10_000;
export const NOTICE_GRACE_MS = 5_000;

/** The longest message the owner may write into the notice. */
export const NOTICE_MESSAGE_MAX = 2000;
