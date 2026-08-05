import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import type { FormField, FormTheme } from "./forms";
import { newPublicId } from "./forms";

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
  /** `publicId` and `notifyEmails` are deliberately absent. See the spec §4.
   *  `successMode`/`successMessage`/`redirectUrl` ARE still captured here —
   *  unlike the two above, they are not stripped from the bundle itself, to
   *  keep this a smaller change with no `BUNDLE_SCHEMA_VERSION` bump. But
   *  `applyBlueprint` never writes them through: a redirect or thank-you
   *  message authored for the source tenant would silently point at, or
   *  name, the wrong business on every account this blueprint is applied to
   *  — the exact failure mode `notifyEmails` was excluded to prevent. See
   *  the forms loop below and the spec §4. */
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

/**
 * Stable, human-readable key derived from a name: lowercased, non-alnum runs
 * collapsed to `_`, truncated to 40 chars. NOT guaranteed unique on its own.
 * Several source tables have no unique constraint on `name` at all
 * (`pipeline_stages`, `forms` — the latter deliberately, per migration 0006's
 * own comment about a cross-tenant uniqueness fight over names like
 * "contact"). And even where a name *is* unique per account (`tags`;
 * `pipelines` via migration 0004), the slug transform is lossy: "Hot Lead"
 * and "hot-lead" are two distinct, legal names that both produce
 * `tag:hot_lead`, and so does any pair of names differing only past the
 * 40-char truncation. Callers that assemble a set of these keys for one
 * bundle (see `buildBundle`'s `makeKeyer`) must de-duplicate within that set.
 */
export function blueprintKey(prefix: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `${prefix}:${slug || "item"}`;
}

/**
 * Wraps `blueprintKey` with in-bundle de-duplication. `blueprintKey` alone
 * can produce the same string for two distinct assets (see its docstring);
 * this tracks the full set of keys already *emitted* (not just a per-base
 * count) and, on a collision, keeps incrementing the numeric suffix past any
 * value already in use — including bases claimed by an unrelated name — so
 * every asset in the bundle still gets a distinct key. A per-base counter
 * alone is not enough: e.g. "Hot Lead" and "hot-lead" both slug to
 * `tag:hot_lead`, and a third, unrelated tag "Hot Lead 2" slugs on its own
 * to `tag:hot_lead_2` — the exact string a naive counter would hand the
 * second of the first two, producing two assets sharing one key. Checking
 * membership in the emitted-key set (not the base) is what catches that.
 * Must be a fresh instance per `buildBundle` call (module-level state would
 * leak across accounts/captures); its behavior is deterministic given a
 * fixed call order, which is why every query below orders by `id` as a
 * tiebreaker — without that, Postgres could return equal-position/
 * equal-timestamp rows in a different order on the next capture and the
 * suffix would land on a different row each time, breaking the idempotency
 * that `blueprint_key` exists to provide.
 */
function makeKeyer() {
  const used = new Set<string>();
  return (prefix: string, name: string): string => {
    const base = blueprintKey(prefix, name);
    let candidate = base;
    let n = 1;
    while (used.has(candidate)) {
      n++;
      candidate = `${base}_${n}`;
    }
    used.add(candidate);
    return candidate;
  };
}

export async function captureBlueprint(
  db: SupabaseClient, sourceAccountId: string, input: { name: string }, actorId: string,
): Promise<{ id: string; version: number }> {
  const assets = await buildBundle(db, sourceAccountId);

  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`agency row missing: ${agErr?.message}`);

  const { data: existing, error: existingErr } = await db.from("blueprints").select("id, version")
    .eq("agency_id", agency.id).eq("name", input.name).maybeSingle();
  // Fail loud: falling through to the insert branch below on a lost lookup
  // surfaces as "duplicate key value violates unique constraint" instead of
  // naming the query that actually failed.
  if (existingErr) throw new Error(`captureBlueprint: existing blueprint lookup failed: ${existingErr.message}`);

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
  // Every ordering below ends in `.order("id")`: none of the primary sort
  // columns (position, name, value_key, created_at) is guaranteed distinct
  // (position defaults to 0 for every row; created_at can tie under fast
  // concurrent inserts), so without an id tiebreaker Postgres is free to
  // return equal-key rows in a different order on every call. That would
  // make makeKeyer's `_2`/`_3` disambiguation land on a different asset each
  // capture, breaking the idempotency `blueprint_key` exists to provide.
  const [pipelines, stages, fields, tags, values, forms] = await Promise.all([
    db.from("pipelines").select("id, name, position").eq("account_id", accountId)
      .order("position").order("id"),
    db.from("pipeline_stages").select("id, pipeline_id, name, position").eq("account_id", accountId)
      .order("position").order("id"),
    db.from("custom_fields").select("id, model, field_key, name, data_type, options, position").eq("account_id", accountId)
      .order("position").order("id"),
    db.from("tags").select("id, name").eq("account_id", accountId)
      .order("name").order("id"),
    db.from("custom_values").select("id, value_key, name").eq("account_id", accountId)
      .order("value_key").order("id"),
    db.from("forms").select("id, name, fields, theme, success_mode, success_message, redirect_url, locale_default").eq("account_id", accountId)
      .order("created_at").order("id"),
  ]);

  // Fail loud: a transient failure, permissions problem, or RLS
  // misconfiguration on any one of these must not fall through to `?? []`
  // below and silently produce an incomplete bundle that captureBlueprint
  // then persists and reports as success.
  const queries = [
    ["pipelines", pipelines], ["pipeline_stages", stages], ["custom_fields", fields],
    ["tags", tags], ["custom_values", values], ["forms", forms],
  ] as const;
  for (const [label, result] of queries) {
    if (result.error) throw new Error(`buildBundle: ${label} query failed: ${result.error.message}`);
  }

  const stageRows = (stages.data ?? []) as any[];
  const key = makeKeyer();

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    pipelines: ((pipelines.data ?? []) as any[]).map((p) => ({
      key: key("pipeline", p.name), name: p.name, position: p.position,
      stages: stageRows.filter((s) => s.pipeline_id === p.id).map((s) => ({
        key: key("stage", `${p.name}_${s.name}`), name: s.name, position: s.position,
      })),
    })),
    customFields: ((fields.data ?? []) as any[]).map((f) => ({
      key: key("field", `${f.model}_${f.field_key}`), model: f.model,
      fieldKey: f.field_key, name: f.name, dataType: f.data_type,
      options: f.options ?? [], position: f.position,
    })),
    tags: ((tags.data ?? []) as any[]).map((t) => ({
      key: key("tag", t.name), name: t.name,
    })),
    // `value` is not read at all — carrying the previous tenant's value would
    // defeat the entire point of custom values as the cloning primitive.
    customValues: ((values.data ?? []) as any[]).map((v) => ({
      key: key("value", v.value_key), valueKey: v.value_key, name: v.name,
    })),
    // publicId and notify_emails are not selected above, so they cannot leak
    // into the bundle even by accident.
    forms: ((forms.data ?? []) as any[]).map((f) => ({
      key: key("form", f.name), name: f.name, fields: f.fields ?? [],
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
  const { data: applied, error: appliedErr } = await db.from("events")
    .select("payload").eq("type", "blueprint.applied");
  // Fail loud: a transient failure here must not fall through to `?? []`
  // below and silently report `appliedCount: 0` for every blueprint, as
  // though that were a fact rather than a lost query.
  if (appliedErr) throw new Error(`listBlueprints: events query failed: ${appliedErr.message}`);
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

export type ApplyReport = {
  created: string[];   // blueprint keys written by this run
  skipped: string[];   // already present from an earlier apply
  failed: { key: string; error: string }[];
};

/**
 * Applies a blueprint's configuration to an account.
 *
 * Per-asset, not all-or-nothing: PostgREST gives no cross-table transaction, so
 * a failure records itself in the report and the remaining assets still apply.
 * That is only safe because this is idempotent — the remedy for a partial apply
 * is to apply again, and the partial unique index on (account_id,
 * blueprint_key) guarantees the second run creates nothing twice.
 *
 * Order is load-bearing: a form's fields reference custom fields by
 * `custom.<field_key>`, and stages need their pipeline's id.
 */
export async function applyBlueprint(
  db: SupabaseClient, accountId: string, blueprintId: string, actorId: string,
): Promise<ApplyReport> {
  const blueprint = await getBlueprint(db, blueprintId);
  if (!blueprint) throw new Error("applyBlueprint failed: blueprint not found");

  // The spec (§8) claims a stale bundle is detectable; nothing previously
  // checked this. Every bundle is v1 today, so this was latent — but the day
  // a v2 renames a key, applying a v1 bundle would otherwise silently apply
  // fewer assets and report success with an empty `created` list,
  // indistinguishable from an already-applied blueprint.
  if (blueprint.assets.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(
      `applyBlueprint failed: blueprint "${blueprint.name}" was captured under bundle ` +
      `schemaVersion ${blueprint.assets.schemaVersion}, but this build expects ` +
      `${BUNDLE_SCHEMA_VERSION}. Recapture it to upgrade the bundle.`,
    );
  }

  const report: ApplyReport = { created: [], skipped: [], failed: [] };
  const a = blueprint.assets;

  const step = async (key: string, fn: () => Promise<"created" | "skipped">) => {
    try {
      const outcome = await fn();
      (outcome === "created" ? report.created : report.skipped).push(key);
    } catch (e) {
      report.failed.push({ key, error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Insert unless this (account, blueprint_key) already exists. Returns the
   *  row id either way so dependents (stages) can attach to it. Only valid for
   *  the five tables migration 0007 gave a `blueprint_key`/`origin` column and
   *  a partial unique index on (account_id, blueprint_key): pipelines,
   *  pipeline_stages, custom_fields, tags, forms. */
  const upsert = async (
    table: string, key: string, row: Record<string, unknown>,
  ): Promise<{ id: string; created: boolean }> => {
    const { data: existing, error: findErr } = await db.from(table).select("id")
      .eq("account_id", accountId).eq("blueprint_key", key).maybeSingle();
    if (findErr) throw new Error(`${table} lookup failed: ${findErr.message}`);
    if (existing) return { id: existing.id, created: false };

    const { data, error } = await db.from(table)
      .insert({ ...row, account_id: accountId, blueprint_key: key, origin: "blueprint" })
      .select("id").single();
    if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`);
    return { id: data.id, created: true };
  };

  for (const f of a.customFields ?? []) {
    await step(f.key, async () => {
      const { created } = await upsert("custom_fields", f.key, {
        model: f.model, field_key: f.fieldKey, name: f.name,
        data_type: f.dataType, options: f.options, position: f.position,
      });
      return created ? "created" : "skipped";
    });
  }

  for (const t of a.tags ?? []) {
    await step(t.key, async () => {
      const { created } = await upsert("tags", t.key, { name: t.name });
      return created ? "created" : "skipped";
    });
  }

  // custom_values did NOT get a blueprint_key/origin column in migration 0007
  // (its array is `['pipelines','pipeline_stages','custom_fields','tags',
  // 'forms']` — custom_values is deliberately absent because it already has a
  // real unique constraint, `unique (account_id, value_key)`, from 0003). So
  // idempotency here rests on that existing constraint instead of the shared
  // `upsert` helper above, which would otherwise select/insert a
  // `blueprint_key` column this table does not have.
  for (const v of a.customValues ?? []) {
    await step(v.key, async () => {
      const { data: existing, error: findErr } = await db.from("custom_values").select("id")
        .eq("account_id", accountId).eq("value_key", v.valueKey).maybeSingle();
      if (findErr) throw new Error(`custom_values lookup failed: ${findErr.message}`);
      if (existing) return "skipped";

      // Empty value, always. The key and name are the reusable part.
      const { error } = await db.from("custom_values")
        .insert({ account_id: accountId, value_key: v.valueKey, name: v.name, value: "" });
      if (error) throw new Error(`custom_values insert failed: ${error.message}`);
      return "created";
    });
  }

  for (const p of a.pipelines ?? []) {
    await step(p.key, async () => {
      const pipeline = await upsert("pipelines", p.key, { name: p.name, position: p.position });
      for (const s of p.stages) {
        await upsert("pipeline_stages", s.key, {
          pipeline_id: pipeline.id, name: s.name, position: s.position,
        });
      }
      return pipeline.created ? "created" : "skipped";
    });
  }

  for (const f of a.forms ?? []) {
    await step(f.key, async () => {
      const { created } = await upsert("forms", f.key, {
        // A fresh token every time: cloning it would collide on the global
        // unique index, and an empty notify list means leads cannot be routed
        // to the account this blueprint was captured from.
        public_id: newPublicId(),
        name: f.name, status: "draft", fields: f.fields, theme: f.theme,
        // success_mode/success_message/redirect_url are deliberately NOT
        // cloned from the bundle, even though the bundle still carries them
        // (see BlueprintBundle's forms field). A redirect authored for the
        // source tenant would send every lead on this cloned form to the
        // SOURCE tenant's website; a success message authored for the source
        // tenant would thank the visitor by the wrong business's name. Both
        // fail exactly as silently as the notify_emails case the design spec
        // calls out — the operator has to notice and fix it, same as they do
        // for notify_emails today. Every applied form starts as a plain
        // message using the platform's generic default (see `successFor` in
        // apps/web/src/app/f/[publicId]/actions.ts), which the operator can
        // override.
        success_mode: "message", success_message: null,
        redirect_url: null, notify_emails: [], locale_default: f.localeDefault,
      });
      return created ? "created" : "skipped";
    });
  }

  await emit(db, accountId, "blueprint.applied", actorId, {
    blueprintId, name: blueprint.name, version: blueprint.version,
    created: report.created.length, skipped: report.skipped.length,
    failed: report.failed.length,
  });

  return report;
}
