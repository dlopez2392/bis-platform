import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import type { FormField, FormTheme } from "./forms";

/** Shape of the `assets` jsonb. Bumped only when this format changes — distinct
 *  from `blueprints.version`, which counts recaptures of the contents. */
export const BUNDLE_SCHEMA_VERSION = 1;

export type BlueprintBundle = {
  schemaVersion: number;
  pipelines: { key: string; name: string; position: number;
               stages: { key: string; name: string; position: number }[] }[];
  customFields: { key: string; model: string; fieldKey: string; name: string;
                  dataType: string; options: string[]; position: number }[];
  tags: { key: string; name: string }[];
  /** `value` is deliberately absent: it is per-tenant by definition. */
  customValues: { key: string; valueKey: string; name: string }[];
  /** `publicId` and `notifyEmails` are deliberately absent. See the spec §4. */
  forms: { key: string; name: string; fields: FormField[]; theme: FormTheme;
           successMode: string; successMessage: string | null;
           redirectUrl: string | null; localeDefault: string }[];
};

export type BlueprintRow = {
  id: string; agency_id: string; name: string; version: number;
  source_account_id: string | null; assets: BlueprintBundle;
  created_at: string; updated_at: string;
};

export type BlueprintSummary = Pick<BlueprintRow, "id" | "name" | "version" | "created_at">
  & { appliedCount: number };

const BLUEPRINT_COLS =
  "id, agency_id, name, version, source_account_id, assets, created_at, updated_at";

/** Stable, human-readable key derived from a name. Two assets with the same
 *  name in one account would already be rejected by their own unique indexes,
 *  so collisions here are not reachable. */
export function blueprintKey(prefix: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `${prefix}:${slug || "item"}`;
}

export async function captureBlueprint(
  db: SupabaseClient, sourceAccountId: string, input: { name: string }, actorId: string,
): Promise<{ id: string; version: number }> {
  const assets = await buildBundle(db, sourceAccountId);

  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`agency row missing: ${agErr?.message}`);

  const { data: existing } = await db.from("blueprints").select("id, version")
    .eq("agency_id", agency.id).eq("name", input.name).maybeSingle();

  if (existing) {
    const version = existing.version + 1;
    const { error } = await db.from("blueprints")
      .update({ assets, version, source_account_id: sourceAccountId,
                updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`captureBlueprint failed: ${error.message}`);
    await emit(db, sourceAccountId, "blueprint.captured", actorId,
      { blueprintId: existing.id, name: input.name, version });
    return { id: existing.id, version };
  }

  const { data, error } = await db.from("blueprints")
    .insert({ agency_id: agency.id, name: input.name,
              source_account_id: sourceAccountId, assets })
    .select("id").single();
  if (error || !data) throw new Error(`captureBlueprint failed: ${error?.message}`);
  await emit(db, sourceAccountId, "blueprint.captured", actorId,
    { blueprintId: data.id, name: input.name, version: 1 });
  return { id: data.id, version: 1 };
}

async function buildBundle(db: SupabaseClient, accountId: string): Promise<BlueprintBundle> {
  const [pipelines, stages, fields, tags, values, forms] = await Promise.all([
    db.from("pipelines").select("id, name, position").eq("account_id", accountId).order("position"),
    db.from("pipeline_stages").select("pipeline_id, name, position").eq("account_id", accountId).order("position"),
    db.from("custom_fields").select("model, field_key, name, data_type, options, position").eq("account_id", accountId).order("position"),
    db.from("tags").select("name").eq("account_id", accountId).order("name"),
    db.from("custom_values").select("value_key, name").eq("account_id", accountId).order("value_key"),
    db.from("forms").select("name, fields, theme, success_mode, success_message, redirect_url, locale_default").eq("account_id", accountId).order("created_at"),
  ]);

  const stageRows = (stages.data ?? []) as any[];

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    pipelines: ((pipelines.data ?? []) as any[]).map((p) => ({
      key: blueprintKey("pipeline", p.name), name: p.name, position: p.position,
      stages: stageRows.filter((s) => s.pipeline_id === p.id).map((s) => ({
        key: blueprintKey("stage", `${p.name}_${s.name}`), name: s.name, position: s.position,
      })),
    })),
    customFields: ((fields.data ?? []) as any[]).map((f) => ({
      key: blueprintKey("field", `${f.model}_${f.field_key}`), model: f.model,
      fieldKey: f.field_key, name: f.name, dataType: f.data_type,
      options: f.options ?? [], position: f.position,
    })),
    tags: ((tags.data ?? []) as any[]).map((t) => ({
      key: blueprintKey("tag", t.name), name: t.name,
    })),
    // `value` is not read at all — carrying the previous tenant's value would
    // defeat the entire point of custom values as the cloning primitive.
    customValues: ((values.data ?? []) as any[]).map((v) => ({
      key: blueprintKey("value", v.value_key), valueKey: v.value_key, name: v.name,
    })),
    // publicId and notify_emails are not selected above, so they cannot leak
    // into the bundle even by accident.
    forms: ((forms.data ?? []) as any[]).map((f) => ({
      key: blueprintKey("form", f.name), name: f.name, fields: f.fields ?? [],
      theme: f.theme ?? {}, successMode: f.success_mode,
      successMessage: f.success_message, redirectUrl: f.redirect_url,
      localeDefault: f.locale_default,
    })),
  };
}

export async function listBlueprints(db: SupabaseClient): Promise<BlueprintSummary[]> {
  const { data, error } = await db.from("blueprints")
    .select("id, name, version, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // One query for all apply counts rather than one per blueprint.
  const { data: applied } = await db.from("events")
    .select("payload").eq("type", "blueprint.applied");
  const counts = new Map<string, number>();
  for (const e of (applied ?? []) as any[]) {
    const id = e.payload?.blueprintId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id, name: r.name, version: r.version, created_at: r.created_at,
    appliedCount: counts.get(r.id) ?? 0,
  }));
}

export async function getBlueprint(
  db: SupabaseClient, blueprintId: string,
): Promise<BlueprintRow | null> {
  const { data, error } = await db.from("blueprints").select(BLUEPRINT_COLS)
    .eq("id", blueprintId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as BlueprintRow | null) ?? null;
}
