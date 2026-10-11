import { isRelationshipKey } from "@bis/db/relationship-keys";
import type { RelationshipView } from "./relationship-view";

export type RelationshipsLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; subject: { firstName: string | null; lastName: string | null }; views: RelationshipView[] };

const nameOrNull = (v: unknown) => (typeof v === "string" ? v : null);
const isName = (v: unknown) => v === null || typeof v === "string";
const isForm = (v: unknown) => v === null || v === "f" || v === "m";

function isView(v: unknown): v is RelationshipView {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const p = o.person as Record<string, unknown> | null;
  return typeof o.id === "string" && isRelationshipKey(o.labelKey) && (o.namedSide === "a" || o.namedSide === "b")
    && (o.customLabel === null || typeof o.customLabel === "string")
    && (p === null || (typeof p === "object" && typeof p.id === "string" && isName(p.firstName) && isName(p.lastName)))
    && isForm(o.namedForm) && isForm(o.subjectForm)
    && typeof o.canPickUp === "boolean" && typeof o.isEmergency === "boolean"
    && (o.lockedFlag === null || o.lockedFlag === "canPickUp" || o.lockedFlag === "isEmergency");
}

/**
 * The card's read, parsed: anything but a well-formed 200 is its error state, so a server older or
 * newer than this tab's bundle gets "Couldn't load" instead of a chip that throws in render.
 */
export async function relationshipsLoadFrom(res: Response): Promise<RelationshipsLoad> {
  if (!res.ok) return { status: "error" };
  let body: unknown;
  try { body = await res.json(); } catch { return { status: "error" }; }
  const b = body as { subject?: Record<string, unknown>; views?: unknown } | null;
  if (typeof b?.subject !== "object" || b.subject === null || !Array.isArray(b.views) || !b.views.every(isView)) return { status: "error" };
  return { status: "ready", subject: { firstName: nameOrNull(b.subject.firstName), lastName: nameOrNull(b.subject.lastName) }, views: b.views };
}
