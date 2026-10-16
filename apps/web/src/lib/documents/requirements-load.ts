import {
  isRequirableCategory, isRequirementState, requirementsMeter, type RequirableCategory, type RequirementState,
} from "@bis/db/document-rules";
import type { DocumentsLoad } from "./documents-load";

/**
 * The Documents card's checklist read, browser side (spec 5.3, 5.4): the route's answer parsed
 * strictly (one bad item makes the whole answer an error, as documentsLoadFrom does), the view the
 * card draws from it, and the rule for when a files read means the checklist must be read again.
 * Browser-safe: it imports the vault's rules from the subpath only, never the barrel.
 */
export type RequirementView = { category: RequirableCategory; state: RequirementState };
export type RequirementsResponse = { items: RequirementView[] };
export type RequirementsLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: RequirementsResponse };
export type ChecklistView =
  | { kind: "off" }
  | { kind: "on"; met: number; required: number; complete: boolean; gaps: RequirementView[]; skipped: RequirementView[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseRequirements(body: unknown): RequirementsResponse | null {
  if (!isObj(body) || !Array.isArray(body.items)) return null;
  const items: RequirementView[] = [];
  for (const v of body.items) {
    if (!isObj(v) || !isRequirableCategory(v.category) || !isRequirementState(v.state)) return null;
    items.push({ category: v.category, state: v.state });
  }
  return { items };
}

export async function requirementsLoadFrom(res: Response): Promise<RequirementsLoad> {
  if (!res.ok) return { kind: "error" };
  const data = parseRequirements(await res.json().catch(() => null));
  return data ? { kind: "ready", data } : { kind: "error" };
}

export const requirementsRouteFor = (accountId: string, contactId: string): string =>
  `/api/accounts/${accountId}/contacts/${contactId}/document-requirements`;

/**
 * Off when nothing is required. On: "met of required" with skipped items in neither number; the gaps
 * (missing, expired, checking: D10) in the list's order; complete when nothing counted is unmet, so
 * a list whose every item was skipped reads Complete, 0 of 0 (D11), its skipped items still listed.
 */
export function checklistView(data: RequirementsResponse): ChecklistView {
  if (data.items.length === 0) return { kind: "off" };
  const { met, required } = requirementsMeter(data.items);
  return {
    kind: "on", met, required, complete: required > 0 ? met === required : true,
    gaps: data.items.filter((i) => i.state === "missing" || i.state === "expired" || i.state === "checking"),
    skipped: data.items.filter((i) => i.state === "skipped"),
  };
}

/**
 * Re-read the checklist once when a files read changed something it depends on: a live file added or
 * gone, or its category, expiry or shown version (id or scan state) moved, or the ACCOUNT'S DAY turned (M4:
 * a file expiring today reads met until midnight in the account's zone, then expired). Both reads must be ready. The
 * same read twice answers false, so the files' Checking poll (every 5 s) and the requests tick never
 * re-read it for nothing, and its own re-read touches no files read, so it cannot loop. A household's
 * file changed on ANOTHER page is not seen here; the next page load reads it (spec 5.3 counts it).
 */
export function shouldReloadRequirements(prev: DocumentsLoad | null, next: DocumentsLoad): boolean {
  if (prev?.status !== "ready" || next.status !== "ready") return false;
  const print = (l: Extract<DocumentsLoad, { status: "ready" }>) =>
    l.data.live.map((d) => `${d.id}|${d.category}|${d.expiresOn ?? ""}|${d.version.id}|${d.version.scan}`).sort().join("\n");
  return prev.data.today !== next.data.today || print(prev) !== print(next);
}

/** A failed RE-read keeps the list this route already shows; a first read's failure (or another route's) is shown (keepRequests' rule). */
export function keepRequirements(
  shown: { route: string; load: RequirementsLoad }, route: string, next: RequirementsLoad,
): { route: string; load: RequirementsLoad } {
  return next.kind === "error" && shown.route === route && shown.load.kind === "ready" ? shown : { route, load: next };
}
