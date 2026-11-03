import { listChangeRows, type ChangeRow, type SupabaseClient } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-115 part 1 (S-04), plan Task 8 Step 2: the Owner-only history download's own DB-touching and
 * HTTP pieces, shared by the contact and group history routes (the CSV value/row building stays in
 * `./history-csv.ts`, which has no database dependency at all).
 */

export type HistoryDownloadScope = { contactIds: string[] } | { groupId: string };

/** 50,000 rows (plan Task 8 Step 2); past it the route answers 413 rather than a partial file a
 *  reader could mistake for the whole history. */
export const HISTORY_ROW_CAP = 50_000;
/** `listChangeRows`'s own page size for this route's paging loop — independent of any other
 *  reader's page size (the timeline's `TIMELINE_PAGE_SIZE`, the export route's `CHUNK_SIZE`). */
export const HISTORY_PAGE_SIZE = 2_000;

/**
 * `listChangeRows` paged to the end (`before` is always strictly older — the loader's own cursor,
 * never re-fetched past), capped at `cap`. Past the cap this stops reading immediately rather than
 * draining the rest of a huge history just to throw its rows away. `cap`/`pageSize` are parameters
 * (not bare constants) so a test can probe the exact boundary without building 50,000 fixture rows.
 */
export async function fetchBoundedChangeRows(
  db: SupabaseClient, accountId: string, scope: HistoryDownloadScope,
  cap: number = HISTORY_ROW_CAP, pageSize: number = HISTORY_PAGE_SIZE,
): Promise<{ rows: ChangeRow[] } | { tooBig: true }> {
  const rows: ChangeRow[] = [];
  let before: string | undefined;
  for (;;) {
    const chunk = await listChangeRows(db, accountId, scope, before, pageSize);
    if (chunk.length === 0) break;
    rows.push(...chunk);
    if (rows.length > cap) return { tooBig: true };
    if (chunk.length < pageSize) break;
    before = chunk[chunk.length - 1]!.createdAt;
  }
  return { rows };
}

/**
 * F-118 part 1 mirror (`contacts/export/route.ts:96-97`): a Link's prefetch or RSC fetch of this
 * URL must neither read nor log. Returns the 204 to answer with, or null for a real request.
 */
export function prefetchGuard(req: Request): Response | null {
  if (req.headers.get("rsc") !== null || req.headers.get("next-router-prefetch") !== null) {
    return new Response(null, { status: 204 });
  }
  return null;
}

/**
 * F-118 part 1 mirror (`contacts/export/route.ts`'s own `exportEnded`, review m5): plain text, never
 * a redirect — a download link must not save the chooser's HTML as the file. Reuses the same shared
 * message `accessLog.exportEnded` the contacts export answers with; a history download is the same
 * "your agency visit ended" fact.
 */
export function visitEndedResponse(): Response {
  return new Response(m["accessLog.exportEnded"], {
    status: 409,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Past the 50,000-row cap (plan Task 8 Step 2): plain text, in the reader's own locale, no-store. */
export function tooBigResponse(locale: Locale): Response {
  return new Response(t(m, "history.download.tooBig", locale), {
    status: 413,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
