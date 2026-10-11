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

/**
 * The database said no (RLS, or 0068's trigger, code 42501), as opposed to
 * anything else going wrong. The @bis/db writers wrap PostgREST's error in
 * their own Error, which keeps the message but not the code, so the message
 * is read too.
 */
export function isRefusal(e: unknown): boolean {
  const o = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; message?: unknown };
  return /row-level security|42501/.test(`${String(o.code ?? "")} ${String(o.message ?? "")}`);
}
