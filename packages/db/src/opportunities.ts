import type { SupabaseClient } from "@supabase/supabase-js";

async function emit(db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object) {
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: "user", actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

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
): Promise<{ id: string }> {
  const stages = await stagesOf(db, accountId, input.pipelineId);
  const { data, error } = await db.from("opportunities")
    .insert({ account_id: accountId, contact_id: input.contactId, pipeline_id: input.pipelineId,
              stage_id: stages[0]!.id, name: input.name, monetary_value: input.value ?? 0 })
    .select("id").single();
  if (error || !data) throw new Error(`createOpportunity failed: ${error?.message}`);
  await emit(db, accountId, "opportunity.created", actorId,
    { opportunityId: data.id, contactId: input.contactId, value: input.value ?? 0 });
  return { id: data.id };
}

export async function moveOpportunityStage(
  db: SupabaseClient, accountId: string, oppId: string,
  direction: "left" | "right", actorId: string,
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
    { opportunityId: oppId, from: opp.stage_id, to: next.id });
}

export async function moveOpportunityToStage(
  db: SupabaseClient, accountId: string, oppId: string,
  toStageId: string, actorId: string,
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
    { opportunityId: oppId, from: opp.stage_id, to: toStageId });
}

export async function updateOpportunity(
  db: SupabaseClient, accountId: string, oppId: string,
  input: { name?: string; value?: number; status?: "open" | "won" | "lost" },
  actorId: string,
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
    { opportunityId: oppId, fields: Object.keys(input) });
}

export async function setOpportunityStatus(
  db: SupabaseClient, accountId: string, oppId: string,
  status: "open" | "won" | "lost", actorId: string,
): Promise<void> {
  const { error } = await db.from("opportunities")
    .update({ status, status_changed_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", oppId);
  if (error) throw new Error(error.message);
  await emit(db, accountId, "opportunity.status_changed", actorId, { opportunityId: oppId, status });
}

export async function listBoard(db: SupabaseClient, accountId: string, pipelineId: string) {
  const stages = await stagesOf(db, accountId, pipelineId);
  const { data: opps, error } = await db.from("opportunities")
    .select("id, name, monetary_value, status, stage_id, contacts(id, first_name, last_name)")
    .eq("account_id", accountId).eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return stages.map(stage => {
    const inStage = (opps ?? []).filter((o: any) => o.stage_id === stage.id).map((o: any) => ({
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
