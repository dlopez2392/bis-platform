import { after } from "next/server";
import type { SupabaseClient, TransferFailedReason } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";

/**
 * Records that a caller who asked for a person reached nobody (F-077 part 1;
 * spec 2026-11-06-work-queue-actions-design.md section 10, ruling 1; migration
 * 0114's `calls.transfer_failed_at`/`transfer_failed_reason`). The To do
 * queue reads ONLY this stamp, so it shows real failures and never a transfer
 * still in progress.
 *
 * Its two callers are the handoff routes, and both answer Telnyx's TeXML
 * fetch with a caller holding a silent line. So this is a SIDE-WRITE on
 * `stampHeartbeat`'s pattern (lib/ops/stamp.ts): scheduled in `after()`, so
 * it runs once the response has gone and can never delay it; and total, so it
 * can never break it. Both of `after()`'s failure paths are caught: its own
 * synchronous throw (no request scope) and the callback rejecting. A route
 * that awaited this write inline would hang the caller on a slow database and
 * turn a failing one into the outer catch's bare `<Hangup/>`.
 *
 * `db` is the route's own service client, and `accountId`/`callId` come from
 * the row its handoff token resolved: never from the request. `at` is the
 * route's own clock reading. `markTransferFailed` is a compare-and-swap on
 * `transfer_failed_at is null`, so a retried webhook matches nothing and gets
 * `false`: that is the ordinary outcome of a retry, not an error.
 *
 * Logs carry the call id and account id, never a phone number, and the error
 * through `loggableError`.
 */
export function recordTransferFailed(
  db: SupabaseClient,
  accountId: string,
  callId: string,
  reason: TransferFailedReason,
  at: Date,
  label: string,
): void {
  try {
    after(async () => {
      try {
        // Lazy, the rule this whole directory obeys: a module-scope DB import
        // breaks `next build` during page-data collection.
        const { markTransferFailed } = await import("@bis/db");
        const recorded = await markTransferFailed(db, accountId, callId, reason, at);
        if (!recorded) {
          console.log(`${label}: call ${callId}'s failed transfer was already recorded, accountId ${accountId}`);
        }
      } catch (e) {
        console.error(`${label}: call ${callId}'s failed transfer (${reason}) did not save: ${loggableError(e)}, accountId ${accountId}`);
      }
    });
  } catch (e) {
    console.error(`${label}: could not schedule call ${callId}'s failed-transfer write (${reason}): ${loggableError(e)}, accountId ${accountId}`);
  }
}
