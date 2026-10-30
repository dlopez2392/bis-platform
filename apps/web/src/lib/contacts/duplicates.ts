import { reasonLabel, type DuplicatePair, type DuplicateCursor, type ReasonLabel } from "@bis/db";
import type { RowCursor } from "@/lib/cursor";
import type { MessageKey } from "@/lib/messages";

/**
 * F-006 part 1 (plan Task 10, Step 2): the Possible duplicates view's own column cursor (strength, then
 * created_at, then id — `0106`'s own order) through `lib/cursor.ts`'s opaque `RowCursor`, and the compare
 * screen's link.
 */

/** `${strength}|${createdAt}` — never re-formatted through `Date`, which rounds to milliseconds and could
 *  repeat or skip a row at a page boundary. */
export function toRowCursor(pair: DuplicatePair): RowCursor {
  return { v: `${pair.strength}|${pair.createdAt}`, id: pair.id };
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** TOTAL, like `parseCursor`/`parseTimelineCursor` (`lib/cursor.ts`): a hand-editable `?before=` must read
 *  as "no cursor" rather than throw, whatever shape arrives. */
export function fromRowCursor(rc: RowCursor | undefined): DuplicateCursor | undefined {
  if (!rc || rc.v === null) return undefined;
  const parts = rc.v.split("|");
  if (parts.length !== 2) return undefined;
  const [strengthRaw, createdAt] = parts as [string, string];
  if (!/^[0-9]+$/.test(strengthRaw)) return undefined;
  const strength = Number(strengthRaw);
  if (strength < 1 || strength > 9) return undefined;
  if (!INSTANT.test(createdAt) || Number.isNaN(Date.parse(createdAt))) return undefined;
  return { strength, createdAt, id: rc.id };
}

const REASON_KEY: Readonly<Record<ReasonLabel, MessageKey>> = {
  samePhone: "contacts.duplicates.reason.samePhone",
  sameDigits: "contacts.duplicates.reason.sameDigits",
  sameEmail: "contacts.duplicates.reason.sameEmail",
  sameName: "contacts.duplicates.reason.sameName",
  other: "contacts.duplicates.reason.other",
};

/** The words a pair's reason is shown with (`@bis/db`'s `reasonLabel` folds the trigger's many reasons
 *  down to five words first). */
export function reasonMessageKey(reason: string): MessageKey {
  return REASON_KEY[reasonLabel(reason)];
}

/** The compare screen's own URL. `a`/`b` are unordered (the page decides which is kept); `keep` overrides
 *  the default only when given. */
export function compareHref(accountId: string, pair: DuplicatePair, keep?: string): string {
  const params = new URLSearchParams({ a: pair.a.id, b: pair.b.id });
  if (keep) params.set("keep", keep);
  return `/dashboard/accounts/${accountId}/contacts/merge?${params}`;
}
