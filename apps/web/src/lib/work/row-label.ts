// The To do page's primary words for one row, moved here unchanged from ACCT/tasks/work-list.tsx's primaryLabel
// (F-032 Task 11, review I-10) so the owner line's needs_attention says exactly what the page says. Both import it.
import type { WorkRow } from "@bis/db";
import type { Tr } from "@/lib/record/copy";

/**
 * The row's own primary sentence. A task's title is already human-written (`WorkRow.title`'s own doc comment in
 * packages/db/src/work-queue.ts), shown verbatim, never re-templated. A derived row has no author, so its sentence
 * comes from the copy catalogue, in the reader's own language (`tr`, F-085 follow-up Task B). `tr.text`'s own
 * interpolate() already uses a replacer FUNCTION, never a plain string second argument to `.replace`, for the
 * conversation case: a contact's own name is untrusted input that could contain a `$&`/`$1` pattern `String.replace`
 * would treat specially.
 *
 * Exhaustive by type: F-077 #343 adds the `failed_transfer` and `booking_act` sources, and until each has its words
 * here the `never` below stops the typecheck (plan Task 11, "after #343 merges"). Its page's version, with the extra
 * `zone` argument `describeAct` needs, is the one to move.
 */
export function workRowLabel(row: WorkRow, contactName: string, tr: Tr): string {
  switch (row.source) {
    case "task": return row.title;
    case "conversation": return tr.text("work.conversation", { name: contactName });
    case "booking": return tr.text("work.booking");
    default: {
      const unhandled: never = row.source;
      throw new Error(`workRowLabel: no words for the To do source ${String(unhandled)}`);
    }
  }
}
