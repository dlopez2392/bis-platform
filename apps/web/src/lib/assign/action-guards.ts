/**
 * The checks the assignment server actions share (F-085 part 1). Here, not
 * in the actions files: a "use server" module may export only async
 * functions, so a shared constant or a sync helper has to live outside one.
 */

/** A bulk "Assign to…" at most, and the same bound for the Undo that comes back from the browser. */
export const MAX_ASSIGN = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** A person's id, or null for Unassigned. */
export const isUuidOrNull = (v: unknown): v is string | null => v === null || isUuid(v);

/** An Undo's moved task ids, in total across its entries (fix round 1, m2): 500 entries alone did not bound them. */
export const MAX_MOVED_TASKS = 5000;

/**
 * The database said no: SQLSTATE 42501, which is what both RLS and 0068's
 * trigger raise, as opposed to anything else going wrong. Read off the
 * error's `code`, which @bis/db's AssignmentDbError carries (fix round 1,
 * m1), never off the wording of a message.
 */
export function isRefusal(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "42501";
}
