"use server";

import { revalidatePath } from "next/cache";
import { applyImportBatch, buildMatchIndex, emit } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { mapRows, type ParsedRow } from "@/lib/contacts/csv";
import { m } from "@/lib/messages";

/**
 * The server's own ceiling on one call. The wizard slices at BATCH_SIZE (200),
 * but this action is a public server entry point and the browser's slicing is
 * not a control — nothing stops a crafted call posting the whole file at once
 * and holding a connection open for minutes. Generous enough that a legitimate
 * batch never trips it.
 */
const MAX_ROWS_PER_CALL = 500;

export async function importContactsBatchAction(
  accountId: string,
  rows: ParsedRow[],
  opts: { mapping: Record<string, string | null>; createTags: boolean },
): Promise<{ ok: true; created: number; updated: number; flagged: number } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (!Array.isArray(rows)) return { ok: false, error: m["contacts.import.failed"] };
  if (rows.length > MAX_ROWS_PER_CALL) return { ok: false, error: m["contacts.import.tooMany"] };

  // Re-run the mapping HERE rather than accepting the browser's mapped output.
  // The wizard runs the same `mapRows` for its preview, but that result is a
  // convenience for the operator, never the thing that gets written: a caller
  // could otherwise hand us a patch for any column with none of Task 5's
  // validation applied.
  const { mapped } = mapRows(rows, opts.mapping);
  if (mapped.length === 0) return { ok: true, created: 0, updated: 0, flagged: 0 };

  try {
    const db = await dbForRequest();
    // ONCE per batch — never once per row, and deliberately not cached across
    // batches either: rows committed by an earlier batch are already in the
    // database when the next batch builds its index, so cross-batch duplicates
    // are caught with no server-side session state to hold or invalidate.
    const index = await buildMatchIndex(db, accountId);
    const { created, updated, flagged } = await applyImportBatch(
      db, accountId,
      mapped.map((row) => ({ input: row.input, tags: row.tags })),
      index, userId, { createTags: opts.createTags },
    );

    // The ledger write is isolated on purpose. The contacts are already
    // committed by this point, so letting an `emit` failure fall into the
    // catch below would tell the operator the import FAILED when it had in
    // fact succeeded — they would run it again. A missing ledger row is a far
    // smaller problem than a phantom failure. (Same shape as the booking
    // confirmation-email fix: never let a post-write side effect rewrite the
    // outcome of the write.)
    try {
      await emit(db, accountId, "contact.imported", userId, { created, updated });
    } catch {
      // deliberately swallowed — see above
    }

    revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
    return { ok: true, created, updated, flagged };
  } catch {
    return { ok: false, error: m["contacts.import.failed"] };
  }
}
