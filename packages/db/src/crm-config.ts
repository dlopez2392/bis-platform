import type { SupabaseClient } from "@supabase/supabase-js";

const KEY_RE = /^[a-z0-9_]+$/;

export type CustomFieldDef = {
  id: string; model: "contact" | "opportunity"; field_key: string; name: string;
  data_type: "text" | "number" | "date" | "checkbox" | "single_select";
  options: string[]; position: number;
};

export async function listCustomFields(
  db: SupabaseClient, accountId: string, model: "contact" | "opportunity",
): Promise<CustomFieldDef[]> {
  const { data, error } = await db.from("custom_fields")
    .select("id, model, field_key, name, data_type, options, position")
    .eq("account_id", accountId).eq("model", model)
    .order("position").order("name");
  if (error) throw new Error(error.message);
  return data as CustomFieldDef[];
}

export async function createCustomField(
  db: SupabaseClient, accountId: string,
  input: { model: "contact" | "opportunity"; fieldKey: string; name: string;
           dataType: CustomFieldDef["data_type"]; options?: string[] },
): Promise<{ id: string }> {
  if (!KEY_RE.test(input.fieldKey)) throw new Error("fieldKey must be snake_case [a-z0-9_]");
  const { data, error } = await db.from("custom_fields")
    .insert({ account_id: accountId, model: input.model, field_key: input.fieldKey,
              name: input.name, data_type: input.dataType, options: input.options ?? [] })
    .select("id").single();
  if (error || !data) throw new Error(`createCustomField failed: ${error?.message}`);
  return { id: data.id };
}

export async function listCustomValues(db: SupabaseClient, accountId: string) {
  const { data, error } = await db.from("custom_values")
    .select("id, value_key, name, value").eq("account_id", accountId).order("value_key");
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertCustomValue(
  db: SupabaseClient, accountId: string,
  input: { valueKey: string; name: string; value: string },
): Promise<void> {
  if (!KEY_RE.test(input.valueKey)) throw new Error("valueKey must be snake_case [a-z0-9_]");
  const { error } = await db.from("custom_values")
    .upsert({ account_id: accountId, value_key: input.valueKey, name: input.name, value: input.value },
            { onConflict: "account_id,value_key" });
  if (error) throw new Error(error.message);
}

const DEFAULT_STAGES = ["New Lead", "Contacted", "Appointment", "Quote Sent", "Closed"];

export async function ensureDefaultPipeline(
  db: SupabaseClient, accountId: string,
): Promise<{ pipelineId: string }> {
  const { data: existing } = await db.from("pipelines")
    .select("id").eq("account_id", accountId).limit(1);
  if (existing && existing.length > 0) return { pipelineId: existing[0]!.id };
  const { data: p, error } = await db.from("pipelines")
    .insert({ account_id: accountId, name: "Sales" }).select("id").single();
  if (error || !p) throw new Error(`pipeline create failed: ${error?.message}`);
  const { error: sErr } = await db.from("pipeline_stages").insert(
    DEFAULT_STAGES.map((name, i) => ({
      account_id: accountId, pipeline_id: p.id, name, position: i })));
  if (sErr) throw new Error(`stages create failed: ${sErr.message}`);
  return { pipelineId: p.id };
}

export async function listPipelinesWithStages(db: SupabaseClient, accountId: string) {
  const { data, error } = await db.from("pipelines")
    .select("id, name, pipeline_stages(id, name, position)")
    .eq("account_id", accountId).order("position");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p: any) => ({
    id: p.id as string, name: p.name as string,
    stages: (p.pipeline_stages as any[])
      .sort((a, b) => a.position - b.position)
      .map(s => ({ id: s.id as string, name: s.name as string, position: s.position as number })),
  }));
}
