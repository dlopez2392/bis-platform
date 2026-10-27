import { emit, type SupabaseClient } from "@bis/db";

/**
 * What a move INTO Technician releases (releaseTasksOffCustomers: the open
 * tasks the person held on customers that are not theirs, final review A4),
 * recorded so a later move AWAY from Technician can give it back.
 *
 * There is no separate "undo role change" action (F-085 follow-up, Task A):
 * the Team card's Undo just calls `setTeamRoleAction` again with the
 * previous role (team-handlers.ts's changeRole), the same as any other
 * manual role change. The give-back therefore has to read what THIS
 * person's most recent move into Technician released, not trust anything
 * the browser sends, exactly as the removal's give-back reads
 * removal-log.ts rather than the browser (review residual 5 there).
 *
 * Written as actor_type 'system' (actor_id is still the caller) and read
 * back ONLY as 'system', for the same reason removal-log.ts gives: `emit`
 * relabels a signed-in client's own write as 'user' (0053's record_event),
 * so a 'user' event of this type could be forged by any member of the
 * account into handing itself someone else's open tasks. Only the service
 * role can write 'system'.
 */

export const TECHNICIAN_TASKS_RELEASED = "team.technician_tasks_released";

export type TechnicianRelease = { userId: string; taskIds: string[]; releasedAt: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A list of task UUIDs, or nothing: an id the give-back would write is never guessed. */
const isTaskIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && UUID.test(x));

/** Nothing to record when nothing was released: an empty event would read back the same as none. */
export async function recordTechnicianRelease(
  db: SupabaseClient, accountId: string, actorClerkUserId: string, userId: string, taskIds: readonly string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  await emit(db, accountId, TECHNICIAN_TASKS_RELEASED, actorClerkUserId, { userId, taskIds }, "system");
}

/** The newest system-written release for `userId` in this account, or null (none, or a payload that does not parse). */
export async function latestTechnicianRelease(db: SupabaseClient, accountId: string, userId: string): Promise<TechnicianRelease | null> {
  const { data, error } = await db.from("events").select("payload, created_at")
    .eq("account_id", accountId).eq("type", TECHNICIAN_TASKS_RELEASED).eq("actor_type", "system")
    .eq("payload->>userId", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`latestTechnicianRelease failed: ${(error as { message?: string }).message ?? "unknown"}`);
  if (!data) return null;
  const row = data as { payload: unknown; created_at: string };
  const p = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as Record<string, unknown>;
  if (p.userId !== userId || !isTaskIdList(p.taskIds)) return null;
  return { userId, taskIds: p.taskIds, releasedAt: row.created_at };
}
