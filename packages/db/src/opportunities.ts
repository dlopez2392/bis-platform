import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

async function stagesOf(db: SupabaseClient, accountId: string, pipelineId: string) {
  const { data, error } = await db.from("pipeline_stages")
    .select("id, name, position").eq("account_id", accountId)
    .eq("pipeline_id", pipelineId).order("position");
  if (error || !data || data.length === 0) throw new Error("pipeline has no stages");
  return data;
}

export async function createOpportunity(
  db: SupabaseClient, accountId: string,
  input: { contactId: string; pipelineId: string; name: string; value?: number },
  actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string }> {
  const stages = await stagesOf(db, accountId, input.pipelineId);
  const { data: contact } = await db.from("contacts")
    .select("id").eq("account_id", accountId).eq("id", input.contactId).maybeSingle();
  if (!contact) throw new Error("contact not in account");
  const { data, error } = await db.from("opportunities")
    .insert({ account_id: accountId, contact_id: input.contactId, pipeline_id: input.pipelineId,
              stage_id: stages[0]!.id, name: input.name, monetary_value: input.value ?? 0 })
    .select("id").single();
  if (error || !data) throw new Error(`createOpportunity failed: ${error?.message}`);
  await emit(db, accountId, "opportunity.created", actorId,
    { opportunityId: data.id, contactId: input.contactId, value: input.value ?? 0 }, actorType);
  return { id: data.id };
}

export async function moveOpportunityStage(
  db: SupabaseClient, accountId: string, oppId: string,
  direction: "left" | "right", actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { data: opp, error } = await db.from("opportunities")
    .select("id, pipeline_id, stage_id").eq("account_id", accountId).eq("id", oppId).single();
  if (error || !opp) throw new Error(`opportunity not found: ${error?.message}`);
  const stages = await stagesOf(db, accountId, opp.pipeline_id);
  const idx = stages.findIndex(s => s.id === opp.stage_id);
  const next = direction === "right" ? stages[idx + 1] : stages[idx - 1];
  if (!next) return; // at the end — no-op
  const { error: uErr } = await db.from("opportunities")
    .update({ stage_id: next.id, stage_changed_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", oppId);
  if (uErr) throw new Error(uErr.message);
  await emit(db, accountId, "opportunity.stage_changed", actorId,
    { opportunityId: oppId, from: opp.stage_id, to: next.id }, actorType);
}

export async function moveOpportunityToStage(
  db: SupabaseClient, accountId: string, oppId: string,
  toStageId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { data: opp, error } = await db.from("opportunities")
    .select("id, pipeline_id, stage_id").eq("account_id", accountId).eq("id", oppId).single();
  if (error || !opp) throw new Error(`opportunity not found: ${error?.message}`);
  if (opp.stage_id === toStageId) return;
  const stages = await stagesOf(db, accountId, opp.pipeline_id);
  if (!stages.some(s => s.id === toStageId)) throw new Error("stage not in pipeline");
  const { error: uErr } = await db.from("opportunities")
    .update({ stage_id: toStageId, stage_changed_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", oppId);
  if (uErr) throw new Error(uErr.message);
  await emit(db, accountId, "opportunity.stage_changed", actorId,
    { opportunityId: oppId, from: opp.stage_id, to: toStageId }, actorType);
}

export async function updateOpportunity(
  db: SupabaseClient, accountId: string, oppId: string,
  input: { name?: string; value?: number; status?: "open" | "won" | "lost" },
  actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  if (input.name === undefined && input.value === undefined && input.status === undefined) return;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) row.name = input.name;
  if (input.value !== undefined) row.monetary_value = input.value;
  if (input.status !== undefined) {
    row.status = input.status;
    row.status_changed_at = new Date().toISOString();
  }
  const { error } = await db.from("opportunities")
    .update(row).eq("account_id", accountId).eq("id", oppId);
  if (error) throw new Error(error.message);
  await emit(db, accountId, "opportunity.updated", actorId,
    { opportunityId: oppId, fields: Object.keys(input) }, actorType);
}

export async function setOpportunityStatus(
  db: SupabaseClient, accountId: string, oppId: string,
  status: "open" | "won" | "lost", actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { error } = await db.from("opportunities")
    .update({ status, status_changed_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", oppId);
  if (error) throw new Error(error.message);
  await emit(db, accountId, "opportunity.status_changed", actorId,
    { opportunityId: oppId, status }, actorType);
}

// D-105: a plain `.select()` here hit PostgREST's row cap (max_rows, 1000 in
// production) and silently dropped every card past it — the board would
// just show fewer cards than exist, with nothing on screen saying so
// (DESIGN.md: "never promise a number the screen can't know"). Paged past
// the cap with the same keyset pattern as `sumOpenOpportunities` below (id
// ascending, `.gt()` cursor, stopping only on a genuinely empty page — a
// short-but-nonempty page is not proof there are no more rows). Default
// kept at 1000 so pagination is invisible in the common case; tests shrink
// it to prove the loop without creating a thousand real rows.
const BOARD_PAGE_SIZE = 1000;

export async function listBoard(
  db: SupabaseClient, accountId: string, pipelineId: string, pageSize: number = BOARD_PAGE_SIZE,
) {
  const stages = await stagesOf(db, accountId, pipelineId);
  const opps: any[] = [];
  let lastId: string | undefined;
  for (;;) {
    let query = db.from("opportunities")
      .select("id, name, monetary_value, status, stage_id, created_at, contacts(id, first_name, last_name)")
      .eq("account_id", accountId).eq("pipeline_id", pipelineId)
      .order("id", { ascending: true });
    if (lastId !== undefined) query = query.gt("id", lastId);
    const { data, error } = await query.limit(pageSize);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;
    opps.push(...rows);
    lastId = rows[rows.length - 1]!.id;
  }
  // The query above is ordered by `id` (the deterministic keyset column,
  // not a display order) so the display order — newest first, same as
  // before this fix — is restored once every page is in hand.
  opps.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return stages.map(stage => {
    const inStage = opps.filter((o: any) => o.stage_id === stage.id).map((o: any) => ({
      id: o.id as string, name: o.name as string,
      monetary_value: Number(o.monetary_value), status: o.status as string,
      contact: { id: o.contacts.id as string,
                 first_name: o.contacts.first_name as string | null,
                 last_name: o.contacts.last_name as string | null },
    }));
    return { stage, totalValue: inStage.reduce((s, o) => s + o.monetary_value, 0),
             opportunities: inStage };
  });
}

export async function listContactOpportunities(
  db: SupabaseClient, accountId: string, contactId: string,
) {
  const { data, error } = await db.from("opportunities")
    .select("id, name, status, monetary_value, created_at")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Raw (createdAt, value) pairs for opportunities created in
 * `[fromIso, toIso)` — the dashboard's 14-day pipeline-value chart.
 * Bucketing happens in JS on the caller side, not here. Any status: "pipeline
 * added" means the value AT CREATION, not the value that survived — a later
 * win/loss must not change what this window already captured.
 */
export async function listOpportunityValuesCreatedBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<{ createdAt: string; monetaryValue: number }[]> {
  const { data, error } = await db.from("opportunities")
    .select("created_at, monetary_value")
    .eq("account_id", accountId).gte("created_at", fromIso).lt("created_at", toIso)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listOpportunityValuesCreatedBetween failed: ${error.message}`);
  return (data ?? []).map((r: { created_at: string; monetary_value: number }) => ({
    createdAt: r.created_at, monetaryValue: Number(r.monetary_value),
  }));
}

// PostgREST caps a single response at `max_rows` (1000 in production). A
// plain `.select("monetary_value")` therefore silently undercounts both the
// row count AND the sum of value once an account (or the whole agency) has
// more open opportunities than that. Default kept at 1000 so pagination is
// invisible in the common case; tests shrink it to prove the loop itself
// without creating a thousand real rows.
const OPEN_OPPORTUNITY_PAGE_SIZE = 1000;

/**
 * Exact count and sum of `monetary_value` for open opportunities, paging
 * past PostgREST's row cap so neither figure undercounts above it.
 * `accountId` omitted sums across every account (the agency home's use);
 * given, it scopes to one account (the account dashboard's use).
 *
 * KEYSET paging (`.gt("id", lastId)` + `.limit()`), not `.range()`/offset —
 * the repo already ruled offset paging here unsafe (billing.ts's
 * `countBilledAccountsByPlan`, same comment): a server `max_rows` LOWER than
 * `pageSize` hands back a page shorter than asked even though more rows
 * remain, so "stop when the page is short" silently undercounts. Keyset
 * paging stops ONLY on a genuinely empty page, and as a side effect avoids
 * offset's O(N²) rescan and its skip-on-concurrent-insert — `.range()`
 * re-counts rows 0..from on every request, so a row inserted ahead of the
 * cursor between requests pushes a not-yet-seen row out of the next page.
 */
export async function sumOpenOpportunities(
  db: SupabaseClient, accountId?: string, pageSize: number = OPEN_OPPORTUNITY_PAGE_SIZE,
): Promise<{ count: number; value: number }> {
  let count = 0;
  let value = 0;
  let lastId: string | undefined;
  for (;;) {
    let query = db.from("opportunities").select("id, monetary_value").eq("status", "open");
    if (accountId !== undefined) query = query.eq("account_id", accountId);
    // Without a deterministic order, Postgres/PostgREST may hand back a
    // different row order per request — there is no server-held cursor
    // between the separate HTTP requests each page is, so this has to be
    // attached on every one of them, not just the first. `id` is the
    // table's primary key (0003_crm_core.sql), so ordering by it is both
    // stable and indexed, and doubles as the keyset column below.
    query = query.order("id", { ascending: true });
    if (lastId !== undefined) query = query.gt("id", lastId);
    const { data, error } = await query.limit(pageSize);
    if (error) throw new Error(`sumOpenOpportunities failed: ${error.message}`);
    const rows = (data ?? []) as { id: string; monetary_value: number }[];
    if (rows.length === 0) return { count, value };
    for (const row of rows) {
      count += 1;
      value += Number(row.monetary_value);
    }
    lastId = rows[rows.length - 1]!.id;
  }
}
