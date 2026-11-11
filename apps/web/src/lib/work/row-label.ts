// The To do page's primary words for one row, moved here unchanged from ACCT/tasks/work-list.tsx's primaryLabel
// (F-032 Task 11, review I-10) so the owner line's needs_attention says exactly what the page says. Both import it.
import type { WorkRow } from "@bis/db";
import type { Tr } from "@/lib/record/copy";
import { describeAct } from "@/lib/ai-acts/kinds";

/**
 * The row's own primary sentence. A task's title is already human-written (`WorkRow.title`'s own doc comment in
 * packages/db/src/work-queue.ts), shown verbatim, never re-templated. A derived row has no author, so its sentence
 * comes from the copy catalogue, in the reader's own language (`tr`, F-085 follow-up Task B). `tr.text`'s own
 * interpolate() already uses a replacer FUNCTION, never a plain string second argument to `.replace`, for the
 * conversation case: a contact's own name is untrusted input that could contain a `$&`/`$1` pattern `String.replace`
 * would treat specially.
 *
 * Exhaustive by type: a new To do source stops the typecheck at the `never` below until it has its words here.
 * F-077 #343's `failed_transfer` and `booking_act` words moved in at the 2026-11-11 merge, from that page's own
 * primaryLabel, with the `zone` its `describeAct` needs (the account's time zone).
 */
export function workRowLabel(row: WorkRow, contactName: string, tr: Tr, zone: string): string {
  switch (row.source) {
    case "task": return row.title;
    case "conversation": return tr.text("work.conversation", { name: contactName });
    case "failed_transfer":
      return row.callbackNumber
        ? tr.text("work.failedTransfer", { number: row.callbackNumber })
        : tr.text("work.failedTransfer.bare");
    case "booking_act": return describeAct(row.bookingAct!, { tr, zone }).verb;
    case "booking": return tr.text("work.booking");
    default: {
      const unhandled: never = row.source;
      throw new Error(`workRowLabel: no words for the To do source ${String(unhandled)}`);
    }
  }
}
