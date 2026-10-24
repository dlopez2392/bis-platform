// S-47d (plan "The guard", spec §5.2, §6, §7): who may change the one switch. Pure, relative imports only
// (the prompt loads this graph under tsx) — `Actor.role` mirrors @bis/db's AccountRole by value, not by
// import, so this file never pulls in the database package.
import type { EffectiveStatus, StatusChange } from "./status";

export type Actor = { isAgency: boolean; role: "owner" | "staff" | "technician" | null };
export type CanChange = "all" | "late_only" | null;

/**
 * The agency or an Owner may always change the switch ("all"). Staff may only run late or reopen
 * FROM open or running late ("late_only") — a closure already in force (Closed today, a storm, or a
 * closed day today) takes that away, because closing and reopening are Owner-only acts (spec §7). A
 * Technician, or a role that could not be settled, gets neither.
 */
export function canChangeFor(actor: Actor, effective: EffectiveStatus): CanChange {
  if (actor.isAgency || actor.role === "owner") return "all";
  if (actor.role === "staff") {
    return effective.state === "open" || effective.state === "running_late" ? "late_only" : null;
  }
  return null;
}

/**
 * `canChangeFor`'s "all" admits any change. "late_only" admits only a change TO open or running late;
 * any other change (closing, or a storm) is refused `close_or_reopen` — the Staff sentence, because the
 * actor IS staff, just not for this change. `null` for Staff (today's closure already took "late_only"
 * away) is refused the SAME `close_or_reopen` sentence, never `role`: Staff is still staff, only Owners
 * close or reopen. `null` for anyone else (a Technician, or an unsettled role) is refused `role`.
 */
export function mayChangeStatus(
  actor: Actor, effective: EffectiveStatus, change: StatusChange,
): { ok: true } | { ok: false; reason: "close_or_reopen" | "role" } {
  const can = canChangeFor(actor, effective);
  if (can === "all") return { ok: true };
  if (can === "late_only") {
    if (change.state === "open" || change.state === "running_late") return { ok: true };
    return { ok: false, reason: "close_or_reopen" };
  }
  if (actor.role === "staff") return { ok: false, reason: "close_or_reopen" };
  return { ok: false, reason: "role" };
}
