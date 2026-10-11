import type { AssigneeFilter } from "@bis/db";

/** The list filter in the URL (spec §9): `?who=mine|unassigned`, absent = All. */
export type Who = "all" | "mine" | "unassigned";

/** Anything else, including a duplicated key (an array at runtime), is All. */
export function parseWho(raw: string | undefined): Who {
  return raw === "mine" || raw === "unassigned" ? raw : "all";
}

/** "Mine" needs a users row; the agency has none in a client's company (A5), so it reads as All. */
export function assigneeFilterFor(who: Who, personId: string | null): AssigneeFilter | undefined {
  if (who === "unassigned") return { who: "unassigned" };
  if (who === "mine" && personId) return { who: "mine", userId: personId };
  return undefined;
}

/** A link's query params with the filter carried along, unless it is All. */
export function withWho(params: Record<string, string>, who: Who): Record<string, string> {
  return who === "all" ? params : { ...params, who };
}
