/**
 * TEMPORARY — remove once 0064 is on production, with the two retries that
 * use it (work-queue.ts's openTasks, activities.ts's listContactTasks) and
 * test/call-id-fallback.test.ts.
 *
 * Those two reads name `tasks.call_id` (0064), and they back four pages: the
 * account dashboard, the To do page, the agency work page and the contact
 * page. A build that reaches production before 0064 would otherwise answer
 * every one of them with an error. Until then a select naming the column
 * answers 42703 (measured on a local PostgREST 14.14 over a pre-0064
 * replica: {"code":"42703","message":"column tasks.call_id does not exist"}),
 * and the read retries without it — the To do shows, without its author
 * mark. Same shape as emit's PGRST202 fallback for 0053 (#150), removed in
 * #152 once that migration was applied.
 *
 * Narrow on purpose: the code AND this column's name. A 42703 about any
 * other column is a real defect and still throws.
 */
export function isMissingCallIdColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "42703" && /\bcall_id\b/.test(error.message ?? "");
}
