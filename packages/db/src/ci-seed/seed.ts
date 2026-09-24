/**
 * `ensureCiBaseline` gives the CI project the rows the test suites assume and
 * no script used to create (plan section 2): the seeded account and its
 * contact, pipeline, opportunity, custom field and phone number. It also
 * VERIFIES the rows it does not create — the agencies row (migration 0001)
 * and the public logo bucket (supabase/bootstrap/ci-project.sql) — so one
 * command answers "is this project ready for the suites".
 *
 * Idempotent by natural key, and additive only: it never updates or deletes.
 * Each natural key, and the constraint or rule behind it:
 *   account         clerk_org_id           (accounts.clerk_org_id is unique, 0001)
 *   pipeline        any pipeline at all    (ensureDefaultPipeline's own rule)
 *   contact         email_key              (createContact's dedupe, 0033/0034)
 *   custom field    (model, field_key)     (unique (account_id, model, field_key), 0003)
 *   opportunity     name                   (no constraint; looked up first)
 *   phone number    e164                   (phone_numbers.e164 is unique across ALL accounts, 0019)
 *
 * What it will NOT do is write through a conflict — an org id holding a
 * differently named account, the seeded name under another org, the number on
 * another account. Each would need a rename, a move or a delete of a row the
 * seed did not make, so it stops and names it instead (`seedConflicts`).
 *
 * The domain writes go through the domain modules (createAccount,
 * ensureDefaultPipeline, createContact, createCustomField, createOpportunity,
 * assignPhoneNumber), so the seeded rows are shaped exactly like rows the
 * product makes, events included.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAccount } from "../accounts";
import { ensureDefaultPipeline, createCustomField } from "../crm-config";
import { createContact, emailKey } from "../contacts";
import { createOpportunity } from "../opportunities";
import { assignPhoneNumber, getPhoneNumberByE164 } from "../voice";
import {
  CI_SEED_ACTOR, CI_SEED_BUCKET, CI_SEED_CONTACT, CI_SEED_FIELD, CI_SEED_OPPORTUNITY, CI_SEED_PIPELINE,
  type CiBaselineSpec,
} from "./config";

/** Everything the two decisions below read. `account` is the one the org id holds. */
export type BaselineSnapshot = {
  agencyCount: number;
  bucket: { public: boolean } | null;
  accountsNamed: { id: string; clerk_org_id: string }[];
  account: { id: string; name: string } | null;
  pipelines: { id: string; name: string; stageCount: number }[];
  contact: { id: string; first_name: string | null; last_name: string | null } | null;
  field: { id: string; data_type: string } | null;
  opportunity: { id: string; pipeline_id: string; contact_id: string | null } | null;
  phone: { id: string; account_id: string } | null;
};

/** One line per row the suites need that is absent or wrong. Empty = ready. */
export function baselineGaps(s: BaselineSnapshot, spec: CiBaselineSpec): string[] {
  const gaps: string[] = [];
  const who = `"${spec.name}"`;
  const c = CI_SEED_CONTACT;

  if (s.agencyCount === 0) gaps.push("no agencies row (0001_tenancy.sql inserts it; has db:push:ci run?)");
  if (!s.bucket) gaps.push(`storage bucket ${CI_SEED_BUCKET} is missing (supabase/bootstrap/ci-project.sql creates it)`);
  else if (!s.bucket.public) gaps.push(`storage bucket ${CI_SEED_BUCKET} is not public (logos render to anonymous visitors)`);

  if (s.accountsNamed.length === 0) gaps.push(`no account named ${who}`);
  else if (s.accountsNamed.length > 1) {
    gaps.push(`${s.accountsNamed.length} accounts are named ${who} (client-access.spec reads it with .single())`);
  } else if (s.accountsNamed[0]!.clerk_org_id !== spec.clerkOrgId) {
    gaps.push(`account ${who} has org id ${s.accountsNamed[0]!.clerk_org_id}, expected ${spec.clerkOrgId}`);
  }

  if (!s.contact) gaps.push(`no contact ${c.email} (${c.firstName} ${c.lastName}) on ${who}`);
  else if (s.contact.first_name !== c.firstName || s.contact.last_name !== c.lastName) {
    gaps.push(`contact ${c.email} is named "${s.contact.first_name ?? ""} ${s.contact.last_name ?? ""}", expected "${c.firstName} ${c.lastName}"`);
  }

  const sales = s.pipelines.find((p) => p.name === CI_SEED_PIPELINE);
  if (!sales) gaps.push(`no pipeline "${CI_SEED_PIPELINE}" on ${who}`);
  else if (sales.stageCount < 2) {
    gaps.push(`pipeline "${CI_SEED_PIPELINE}" has ${sales.stageCount} stage${sales.stageCount === 1 ? "" : "s"}; pipeline.spec needs more than one`);
  }

  if (!s.field) gaps.push(`no contact custom field ${CI_SEED_FIELD.fieldKey} on ${who}`);
  else if (s.field.data_type !== "single_select") {
    gaps.push(`custom field ${CI_SEED_FIELD.fieldKey} is ${s.field.data_type}, expected single_select`);
  }

  if (!s.opportunity) gaps.push(`no opportunity "${CI_SEED_OPPORTUNITY.name}" on ${who}`);
  else if (!sales || s.opportunity.pipeline_id !== sales.id) {
    gaps.push(`opportunity "${CI_SEED_OPPORTUNITY.name}" is not on pipeline "${CI_SEED_PIPELINE}"`);
  } else if (!s.contact || s.opportunity.contact_id !== s.contact.id) {
    gaps.push(`opportunity "${CI_SEED_OPPORTUNITY.name}" is not for ${c.email}`);
  }

  if (!s.phone || !s.account || s.phone.account_id !== s.account.id) {
    gaps.push(`phone number ${spec.phoneE164} is not on ${who}`);
  }
  return gaps;
}

/** What the seed refuses to write through. Empty = safe to add what is missing. */
export function seedConflicts(s: BaselineSnapshot, spec: CiBaselineSpec): string[] {
  const conflicts: string[] = [];
  if (s.account && s.account.name !== spec.name) {
    conflicts.push(`org ${spec.clerkOrgId} already holds account "${s.account.name}"; ci:seed will not rename it`);
  }
  const elsewhere = s.accountsNamed.find((a) => a.clerk_org_id !== spec.clerkOrgId);
  if (!s.account && elsewhere) {
    conflicts.push(`an account named "${spec.name}" already exists under org ${elsewhere.clerk_org_id}; ci:seed will not create a second`);
  }
  if (s.phone && (!s.account || s.phone.account_id !== s.account.id)) {
    conflicts.push(`phone number ${spec.phoneE164} belongs to another account; ci:seed will not move it`);
  }
  return conflicts;
}

/** Reads everything `baselineGaps` and `seedConflicts` decide on. Throws on any query error. */
export async function readBaselineSnapshot(db: SupabaseClient, spec: CiBaselineSpec): Promise<BaselineSnapshot> {
  const fail = (what: string, message: string): never => {
    throw new Error(`ci:seed could not read ${what}: ${message}`);
  };

  const agencies = await db.from("agencies").select("id", { count: "exact", head: true });
  if (agencies.error) fail("agencies", agencies.error.message);

  // "Not found" is an answer; anything else (permissions, network) is not,
  // and must not be reported as a missing bucket.
  const bucketRes = await db.storage.getBucket(CI_SEED_BUCKET);
  let bucket: BaselineSnapshot["bucket"] = null;
  if (bucketRes.error) {
    if (!/not found/i.test(bucketRes.error.message)) fail(`bucket ${CI_SEED_BUCKET}`, bucketRes.error.message);
  } else {
    bucket = { public: bucketRes.data.public };
  }

  const named = await db.from("accounts").select("id, clerk_org_id").eq("name", spec.name);
  if (named.error) fail("accounts by name", named.error.message);

  const byOrg = await db.from("accounts").select("id, name").eq("clerk_org_id", spec.clerkOrgId).maybeSingle();
  if (byOrg.error) fail("account by org id", byOrg.error.message);
  const account = (byOrg.data as BaselineSnapshot["account"]) ?? null;

  let phone: BaselineSnapshot["phone"] = null;
  const number = await getPhoneNumberByE164(db, spec.phoneE164);
  if (number) phone = { id: number.id, account_id: number.account_id };

  const snapshot: BaselineSnapshot = {
    agencyCount: agencies.count ?? 0,
    bucket,
    accountsNamed: (named.data ?? []) as BaselineSnapshot["accountsNamed"],
    account,
    pipelines: [], contact: null, field: null, opportunity: null,
    phone,
  };
  if (!account) return snapshot;

  const pipelines = await db.from("pipelines").select("id, name, pipeline_stages(id)").eq("account_id", account.id);
  if (pipelines.error) fail("pipelines", pipelines.error.message);
  snapshot.pipelines = ((pipelines.data ?? []) as { id: string; name: string; pipeline_stages: unknown[] | null }[])
    .map((p) => ({ id: p.id, name: p.name, stageCount: (p.pipeline_stages ?? []).length }));

  const contact = await db.from("contacts").select("id, first_name, last_name")
    .eq("account_id", account.id).eq("email_key", emailKey(CI_SEED_CONTACT.email))
    .order("created_at", { ascending: true }).limit(1);
  if (contact.error) fail("contact", contact.error.message);
  snapshot.contact = (contact.data?.[0] as BaselineSnapshot["contact"]) ?? null;

  const field = await db.from("custom_fields").select("id, data_type")
    .eq("account_id", account.id).eq("model", "contact").eq("field_key", CI_SEED_FIELD.fieldKey).maybeSingle();
  if (field.error) fail("custom field", field.error.message);
  snapshot.field = (field.data as BaselineSnapshot["field"]) ?? null;

  const opp = await db.from("opportunities").select("id, pipeline_id, contact_id")
    .eq("account_id", account.id).eq("name", CI_SEED_OPPORTUNITY.name)
    .order("created_at", { ascending: true }).limit(1);
  if (opp.error) fail("opportunity", opp.error.message);
  snapshot.opportunity = (opp.data?.[0] as BaselineSnapshot["opportunity"]) ?? null;

  return snapshot;
}

/**
 * Adds whatever of the baseline is missing, and returns the account and a
 * list of what it created (empty on a run that found everything in place).
 * Refuses, before writing anything, if `seedConflicts` finds a conflict.
 * Does not verify: the caller reads a fresh snapshot and checks
 * `baselineGaps`, so verification never trusts this function's own account.
 */
export async function ensureCiBaseline(
  db: SupabaseClient, spec: CiBaselineSpec,
): Promise<{ accountId: string; created: string[] }> {
  const before = await readBaselineSnapshot(db, spec);
  const conflicts = seedConflicts(before, spec);
  if (conflicts.length > 0) {
    throw new Error(`ci:seed refused, nothing written:\n${conflicts.map((c) => `  ${c}`).join("\n")}`);
  }

  const created: string[] = [];
  let accountId = before.account?.id;
  if (!accountId) {
    accountId = (await createAccount(db, { clerkOrgId: spec.clerkOrgId, name: spec.name, actorId: CI_SEED_ACTOR })).id;
    created.push("account");
  }

  // Only on an account with no pipeline at all: ensureDefaultPipeline returns
  // an existing one untouched, and a non-Sales pipeline is a gap to report,
  // not something to create around.
  let salesId = before.pipelines.find((p) => p.name === CI_SEED_PIPELINE)?.id;
  if (before.pipelines.length === 0) {
    salesId = (await ensureDefaultPipeline(db, accountId)).pipelineId;
    created.push("pipeline");
  }

  let contactId = before.contact?.id;
  if (!contactId) {
    const c = await createContact(db, accountId, {
      firstName: CI_SEED_CONTACT.firstName, lastName: CI_SEED_CONTACT.lastName, email: CI_SEED_CONTACT.email,
    }, CI_SEED_ACTOR, "system");
    contactId = c.id;
    created.push("contact");
  }

  if (!before.field) {
    await createCustomField(db, accountId, {
      model: "contact", fieldKey: CI_SEED_FIELD.fieldKey, name: CI_SEED_FIELD.name,
      dataType: "single_select", options: [...CI_SEED_FIELD.options],
    });
    created.push("custom field");
  }

  if (!before.opportunity && salesId) {
    await createOpportunity(db, accountId, {
      contactId, pipelineId: salesId, name: CI_SEED_OPPORTUNITY.name, value: CI_SEED_OPPORTUNITY.value,
    }, CI_SEED_ACTOR, "system");
    created.push("opportunity");
  }

  if (!before.phone) {
    await assignPhoneNumber(db, accountId, { e164: spec.phoneE164 }, CI_SEED_ACTOR, "system");
    created.push("phone number");
  }

  return { accountId, created };
}
