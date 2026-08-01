# M1d Blueprints v0 & Activation Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture an account's configuration as a reusable blueprint, apply it idempotently to a new account, and track the setup steps that cannot be cloned.

**Architecture:** Migration `0007` adds an agency-scoped `blueprints` table, an account-scoped `checklist_items` table holding *state only*, and `blueprint_key` / `origin` provenance columns on the five cloneable tables. A partial unique index on `(account_id, blueprint_key)` is the idempotency mechanism — apply is an upsert against it. The checklist catalogue lives in code and is merged with stored rows at read time, so a new catalogue item needs no backfill.

**Tech Stack:** Next.js 16 App Router (server actions), Supabase Postgres via PostgREST, `@bis/db` workspace package, Vitest, Playwright, Tailwind v4 semantic tokens. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-m1d-blueprints-design.md` — read it before Task 1.

## Global Constraints

- **`blueprints` is agency-scoped and its RLS policy is `app.is_agency()` alone.** Every other table is account-scoped and uses `app.is_agency() or account_id = app.current_account_id()`. Copying that pattern onto `blueprints` would reference an `account_id` column that does not exist.
- **Applied forms get a fresh `public_id`, an empty `notify_emails`, and `status='draft'`.** Cloning `public_id` collides on the global unique index; cloning `notify_emails` silently routes a new client's leads to the previous client's inbox; auto-publishing puts a live public URL into the world because someone picked from a dropdown.
- **`custom_values.value` is blanked on both capture and apply.** Keys and names clone. `{{business_name}}` exists so applied config re-points itself per tenant.
- **Never capture live data:** contacts, opportunities, conversations, messages, notes, tasks, form_submissions, events, users, or anything credential-shaped.
- **Apply is per-asset, not all-or-nothing.** It returns created / skipped / failed per asset and continues past a failure. This is only safe because apply is idempotent.
- **`accountId` on any server action is bound server-side** via `.bind(null, accountId)`, never a hidden input. A previous milestone shipped 12 latent IDORs from exactly that mistake.
- **A `"use server"` file may export only async functions.** Sync helpers go in a sibling module.
- **All user-visible strings from the `m` catalog**; semantic Tailwind tokens only. Design quality is first-class on this project.
- **The checklist copy must say its items are done elsewhere.** Every item except `form_notify` is external setup the platform cannot perform.
- **No new npm dependencies.**
- **Five gates green before every commit**, each run as its own unpiped command: `typecheck`, `lint`, `test`, `build`, `test:e2e`. Piping through `grep` swallows the exit code.

---

## File Structure

**`packages/db`**
- Create `supabase/migrations/0007_blueprints.sql` — two tables, provenance columns, RLS, indexes.
- Create `src/blueprints.ts` — capture, apply, and blueprint CRUD. One module: capture and apply share the bundle types and must stay in lockstep.
- Create `src/checklist.ts` — checklist state read/write. Separate because it has nothing to do with blueprints beyond appearing in the same milestone.
- Create `src/test/blueprints.test.ts`, `src/test/checklist.test.ts`
- Modify `src/index.ts` — exports.
- Modify `src/test/fixtures.ts` — cleanup order.

**`apps/web`**
- Create `src/lib/checklist-catalogue.ts` — the item catalogue and the merge helper. Pure, unit-testable, no DB.
- Create `src/lib/checklist-catalogue.test.ts`
- Create `src/app/(dashboard)/dashboard/blueprints/page.tsx`, `actions.ts`, `blueprints-table.tsx`
- Create `src/app/(dashboard)/dashboard/accounts/[accountId]/settings/save-blueprint-dialog.tsx`
- Create `src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/page.tsx`, `actions.ts`, `checklist-panel.tsx`
- Create `e2e/blueprints.spec.ts`
- Modify `src/components/app-sidebar.tsx` — Blueprints in the agency-level nav only.
- Modify `src/app/(dashboard)/dashboard/accounts/create-account-dialog.tsx`, `accounts/actions.ts` — optional blueprint on create.
- Modify `src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx` — checklist panel.
- Modify `src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx` — Save as blueprint.
- Modify `src/lib/messages.ts`

---

## Task 1: Migration 0007 and blueprint capture

**Files:**
- Create: `packages/db/supabase/migrations/0007_blueprints.sql`
- Create: `packages/db/src/blueprints.ts`
- Create: `packages/db/src/test/blueprints.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/test/fixtures.ts`

**Interfaces:**
- Consumes: `emit` from `./events`, `withTestAccount` from `./test/fixtures`.
- Produces: `captureBlueprint()`, `listBlueprints()`, `getBlueprint()`, and types `BlueprintBundle`, `BlueprintRow`, `BlueprintSummary`.

- [ ] **Step 1: Write the migration**

`packages/db/supabase/migrations/0007_blueprints.sql`:

```sql
-- M1d blueprints + activation checklist.
--
-- `blueprints` is AGENCY-scoped, not account-scoped: a blueprint belongs to the
-- agency and is applied *to* accounts. That is why its RLS policy is
-- app.is_agency() alone rather than the account_id comparison every other table
-- uses — there is no account_id column here to compare.

create table public.blueprints (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null,
  -- Counts recaptures of this blueprint's contents. Distinct from the bundle's
  -- own `schemaVersion`, which describes the shape of the jsonb.
  version int not null default 1,
  source_account_id uuid references public.accounts(id) on delete set null,
  assets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, name)
);

alter table public.blueprints enable row level security;
create policy blueprints_agency_all on public.blueprints for all to authenticated
  using (app.is_agency()) with check (app.is_agency());

-- State only. The catalogue of items lives in application code, so a catalogue
-- item has no row here until someone ticks it or writes a note, and adding a
-- new catalogue item later needs no backfill.
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  -- A catalogue key ('phone_number') or 'custom:<uuid>' for a free-text item.
  item_key text not null,
  -- Null for catalogue items, whose title comes from code. Set for custom
  -- items so their title survives independently of any catalogue.
  title text,
  done_at timestamptz,
  done_by text,
  note text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, item_key)
);

alter table public.checklist_items enable row level security;
create policy checklist_items_member_all on public.checklist_items for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- Provenance on every cloneable table. The partial unique index IS the
-- idempotency mechanism: apply upserts against it, so applying a blueprint
-- twice creates nothing twice. `origin` is written but read by nothing in v0 —
-- it exists so the deferred three-way merge needs no migration.
do $$
declare t text;
begin
  foreach t in array array['pipelines','pipeline_stages','custom_fields','tags','forms'] loop
    execute format('alter table public.%I add column blueprint_key text', t);
    execute format($f$alter table public.%I add column origin text not null default 'user'
                      check (origin in ('user','blueprint'))$f$, t);
    execute format('create unique index %I_blueprint_key_unique on public.%I (account_id, blueprint_key)
                      where blueprint_key is not null', t, t);
  end loop;
end $$;
```

- [ ] **Step 2: Apply the migration**

`pnpm --filter @bis/db db:push` does not source `packages/db/.env`, and this checkout is not `supabase link`-ed. From the repo root:

```bash
cd packages/db && set -a && . ./.env && set +a && npx supabase db push --db-url "$SUPABASE_DB_URL"
```

Expected: `Applying migration 0007_blueprints.sql...` then `Finished supabase db push.`

Migrations 0001–0006 are already applied to a shared dev database holding real rows. If the push wants to apply anything other than 0007, **stop and report** — the history is out of sync.

- [ ] **Step 3: Write the failing test**

`packages/db/src/test/blueprints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createCustomField, upsertCustomValue, ensureDefaultPipeline } from "../crm-config";
import { createForm, updateForm } from "../forms";
import { captureBlueprint, listBlueprints, getBlueprint } from "../blueprints";

async function seedConfig(db: any, accountId: string) {
  await ensureDefaultPipeline(db, accountId);
  await createCustomField(db, accountId, {
    model: "contact", fieldKey: "proj_type", name: "Project type",
    dataType: "single_select", options: ["Deck", "Fence"],
  });
  await upsertCustomValue(db, accountId, { valueKey: "business_name", name: "Business name", value: "Acme Decks" });
  const { id: formId } = await createForm(db, accountId, {
    name: "Quote Request",
    fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
  }, "user_test");
  await updateForm(db, accountId, formId, {
    status: "published", notify_emails: ["owner@acme.example"],
  }, "user_test");
  return { formId };
}

describe("blueprint capture", () => {
  it("captures configuration and excludes live data and tenant-specific values", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      await createContact(db, accountId, { firstName: "Maria", email: "maria@example.com" }, "user_test");

      const { id } = await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");
      const bp = await getBlueprint(db, id);

      expect(bp!.version).toBe(1);
      expect(bp!.assets.schemaVersion).toBe(1);
      expect(bp!.assets.pipelines.length).toBeGreaterThan(0);
      expect(bp!.assets.pipelines[0]!.stages.length).toBeGreaterThan(0);
      expect(bp!.assets.customFields[0]!.fieldKey).toBe("proj_type");
      expect(bp!.assets.forms[0]!.name).toBe("Quote Request");

      // The exclusions are the load-bearing part of this feature.
      const serialized = JSON.stringify(bp!.assets);
      expect(serialized).not.toContain("maria@example.com");   // no live data
      expect(serialized).not.toContain("owner@acme.example");  // no notify address
      expect(serialized).not.toContain("Acme Decks");          // custom value blanked
      expect(bp!.assets.customValues[0]!.valueKey).toBe("business_name");
      expect(bp!.assets.forms[0]).not.toHaveProperty("publicId");
      expect(bp!.assets.forms[0]).not.toHaveProperty("notifyEmails");
    }));

  it("recapturing the same name replaces the bundle and bumps version", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      const first = await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");

      await createCustomField(db, accountId, {
        model: "contact", fieldKey: "roof_age", name: "Roof age", dataType: "number",
      });
      const second = await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");

      expect(second.id).toBe(first.id);
      const bp = await getBlueprint(db, second.id);
      expect(bp!.version).toBe(2);
      expect(bp!.assets.customFields.map((f) => f.fieldKey).sort()).toEqual(["proj_type", "roof_age"]);

      expect(await listBlueprints(db)).toHaveLength(1);
    }));

  it("capture emits an event against the source account", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");

      const { data } = await db.from("events").select("type, actor_type")
        .eq("account_id", accountId).eq("type", "blueprint.captured");
      expect(data).toHaveLength(1);
      expect(data![0]!.actor_type).toBe("user");
    }));
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `pnpm --filter @bis/db test -- blueprints`
Expected: FAIL — `Failed to resolve import "../blueprints"`.

- [ ] **Step 5: Write the capture module**

`packages/db/src/blueprints.ts`:

```ts
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
```

- [ ] **Step 6: Export from the package index**

Append to `packages/db/src/index.ts`:

```ts
export { captureBlueprint, listBlueprints, getBlueprint, blueprintKey,
         BUNDLE_SCHEMA_VERSION,
         type BlueprintBundle, type BlueprintRow, type BlueprintSummary } from "./blueprints";
```

- [ ] **Step 7: Extend the test-account cleanup**

In `packages/db/src/test/fixtures.ts`, add `"checklist_items"` to the delete list (before `contacts`), and after the loop — before the `accounts` delete — remove blueprints captured from this account:

```ts
      await db.from("blueprints").delete().eq("source_account_id", id);
```

`blueprints` has no `account_id`, so it cannot ride the account-scoped loop.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @bis/db test -- blueprints`
Expected: PASS, 3 tests.

Then the whole package: `pnpm --filter @bis/db test`
Expected: PASS, 63 tests (60 existing + 3 new).

- [ ] **Step 9: Commit**

```bash
git add packages/db/supabase/migrations/0007_blueprints.sql packages/db/src/blueprints.ts \
        packages/db/src/test/blueprints.test.ts packages/db/src/index.ts packages/db/src/test/fixtures.ts
git commit -m "feat(db): blueprint capture with live data and tenant values excluded"
```

---

## Task 2: Idempotent apply

**Files:**
- Modify: `packages/db/src/blueprints.ts` (append)
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/test/blueprints.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `getBlueprint`, `BlueprintBundle`, `blueprintKey` from Task 1; `newPublicId` from `./forms`.
- Produces: `applyBlueprint(db, accountId, blueprintId, actorId)` → `Promise<ApplyReport>`, and type `ApplyReport`.

**Order matters and is not arbitrary:** a form's `fields` reference custom fields as `custom.<field_key>`, so custom fields must exist first. Stages depend on their pipeline's id.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/test/blueprints.test.ts`:

```ts
describe("blueprint apply", () => {
  it("applies configuration, and applying twice creates nothing twice", () =>
    withTestAccount(async (db, sourceId) => {
      await seedConfig(db, sourceId);
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        const first = await applyBlueprint(db2, targetId, blueprintId, "user_test");
        expect(first.failed).toHaveLength(0);
        expect(first.created.length).toBeGreaterThan(0);

        const countAll = async () => {
          const t = async (table: string) => {
            const { data } = await db2.from(table).select("id").eq("account_id", targetId);
            return data?.length ?? 0;
          };
          return {
            pipelines: await t("pipelines"), stages: await t("pipeline_stages"),
            fields: await t("custom_fields"), values: await t("custom_values"),
            forms: await t("forms"),
          };
        };
        const afterFirst = await countAll();
        expect(afterFirst.pipelines).toBeGreaterThan(0);
        expect(afterFirst.forms).toBe(1);

        // The whole point of the partial unique index.
        const second = await applyBlueprint(db2, targetId, blueprintId, "user_test");
        expect(second.created).toHaveLength(0);
        expect(second.skipped.length).toBeGreaterThan(0);
        expect(await countAll()).toEqual(afterFirst);
      });
    }));

  it("an applied form is a draft with its own public id and no notify address", () =>
    withTestAccount(async (db, sourceId) => {
      const { formId } = await seedConfig(db, sourceId);
      const { data: source } = await db.from("forms").select("public_id").eq("id", formId).single();
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        await applyBlueprint(db2, targetId, blueprintId, "user_test");
        const { data: applied } = await db2.from("forms")
          .select("public_id, notify_emails, status, origin, blueprint_key")
          .eq("account_id", targetId).single();

        // Sharing a token would collide on the global unique index — and if it
        // somehow did not, one client's URL would serve another's form.
        expect(applied!.public_id).not.toBe(source!.public_id);
        expect(applied!.notify_emails).toEqual([]);
        // Never publish a public URL because someone picked from a dropdown.
        expect(applied!.status).toBe("draft");
        expect(applied!.origin).toBe("blueprint");
        expect(applied!.blueprint_key).toBeTruthy();
      });
    }));

  it("applied custom values keep their key and name but not the source value", () =>
    withTestAccount(async (db, sourceId) => {
      await seedConfig(db, sourceId);
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        await applyBlueprint(db2, targetId, blueprintId, "user_test");
        const { data } = await db2.from("custom_values")
          .select("value_key, name, value").eq("account_id", targetId).single();
        expect(data!.value_key).toBe("business_name");
        expect(data!.name).toBe("Business name");
        expect(data!.value).toBe("");
      });
    }));

  it("clones no live data and emits blueprint.applied on the target", () =>
    withTestAccount(async (db, sourceId) => {
      await seedConfig(db, sourceId);
      await createContact(db, sourceId, { firstName: "Maria", email: "maria@example.com" }, "user_test");
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        await applyBlueprint(db2, targetId, blueprintId, "user_test");

        const { data: contacts } = await db2.from("contacts").select("id").eq("account_id", targetId);
        expect(contacts).toHaveLength(0);

        const { data: ev } = await db2.from("events").select("payload, actor_type")
          .eq("account_id", targetId).eq("type", "blueprint.applied");
        expect(ev).toHaveLength(1);
        expect((ev![0]!.payload as any).blueprintId).toBe(blueprintId);
        expect((ev![0]!.payload as any).version).toBe(1);
      });
    }));

  it("a form referencing a custom field resolves because fields apply first", () =>
    withTestAccount(async (db, sourceId) => {
      await ensureDefaultPipeline(db, sourceId);
      await createCustomField(db, sourceId, {
        model: "contact", fieldKey: "proj_type", name: "Project type", dataType: "text",
      });
      await createForm(db, sourceId, {
        name: "Quote", fields: [
          { key: "custom_proj_type", kind: "custom.proj_type", label: "Project type", required: false },
        ],
      }, "user_test");
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        const report = await applyBlueprint(db2, targetId, blueprintId, "user_test");
        expect(report.failed).toHaveLength(0);

        const { data: field } = await db2.from("custom_fields")
          .select("field_key").eq("account_id", targetId).single();
        const { data: form } = await db2.from("forms")
          .select("fields").eq("account_id", targetId).single();
        expect(field!.field_key).toBe("proj_type");
        expect((form!.fields as any[])[0].kind).toBe("custom.proj_type");
      });
    }));

  it("reports a missing blueprint instead of throwing", () =>
    withTestAccount(async (db, accountId) => {
      await expect(
        applyBlueprint(db, accountId, "00000000-0000-0000-0000-000000000000", "user_test"),
      ).rejects.toThrow(/not found/i);
    }));
});
```

Add `applyBlueprint` to the import at the top of the file.

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @bis/db test -- blueprints`
Expected: FAIL — `applyBlueprint is not exported`.

- [ ] **Step 3: Write apply**

Append to `packages/db/src/blueprints.ts`:

```ts
import { newPublicId } from "./forms";

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
   *  row id either way so dependents (stages) can attach to it. */
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

  for (const v of a.customValues ?? []) {
    await step(v.key, async () => {
      // Empty value, always. The key and name are the reusable part.
      const { created } = await upsert("custom_values", v.key, {
        value_key: v.valueKey, name: v.name, value: "",
      });
      return created ? "created" : "skipped";
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
        success_mode: f.successMode, success_message: f.successMessage,
        redirect_url: f.redirectUrl, notify_emails: [], locale_default: f.localeDefault,
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
```

- [ ] **Step 4: Export it**

Extend the `./blueprints` export in `packages/db/src/index.ts` with `applyBlueprint, type ApplyReport`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @bis/db test`
Expected: PASS, 69 tests (63 + 6 new).

If the nested `withTestAccount` in these tests trips the fixture's cleanup ordering, report it rather than loosening an assertion — the nesting is deliberate, because apply must be proven against a genuinely different account.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/blueprints.ts packages/db/src/index.ts packages/db/src/test/blueprints.test.ts
git commit -m "feat(db): idempotent blueprint apply with per-asset reporting"
```

---

## Task 3: Checklist state and catalogue

**Files:**
- Create: `packages/db/src/checklist.ts`
- Create: `packages/db/src/test/checklist.test.ts`
- Create: `apps/web/src/lib/checklist-catalogue.ts`
- Create: `apps/web/src/lib/checklist-catalogue.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `listChecklistState()`, `setChecklistItem()`, `addCustomChecklistItem()`, type `ChecklistStateRow` (db); `CHECKLIST_CATALOGUE`, `mergeChecklist()`, type `ChecklistEntry` (web).

**The split is deliberate.** The database stores *state*; the catalogue of items lives in code so each can carry help text and a link, and so a new item appears for every account with no backfill. The merge is a pure function and is unit-tested without a database.

- [ ] **Step 1: Write the failing db test**

`packages/db/src/test/checklist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listChecklistState, setChecklistItem, addCustomChecklistItem } from "../checklist";

describe("checklist state", () => {
  it("a fresh account has no rows — the catalogue lives in code", () =>
    withTestAccount(async (db, accountId) => {
      expect(await listChecklistState(db, accountId)).toHaveLength(0);
    }));

  it("ticking an item creates its row, and un-ticking clears done_at", () =>
    withTestAccount(async (db, accountId) => {
      await setChecklistItem(db, accountId, "phone_number", { done: true }, "user_test");
      let [row] = await listChecklistState(db, accountId);
      expect(row!.item_key).toBe("phone_number");
      expect(row!.done_at).not.toBeNull();
      expect(row!.done_by).toBe("user_test");

      await setChecklistItem(db, accountId, "phone_number", { done: false }, "user_test");
      [row] = await listChecklistState(db, accountId);
      expect(row!.done_at).toBeNull();
    }));

  it("setting the same item twice updates one row rather than adding another", () =>
    withTestAccount(async (db, accountId) => {
      await setChecklistItem(db, accountId, "a2p_registration", { done: true }, "user_test");
      await setChecklistItem(db, accountId, "a2p_registration", { note: "submitted 2026-07-31" }, "user_test");

      const rows = await listChecklistState(db, accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.note).toBe("submitted 2026-07-31");
      // A note must not silently un-tick the item.
      expect(rows[0]!.done_at).not.toBeNull();
    }));

  it("a custom item stores its own title and gets a custom: key", () =>
    withTestAccount(async (db, accountId) => {
      const { itemKey } = await addCustomChecklistItem(db, accountId, "Order branded signage", "user_test");
      expect(itemKey).toMatch(/^custom:/);

      const [row] = await listChecklistState(db, accountId);
      expect(row!.title).toBe("Order branded signage");
    }));
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @bis/db test -- checklist`
Expected: FAIL — cannot resolve `../checklist`.

- [ ] **Step 3: Write the db module**

`packages/db/src/checklist.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChecklistStateRow = {
  id: string; item_key: string; title: string | null;
  done_at: string | null; done_by: string | null; note: string | null; position: number;
};

const COLS = "id, item_key, title, done_at, done_by, note, position";

/** Returns only rows that exist. A catalogue item with no row has never been
 *  touched; the caller merges these against the code catalogue. */
export async function listChecklistState(
  db: SupabaseClient, accountId: string,
): Promise<ChecklistStateRow[]> {
  const { data, error } = await db.from("checklist_items").select(COLS)
    .eq("account_id", accountId).order("position").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ChecklistStateRow[];
}

/**
 * Creates or updates one item's state. `done` and `note` are independent: a
 * caller passing only a note must not un-tick the item, which is why each is
 * applied only when explicitly present.
 */
export async function setChecklistItem(
  db: SupabaseClient, accountId: string, itemKey: string,
  patch: { done?: boolean; note?: string }, actorId: string,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.done !== undefined) {
    row.done_at = patch.done ? new Date().toISOString() : null;
    row.done_by = patch.done ? actorId : null;
  }
  if (patch.note !== undefined) row.note = patch.note;

  const { data: existing, error: findErr } = await db.from("checklist_items").select("id")
    .eq("account_id", accountId).eq("item_key", itemKey).maybeSingle();
  if (findErr) throw new Error(`checklist lookup failed: ${findErr.message}`);

  if (existing) {
    const { error } = await db.from("checklist_items").update(row).eq("id", existing.id);
    if (error) throw new Error(`setChecklistItem failed: ${error.message}`);
    return;
  }

  const { error } = await db.from("checklist_items")
    .insert({ account_id: accountId, item_key: itemKey, ...row });
  if (error) throw new Error(`setChecklistItem failed: ${error.message}`);
}

/** Custom items carry their own title because no catalogue entry defines them. */
export async function addCustomChecklistItem(
  db: SupabaseClient, accountId: string, title: string, actorId: string,
): Promise<{ itemKey: string }> {
  const itemKey = `custom:${randomUUID()}`;
  const { error } = await db.from("checklist_items")
    .insert({ account_id: accountId, item_key: itemKey, title, position: 100 });
  if (error) throw new Error(`addCustomChecklistItem failed: ${error.message}`);
  void actorId;
  return { itemKey };
}
```

Export from `packages/db/src/index.ts`:

```ts
export { listChecklistState, setChecklistItem, addCustomChecklistItem,
         type ChecklistStateRow } from "./checklist";
```

- [ ] **Step 4: Write the failing catalogue test**

`apps/web/src/lib/checklist-catalogue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CHECKLIST_CATALOGUE, mergeChecklist } from "./checklist-catalogue";

describe("checklist catalogue", () => {
  it("every catalogue item states that it is done outside the platform", () => {
    // The one requirement that keeps this from being theatre: a checklist
    // implying the app will buy you a phone number is worse than none.
    for (const item of CHECKLIST_CATALOGUE) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.help.length).toBeGreaterThan(0);
      expect(typeof item.external).toBe("boolean");
    }
    expect(CHECKLIST_CATALOGUE.filter((i) => i.external).length)
      .toBe(CHECKLIST_CATALOGUE.length - 1); // only form_notify is internal
    expect(CHECKLIST_CATALOGUE.find((i) => i.key === "form_notify")!.external).toBe(false);
  });

  it("merges catalogue items with stored state, including untouched ones", () => {
    const entries = mergeChecklist([
      { id: "1", item_key: "phone_number", title: null, done_at: "2026-07-31T00:00:00Z",
        done_by: "user_1", note: "ported", position: 0 },
    ]);

    const phone = entries.find((e) => e.key === "phone_number")!;
    expect(phone.done).toBe(true);
    expect(phone.note).toBe("ported");
    expect(phone.title).toBe(CHECKLIST_CATALOGUE.find((i) => i.key === "phone_number")!.title);

    // An untouched catalogue item still appears, undone.
    expect(entries.find((e) => e.key === "a2p_registration")!.done).toBe(false);
    expect(entries).toHaveLength(CHECKLIST_CATALOGUE.length);
  });

  it("includes custom items and uses their stored title", () => {
    const entries = mergeChecklist([
      { id: "2", item_key: "custom:abc", title: "Order signage", done_at: null,
        done_by: null, note: null, position: 100 },
    ]);
    const custom = entries.find((e) => e.key === "custom:abc")!;
    expect(custom.title).toBe("Order signage");
    expect(custom.custom).toBe(true);
    expect(entries).toHaveLength(CHECKLIST_CATALOGUE.length + 1);
  });

  it("drops a stored row whose catalogue key no longer exists", () => {
    // Retiring a catalogue item must not crash every account that ticked it.
    const entries = mergeChecklist([
      { id: "3", item_key: "retired_item", title: null, done_at: null,
        done_by: null, note: null, position: 0 },
    ]);
    expect(entries.find((e) => e.key === "retired_item")).toBeUndefined();
    expect(entries).toHaveLength(CHECKLIST_CATALOGUE.length);
  });
});
```

- [ ] **Step 5: Write the catalogue**

`apps/web/src/lib/checklist-catalogue.ts`:

```ts
import type { ChecklistStateRow } from "@bis/db";

export type CatalogueItem = {
  key: string;
  title: string;
  help: string;
  /** True when the work happens outside this platform. The UI must say so —
   *  a checklist implying the app performs these is a lie it tells daily. */
  external: boolean;
  href?: string;
};

export const CHECKLIST_CATALOGUE: CatalogueItem[] = [
  { key: "phone_number", title: "Buy a phone number",
    help: "Done in Telnyx. Calling and SMS arrive in M2 — until then this is a record that the number exists.",
    external: true },
  { key: "a2p_registration", title: "Register A2P 10DLC brand and campaign",
    help: "Done with the carriers via Telnyx. Expect days to weeks; start it early because nothing you do here speeds it up.",
    external: true },
  { key: "email_domain", title: "Add a sending subdomain and DKIM",
    help: "Done in Resend, then the DNS records at the domain host. A subdomain keeps this client's sending reputation separate.",
    external: true, href: "https://resend.com/domains" },
  { key: "form_notify", title: "Set the notification address on each form",
    help: "Done here. Forms applied from a blueprint deliberately start with an empty notify list so leads cannot reach the previous client.",
    external: false },
  { key: "gbp_connect", title: "Connect Google Business Profile",
    help: "Done in Google. Review management arrives in M5.",
    external: true },
  { key: "invite_owner", title: "Invite the business owner",
    help: "Done in Clerk until per-account roles exist.",
    external: true },
];

export type ChecklistEntry = {
  key: string; title: string; help: string; external: boolean; href?: string;
  custom: boolean; done: boolean; note: string | null;
};

/**
 * Merges the code catalogue with stored state.
 *
 * A catalogue item with no row appears undone — which is why a new catalogue
 * item needs no backfill. A stored row whose key is no longer in the catalogue
 * is dropped rather than rendered untitled, so retiring an item cannot break
 * an account that had ticked it.
 */
export function mergeChecklist(rows: ChecklistStateRow[]): ChecklistEntry[] {
  const byKey = new Map(rows.map((r) => [r.item_key, r]));

  const catalogue: ChecklistEntry[] = CHECKLIST_CATALOGUE.map((item) => {
    const row = byKey.get(item.key);
    return {
      key: item.key, title: item.title, help: item.help,
      external: item.external, href: item.href, custom: false,
      done: Boolean(row?.done_at), note: row?.note ?? null,
    };
  });

  const custom: ChecklistEntry[] = rows
    .filter((r) => r.item_key.startsWith("custom:"))
    .map((r) => ({
      key: r.item_key, title: r.title ?? "", help: "", external: false,
      custom: true, done: Boolean(r.done_at), note: r.note ?? null,
    }));

  return [...catalogue, ...custom];
}
```

- [ ] **Step 6: Run both suites**

Run: `pnpm --filter @bis/db test -- checklist` → PASS, 4 tests.
Run: `pnpm --filter web test -- checklist-catalogue` → PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/checklist.ts packages/db/src/test/checklist.test.ts \
        packages/db/src/index.ts apps/web/src/lib/checklist-catalogue.ts \
        apps/web/src/lib/checklist-catalogue.test.ts
git commit -m "feat(checklist): state storage plus a code-owned item catalogue"
```

---

## Task 4: Blueprints screen and "Save as blueprint"

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/blueprints/page.tsx`, `actions.ts`, `blueprints-table.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/save-blueprint-dialog.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `listBlueprints`, `captureBlueprint` from `@bis/db`; `requireAgency` from `@/lib/auth`.
- Produces: `captureBlueprintAction(accountId, formData)`.

**Nav placement:** Blueprints belongs to the **agency-level** nav array only — the branch in `app-sidebar.tsx` that currently renders just "Companies" when no account is active. It must not appear in the in-account list, which stays at seven items.

- [ ] **Step 1: Add strings**

Append to the `m` object in `apps/web/src/lib/messages.ts`:

```ts
  "nav.blueprints": "Blueprints",
  "blueprints.title": "Blueprints",
  "blueprints.empty.title": "No blueprints yet",
  "blueprints.empty.body": "Set an account up the way you like it, then save its configuration here to reuse on the next client.",
  "blueprints.version": "Version",
  "blueprints.captured": "Captured",
  "blueprints.applied": "Applied to",
  "blueprints.appliedCount": "accounts",
  "blueprints.save": "Save as blueprint",
  "blueprints.saveHint": "Copies this account's pipelines, custom fields, tags, custom values and forms. Never contacts, conversations, or anything with a credential in it.",
  "blueprints.name": "Blueprint name",
  "blueprints.saved": "Blueprint saved",
  "blueprints.saveFailed": "Could not save the blueprint.",
```

- [ ] **Step 2: Add the nav item**

In `apps/web/src/components/app-sidebar.tsx`, import `Layers` from `lucide-react` and extend the **agency-level** branch of `items`:

```ts
    : [
        { href: "/dashboard/accounts", label: m["nav.accounts"], icon: Building2 },
        { href: "/dashboard/blueprints", label: m["nav.blueprints"], icon: Layers },
      ];
```

- [ ] **Step 3: Write the capture action**

`apps/web/src/app/(dashboard)/dashboard/blueprints/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, captureBlueprint } from "@bis/db";

export async function captureBlueprintAction(
  accountId: string, formData: FormData,
): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("blueprint name required");

  await captureBlueprint(serviceDb(), accountId, { name }, userId);

  revalidatePath("/dashboard/blueprints");
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}
```

`accountId` is a bound parameter, never a form field.

- [ ] **Step 4: Write the list screen**

`apps/web/src/app/(dashboard)/dashboard/blueprints/page.tsx`:

```tsx
import { Layers } from "lucide-react";
import { serviceDb, listBlueprints } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/format";
import { m } from "@/lib/messages";
import { BlueprintsTable } from "./blueprints-table";

export const dynamic = "force-dynamic";

export default async function BlueprintsPage() {
  const blueprints = await listBlueprints(serviceDb());

  return (
    <>
      <PageHeader title={m["blueprints.title"]} />
      <div className="p-6">
        {blueprints.length === 0 ? (
          <EmptyState icon={Layers} title={m["blueprints.empty.title"]} body={m["blueprints.empty.body"]} />
        ) : (
          <BlueprintsTable
            rows={blueprints.map((b) => ({
              id: b.id, name: b.name, version: b.version,
              captured: formatDateTime(b.created_at), appliedCount: b.appliedCount,
            }))}
          />
        )}
      </div>
    </>
  );
}
```

`apps/web/src/app/(dashboard)/dashboard/blueprints/blueprints-table.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { m } from "@/lib/messages";

export function BlueprintsTable({
  rows,
}: { rows: { id: string; name: string; version: number; captured: string; appliedCount: number }[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-card-foreground">{row.name}</span>
            <span className="block text-xs text-muted-foreground">
              {m["blueprints.captured"]} {row.captured}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {m["blueprints.applied"]} {row.appliedCount} {m["blueprints.appliedCount"]}
            </span>
            <Badge variant="secondary">{m["blueprints.version"]} {row.version}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Write the save dialog and mount it**

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/save-blueprint-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

export function SaveBlueprintDialog({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{m["blueprints.save"]}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{m["blueprints.save"]}</DialogTitle></DialogHeader>
        <form
          action={async (formData) => {
            try { await action(formData); toast.success(m["blueprints.saved"]); setOpen(false); }
            catch { toast.error(m["blueprints.saveFailed"]); }
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="bp-name">{m["blueprints.name"]}</Label>
            <Input id="bp-name" name="name" required autoFocus />
            <p className="text-xs text-muted-foreground">{m["blueprints.saveHint"]}</p>
          </div>
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

In `settings/page.tsx`, import both and render the dialog in the `PageHeader`'s `actions` slot:

```tsx
import { SaveBlueprintDialog } from "./save-blueprint-dialog";
import { captureBlueprintAction } from "../../../blueprints/actions";
```
```tsx
      actions={<SaveBlueprintDialog action={captureBlueprintAction.bind(null, accountId)} />}
```

If `PageHeader` on that screen has no `actions` prop in use, add it the way `forms/page.tsx` does.

- [ ] **Step 6: Gates and a walkthrough**

Run each separately and report exit codes: `pnpm --filter web typecheck`, `lint`, `test`, `build`.

Then with the dev server up: open an account's Settings, save a blueprint, and confirm it appears at `/dashboard/blueprints` with version 1. Save again with the same name and confirm it shows version 2 rather than a second row. Confirm the sidebar shows Blueprints **only** at agency level, not inside an account.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(blueprints): agency blueprints screen and save-as-blueprint"
```

---

## Task 5: Apply a blueprint when creating an account

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/create-account-dialog.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `applyBlueprint`, `listBlueprints` from `@bis/db`; the existing `createClientAccount` action.

- [ ] **Step 1: Add strings**

```ts
  "accounts.blueprint": "Apply a blueprint",
  "accounts.blueprintNone": "Don't apply one",
  "accounts.blueprintHint": "Copies configuration into the new company. You can apply one later instead.",
  "accounts.blueprintPartial": "The company was created, but some blueprint items did not apply. Open it and apply the blueprint again.",
```

- [ ] **Step 2: Extend the create action**

In `accounts/actions.ts`, read an optional `blueprintId` and apply it after the account exists:

```ts
  const blueprintId = String(formData.get("blueprintId") ?? "").trim();
  if (blueprintId) {
    // Deliberately after creation and deliberately non-fatal: the company is
    // already real, and apply is idempotent, so the remedy for a partial run is
    // to apply again rather than to lose the account.
    try {
      const report = await applyBlueprint(serviceDb(), id, blueprintId, userId);
      if (report.failed.length > 0) {
        console.error(`blueprint ${blueprintId} partially applied to ${id}:`,
          report.failed.map((f) => `${f.key}: ${f.error}`).join("; "));
      }
    } catch (e) {
      console.error(`blueprint apply failed for account ${id}: ${String(e)}`);
    }
  }
```

Add `applyBlueprint` to the `@bis/db` import. Keep the existing redirect, but send the operator to the new account's checklist:

```ts
  redirect(`/dashboard/accounts/${id}/checklist`);
```

- [ ] **Step 3: Add the select to the dialog**

`create-account-dialog.tsx` gains a `blueprints` prop and a `Select` matching the pattern in `contact-fields-panel.tsx`:

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="acct-blueprint">{m["accounts.blueprint"]}</Label>
            <Select name="blueprintId" defaultValue="">
              <SelectTrigger id="acct-blueprint"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">{m["accounts.blueprintNone"]}</SelectItem>
                {blueprints.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{m["accounts.blueprintHint"]}</p>
          </div>
```

Render nothing for this block when `blueprints.length === 0` — an empty dropdown is worse than no dropdown.

`accounts/page.tsx` passes `blueprints={await listBlueprints(serviceDb())}`.

- [ ] **Step 4: Gates and a walkthrough**

All four gates, each separate. Then: create a company with a blueprint selected, land on its checklist, and confirm the pipelines, custom fields, tags and a **draft** form arrived. Create another with "Don't apply one" and confirm it has none of that. Clean up both accounts afterwards; do not touch the seeded "Test Client One".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(blueprints): apply a blueprint while creating a company"
```

---

## Task 6: The activation checklist panel

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/page.tsx`, `actions.ts`, `checklist-panel.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `listChecklistState`, `setChecklistItem`, `addCustomChecklistItem` from `@bis/db`; `mergeChecklist`, `CHECKLIST_CATALOGUE` from `@/lib/checklist-catalogue`.
- Produces: `setChecklistItemAction(accountId, formData)`, `addChecklistItemAction(accountId, formData)`.

**Not a sidebar item.** It renders as a panel on the account Dashboard and has its own route for deep-linking. It is something you finish once, not a place you work.

- [ ] **Step 1: Add strings**

```ts
  "checklist.title": "Activation checklist",
  "checklist.body": "What's left before this company is live.",
  "checklist.external": "Done outside BIS",
  "checklist.formNotify": "forms still have no notification address",
  "checklist.addItem": "Add a step",
  "checklist.addPlaceholder": "Something else this client needs…",
  "checklist.complete": "Everything on the checklist is done.",
  "checklist.remaining": "remaining",
  "checklist.open": "Open",
```

- [ ] **Step 2: Write the actions**

`checklist/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, setChecklistItem, addCustomChecklistItem } from "@bis/db";

export async function setChecklistItemAction(
  accountId: string, formData: FormData,
): Promise<void> {
  const { userId } = await requireAgency();
  const itemKey = String(formData.get("itemKey") ?? "");
  if (!itemKey) throw new Error("itemKey required");

  await setChecklistItem(serviceDb(), accountId, itemKey,
    { done: formData.get("done") === "true" }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}

export async function addChecklistItemAction(
  accountId: string, formData: FormData,
): Promise<void> {
  const { userId } = await requireAgency();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");

  await addCustomChecklistItem(serviceDb(), accountId, title, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}
```

- [ ] **Step 3: Write the panel**

`checklist/checklist-panel.tsx`:

```tsx
import { ExternalLink } from "lucide-react";
import type { ChecklistEntry } from "@/lib/checklist-catalogue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { m } from "@/lib/messages";

export function ChecklistPanel({
  entries, formsMissingNotify, setAction, addAction,
}: {
  entries: ChecklistEntry[];
  formsMissingNotify: number;
  setAction: (formData: FormData) => Promise<void>;
  addAction: (formData: FormData) => Promise<void>;
}) {
  const remaining = entries.filter((e) => !e.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          {m["checklist.title"]}
          {remaining > 0 ? (
            <Badge variant="secondary">{remaining} {m["checklist.remaining"]}</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {remaining === 0 ? m["checklist.complete"] : m["checklist.body"]}
        </p>

        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-start gap-3 py-2.5">
              <form action={setAction} className="pt-0.5">
                <input type="hidden" name="itemKey" value={entry.key} />
                <input type="hidden" name="done" value={entry.done ? "false" : "true"} />
                <button
                  type="submit"
                  aria-label={entry.title}
                  aria-pressed={entry.done}
                  className="size-4 rounded border border-input bg-background data-[done=true]:bg-primary"
                  data-done={entry.done}
                />
              </form>
              <div className="min-w-0 flex-1">
                <p className={entry.done
                  ? "text-sm text-muted-foreground line-through"
                  : "text-sm text-card-foreground"}>
                  {entry.title}
                </p>
                {entry.help ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.help}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {/* Say plainly that the platform does not do these. */}
                  {entry.external ? (
                    <Badge variant="secondary">{m["checklist.external"]}</Badge>
                  ) : null}
                  {entry.key === "form_notify" && formsMissingNotify > 0 ? (
                    <span className="text-xs text-destructive">
                      {formsMissingNotify} {m["checklist.formNotify"]}
                    </span>
                  ) : null}
                  {entry.href ? (
                    <a href={entry.href} target="_blank" rel="noreferrer"
                       className="flex items-center gap-1 text-xs text-primary underline">
                      <ExternalLink className="size-3" aria-hidden />
                      {m["checklist.open"]}
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <form action={addAction} className="flex gap-2 pt-1">
          <Input name="title" placeholder={m["checklist.addPlaceholder"]} className="h-8 text-sm" required />
          <Button type="submit" variant="outline" size="sm">{m["checklist.addItem"]}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write the route and mount the panel**

`checklist/page.tsx` loads state and renders the panel inside the shell:

```tsx
import { notFound } from "next/navigation";
import { serviceDb, listChecklistState, listForms } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { m } from "@/lib/messages";
import { ChecklistPanel } from "./checklist-panel";
import { setChecklistItemAction, addChecklistItemAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceDb();
  const [rows, forms] = await Promise.all([
    listChecklistState(db, accountId),
    listForms(db, accountId),
  ]);
  if (!rows && !forms) notFound();

  return (
    <>
      <PageHeader title={m["checklist.title"]} />
      <div className="max-w-2xl p-6">
        <ChecklistPanel
          entries={mergeChecklist(rows)}
          formsMissingNotify={0}
          setAction={setChecklistItemAction.bind(null, accountId)}
          addAction={addChecklistItemAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
```

`listForms` returns no `notify_emails`, so `formsMissingNotify` needs a direct count. Add to `packages/db/src/forms.ts`:

```ts
export async function countFormsMissingNotify(
  db: SupabaseClient, accountId: string,
): Promise<number> {
  const { count, error } = await db.from("forms")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("notify_emails", "{}");
  if (error) throw new Error(`countFormsMissingNotify failed: ${error.message}`);
  return count ?? 0;
}
```

Export it, use it in place of the `0` above, and drop the unused `listForms` import if it is no longer needed.

Then render the same panel on the account Dashboard, above the existing content, only while `remaining > 0` — a finished checklist should stop occupying the screen.

- [ ] **Step 5: Gates and a walkthrough**

All four gates separately. Then: open a new account's checklist, tick an item and reload to confirm it persisted, un-tick it, add a custom step, and confirm the external badge and help text read as "you do this elsewhere". Confirm the panel appears on the account Dashboard while items remain and disappears when all are ticked.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src packages/db/src
git commit -m "feat(checklist): activation checklist panel and route"
```

---

## Task 7: End-to-end coverage and the final gate

**Files:**
- Create: `apps/web/e2e/blueprints.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const ACCOUNT_NAME = "Test Client One";

test("a blueprint captured from one company applies to a new one", async ({ page }) => {
  const stamp = Date.now();
  const blueprintName = `E2E Blueprint ${stamp}`;
  const companyName = `E2E Co ${stamp}`;

  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await page.getByRole("link", { name: "Settings" }).click();

  await page.getByRole("button", { name: "Save as blueprint" }).click();
  await page.getByLabel("Blueprint name").fill(blueprintName);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.goto("/dashboard/blueprints");
  await expect(page.getByText(blueprintName)).toBeVisible();

  await page.goto("/dashboard/accounts");
  await page.getByRole("button", { name: /add company/i }).click();
  await page.getByLabel("Business name").fill(companyName);
  await page.getByRole("combobox", { name: "Apply a blueprint" }).click();
  await page.getByRole("option", { name: blueprintName }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // The onboarding path ends on the checklist, not on a blank dashboard.
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(page.getByText("Activation checklist")).toBeVisible();

  await page.getByRole("button", { name: "Buy a phone number" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Buy a phone number" }))
    .toHaveAttribute("aria-pressed", "true");

  // Cleanup: this writes real rows to the shared dev database.
  const db = serviceDb();
  const { data: acct } = await db.from("accounts").select("id").eq("name", companyName).single();
  if (acct) {
    for (const t of ["checklist_items", "events", "form_submissions", "forms",
                     "pipeline_stages", "pipelines", "custom_fields", "custom_values",
                     "tags", "contacts"]) {
      await db.from(t).delete().eq("account_id", acct.id);
    }
    await db.from("accounts").delete().eq("id", acct.id);
  }
  await db.from("blueprints").delete().eq("name", blueprintName);
});
```

- [ ] **Step 2: Run it twice**

Run: `pnpm --filter web test:e2e -- blueprints`
Expected: 1 passed.

Agent test claims have proven unreliable on this project — a spec once reported clean three times and failed on a fresh run. Run it **twice** and confirm both pass before reporting.

- [ ] **Step 3: Full suite and gates**

Run: `pnpm --filter web test:e2e` → 12 passed (11 existing + 1 new).
Run each separately: `pnpm --filter web typecheck`, `lint`, `test`, `build`, and `pnpm --filter @bis/db test`.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add apps/web/e2e/blueprints.spec.ts
git commit -m "test(blueprints): end-to-end capture, apply and checklist"
git push -u origin feat/m1d-blueprints
gh pr create --title "M1d: blueprints v0 and activation checklist" --body "See docs/superpowers/specs/2026-07-31-m1d-blueprints-design.md"
```

---

## Self-Review

**Spec coverage.** §3 data model → Task 1. §4 bundle and exclusions → Tasks 1–2, asserted in both. §5 capture and apply → Tasks 1–2. §6 surfaces → Tasks 4–6. §7 testing → Tasks 1–3 and 7. §9 success criteria all map to a test except "a partial apply reports which assets failed", which is covered by the `ApplyReport` shape and Task 5's non-fatal handling but has no forced-failure test — recorded as a known gap rather than hidden, and worth adding when a plausible failure injection exists.

**One deviation from the spec:** §6 said the checklist "renders as a panel on the account Dashboard, with a deep-linkable route". Task 6 builds the route first and mounts the same component on the Dashboard, because the route is what Task 5's redirect needs. Same outcome, opposite build order.

**Type consistency checked:** `BlueprintBundle`, `BlueprintRow`, `BlueprintSummary` (Task 1) are consumed unchanged by Tasks 2 and 4. `ApplyReport` (Task 2) is consumed by Task 5. `ChecklistStateRow` (Task 3, db) feeds `mergeChecklist` (Task 3, web) and both are consumed by Task 6. `blueprintKey(prefix, name)` is defined once and used only inside capture.


