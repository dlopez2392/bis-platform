import type { AccessLogKind, AccessLogPage, SupabaseClient } from "@bis/db";
import type { AccessLogNames } from "./view";

/**
 * F-118 part 1 (plan Task 4, step 3): the Owner's page of visits names only what it actually opened —
 * contacts, households or businesses, calls, conversations, documents and forms — bounded reads, never
 * filtered by archived/trashed (the Owner must see what BIS saw, trash and all). Takes the READER's own
 * client (RLS bounds it to the agency or this account's Owner, same as `readAccessLogPage`).
 */
export const NAME_CHUNK = 50;

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function idsOf(page: AccessLogPage, kinds: readonly AccessLogKind[]): string[] {
  const set = new Set<string>();
  for (const visit of page.visits) {
    for (const it of visit.items) {
      if (it.recordId && (kinds as readonly string[]).includes(it.kind)) set.add(it.recordId);
    }
  }
  return [...set];
}

/** One table, chunked at NAME_CHUNK ids per read, run in parallel, flattened. No ids: no read at all. */
async function readRows<T>(
  db: SupabaseClient, table: string, cols: string, accountId: string, idCol: string, ids: readonly string[],
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(chunk(ids, NAME_CHUNK).map(async (part) => {
    const { data, error } = await db.from(table).select(cols).eq("account_id", accountId).in(idCol, part);
    if (error) throw new Error(`resolveAccessLogNames: ${table} read failed: ${error.message}`);
    return (data ?? []) as T[];
  }));
  return results.flat();
}

type CallRow = { id: string; started_at: string; contact_id: string | null };
type ConversationRow = { id: string; contact_id: string | null };
type DocumentRow = { id: string; title: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null };
type GroupRow = { id: string; name: string; kind: "household" | "business" };
type FormRow = { id: string; name: string };
type ContactRow = { id: string; first_name: string | null; last_name: string | null; archived_at: string | null };

export async function resolveAccessLogNames(db: SupabaseClient, accountId: string, page: AccessLogPage): Promise<AccessLogNames> {
  const callIds = idsOf(page, ["call"]);
  const conversationIds = idsOf(page, ["conversation"]);
  const documentIds = idsOf(page, ["document_view", "document_download", "document_share"]);
  const groupIds = idsOf(page, ["group"]);
  const formIds = idsOf(page, ["form_answers"]);

  const [callRows, conversationRows, documentRows, groupRows, formRows] = await Promise.all([
    readRows<CallRow>(db, "calls", "id, started_at, contact_id", accountId, "id", callIds),
    readRows<ConversationRow>(db, "conversations", "id, contact_id", accountId, "id", conversationIds),
    readRows<DocumentRow>(db, "documents", "id, title, deleted_at, contact_id, client_group_id", accountId, "id", documentIds),
    readRows<GroupRow>(db, "client_groups", "id, name, kind", accountId, "id", groupIds),
    readRows<FormRow>(db, "forms", "id, name", accountId, "id", formIds),
  ]);

  // The contacts read runs SECOND: a call's or conversation's caller needs a name too (spec 6.2), so
  // their contact ids join the "contact" kind's own item ids before the one contacts read.
  const directContactIds = idsOf(page, ["contact"]);
  const fromCalls = callRows.map((c) => c.contact_id).filter((v): v is string => v !== null);
  const fromConversations = conversationRows.map((c) => c.contact_id).filter((v): v is string => v !== null);
  const contactIds = [...new Set([...directContactIds, ...fromCalls, ...fromConversations])];
  const contactRows = await readRows<ContactRow>(db, "contacts", "id, first_name, last_name, archived_at", accountId, "id", contactIds);

  return {
    contacts: new Map(contactRows.map((c) => [c.id, { first: c.first_name, last: c.last_name, archived: c.archived_at !== null }])),
    groups: new Map(groupRows.map((g) => [g.id, { name: g.name, kind: g.kind }])),
    calls: new Map(callRows.map((c) => [c.id, { contactId: c.contact_id, startedAt: c.started_at }])),
    conversations: new Map(conversationRows.map((c) => [c.id, { contactId: c.contact_id }])),
    documents: new Map(documentRows.map((d) => [d.id, {
      title: d.title, trashed: d.deleted_at !== null,
      record: d.contact_id ? { kind: "contact" as const, id: d.contact_id }
        : d.client_group_id ? { kind: "group" as const, id: d.client_group_id } : null,
    }])),
    forms: new Map(formRows.map((f) => [f.id, { name: f.name }])),
  };
}
