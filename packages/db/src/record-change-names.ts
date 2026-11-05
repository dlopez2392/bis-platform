import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeGroup } from "./record-changes";

/**
 * F-115 PR E fix (review I4/I6): ONE bounded read, on the caller's own RLS-scoped client, for every
 * id a page's own change rows reference but cannot name from their own columns — a removed
 * relationship's other contact, a removed/moved place's contact or group, a removed tag's own name, a
 * replaced unit's own name, and a moved deal's stage or pipeline. Every query also carries an explicit
 * `account_id` filter (belt and suspenders over RLS): an id that happens to exist in ANOTHER account
 * never resolves here, proven by `record-change-names.test.ts`'s own second-account case.
 */

/** What one page's worth of `ChangeGroup`s references, scanned PURELY from the rows themselves —
 *  never a second read to find out what to read. */
export type ChangeNameRefs = {
  contactIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  equipmentIds: ReadonlySet<string>;
  stageIds: ReadonlySet<string>;
  pipelineIds: ReadonlySet<string>;
};

function addStringId(set: Set<string>, v: unknown): void {
  if (typeof v === "string" && v.length > 0) set.add(v);
}

/** Pure (no database): every id `readChangeNames` below needs to look up, for this page's groups. */
export function changeNameRefs(groups: readonly ChangeGroup[]): ChangeNameRefs {
  const contactIds = new Set<string>();
  const groupIds = new Set<string>();
  const tagIds = new Set<string>();
  const equipmentIds = new Set<string>();
  const stageIds = new Set<string>();
  const pipelineIds = new Set<string>();
  for (const g of groups) {
    for (const row of g.rows) {
      // A membership's own group, so a removal's verb can read "household" or "business" correctly —
      // collected for every op, not only delete: cheap, and an update (a moved membership) wants it too.
      if (row.recordType === "client_group_member" && row.clientGroupId) groupIds.add(row.clientGroupId);
      if (row.op === "delete") {
        if (row.recordType === "contact_tag") tagIds.add(row.recordId);
        const before = row.before as Record<string, unknown> | null;
        if (row.recordType === "contact_relationship") addStringId(contactIds, before?.related_contact_id);
        if (row.recordType === "place") {
          addStringId(contactIds, before?.contact_id);
          addStringId(groupIds, before?.client_group_id);
        }
      }
      if (row.op === "update" && row.field) {
        if (row.field === "related_contact_id") { addStringId(contactIds, row.before); addStringId(contactIds, row.after); }
        if (row.recordType === "place" && row.field === "contact_id") { addStringId(contactIds, row.before); addStringId(contactIds, row.after); }
        if (row.recordType === "place" && row.field === "client_group_id") { addStringId(groupIds, row.before); addStringId(groupIds, row.after); }
        if (row.field === "replaces_id") { addStringId(equipmentIds, row.before); addStringId(equipmentIds, row.after); }
        if (row.field === "stage_id") { addStringId(stageIds, row.before); addStringId(stageIds, row.after); }
        if (row.field === "pipeline_id") { addStringId(pipelineIds, row.before); addStringId(pipelineIds, row.after); }
      }
    }
  }
  return { contactIds, groupIds, tagIds, equipmentIds, stageIds, pipelineIds };
}

/** `names` is ONE shared id -> display-name map (person/contact/tag/equipment/stage/pipeline ids never
 *  collide in practice — real uuids, vanishingly unlikely to coincide — the same reasoning
 *  `change-rows.ts`'s own doc comment already applies to a clerk id next to a contact id).
 *  `groupKinds` stays its own map: its value is not a name. */
export type ChangeNames = { names: Readonly<Record<string, string>>; groupKinds: Readonly<Record<string, "household" | "business">> };

const EMPTY: ChangeNames = { names: {}, groupKinds: {} };

/**
 * On the caller's own client: RLS (0068/0111 section 6) decides what comes back, so a Technician's
 * token (already refused the `changes` source itself) would also get nothing here. The explicit
 * `account_id` filter on every query is the SAME belt-and-suspenders the rest of this feature already
 * uses (`listChangeRows`'s own `.eq("account_id", …)`), so a cross-account id can never resolve even if
 * a future RLS policy regressed. Never throws on an EMPTY ref set (skips the read entirely); a real
 * read failure throws, same as every other read this feature makes on this client.
 */
export async function readChangeNames(db: SupabaseClient, accountId: string, refs: ChangeNameRefs): Promise<ChangeNames> {
  if (refs.contactIds.size === 0 && refs.groupIds.size === 0 && refs.tagIds.size === 0
    && refs.equipmentIds.size === 0 && refs.stageIds.size === 0 && refs.pipelineIds.size === 0) return EMPTY;
  const none = { data: [] as unknown[], error: null };
  const [contacts, groups, tags, equipment, stages, pipelines] = await Promise.all([
    refs.contactIds.size > 0
      ? db.from("contacts").select("id, first_name, last_name").eq("account_id", accountId).in("id", [...refs.contactIds])
      : Promise.resolve(none),
    refs.groupIds.size > 0
      ? db.from("client_groups").select("id, kind").eq("account_id", accountId).in("id", [...refs.groupIds])
      : Promise.resolve(none),
    refs.tagIds.size > 0
      ? db.from("tags").select("id, name").eq("account_id", accountId).in("id", [...refs.tagIds])
      : Promise.resolve(none),
    refs.equipmentIds.size > 0
      ? db.from("equipment").select("id, name").eq("account_id", accountId).in("id", [...refs.equipmentIds])
      : Promise.resolve(none),
    refs.stageIds.size > 0
      ? db.from("pipeline_stages").select("id, name").eq("account_id", accountId).in("id", [...refs.stageIds])
      : Promise.resolve(none),
    refs.pipelineIds.size > 0
      ? db.from("pipelines").select("id, name").eq("account_id", accountId).in("id", [...refs.pipelineIds])
      : Promise.resolve(none),
  ]);
  for (const [label, r] of [
    ["contacts", contacts], ["client_groups", groups], ["tags", tags],
    ["equipment", equipment], ["pipeline_stages", stages], ["pipelines", pipelines],
  ] as const) {
    if (r.error) throw new Error(`readChangeNames: ${label} read failed: ${(r.error as { message: string }).message}`);
  }
  const names: Record<string, string> = {};
  for (const c of (contacts.data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
    const name = [c.first_name, c.last_name].filter((s) => s && s.trim()).join(" ").trim();
    if (name) names[c.id] = name;
  }
  for (const t of (tags.data ?? []) as { id: string; name: string }[]) names[t.id] = t.name;
  for (const e of (equipment.data ?? []) as { id: string; name: string }[]) names[e.id] = e.name;
  for (const s of (stages.data ?? []) as { id: string; name: string }[]) names[s.id] = s.name;
  for (const p of (pipelines.data ?? []) as { id: string; name: string }[]) names[p.id] = p.name;
  const groupKinds: Record<string, "household" | "business"> = {};
  for (const g of (groups.data ?? []) as { id: string; kind: "household" | "business" }[]) groupKinds[g.id] = g.kind;
  return { names, groupKinds };
}
