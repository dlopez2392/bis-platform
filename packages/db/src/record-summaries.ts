import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Item 8a-2 (spec 4.5; plan deviations 4, 5): the record page's AI paragraph, cached per customer per
 * language (0087). The READ runs on the reader's REQUEST client (0087's RLS decides: a Technician reads
 * only assigned customers' rows). The claim, the save and the release run on the SERVICE client, after
 * the route proved the customer on the request client. Nothing here takes or returns a prompt.
 */
export type SummaryLanguage = "en" | "es";
export type RecordSummaryKey = { accountId: string; contactId: string; language: SummaryLanguage };
export type RecordSummaryRow = { body: string | null; inputDigest: string | null; model: string | null; generatedAt: string | null };
export type RecordSummaryClaim = { status: "won"; leaseId: string } | { status: "busy" } | { status: "fresh" } | { status: "too_soon" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function getRecordSummary(db: SupabaseClient, k: RecordSummaryKey): Promise<RecordSummaryRow | null> {
  const { data, error } = await db.from("record_summaries").select("body, input_digest, model, generated_at")
    .eq("account_id", k.accountId).eq("contact_id", k.contactId).eq("language", k.language).maybeSingle();
  if (error) throw new Error(`getRecordSummary failed: ${error.message}`);
  if (!data) return null;
  const r = data as { body: string | null; input_digest: string | null; model: string | null; generated_at: string | null };
  return { body: r.body, inputDigest: r.input_digest, model: r.model, generatedAt: r.generated_at };
}

/** One claim (0087's claim_record_summary). THROWS on an error or an answer of any other shape. */
export async function claimRecordSummary(
  db: SupabaseClient, k: RecordSummaryKey & { digest: string; force: boolean },
): Promise<RecordSummaryClaim> {
  const { data, error } = await db.rpc("claim_record_summary", {
    p_account: k.accountId, p_contact: k.contactId, p_language: k.language, p_digest: k.digest, p_force: k.force,
  });
  if (error) throw new Error(`claimRecordSummary failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r && r.status === "won" && typeof r.lease_id === "string" && UUID.test(r.lease_id)) return { status: "won", leaseId: r.lease_id };
  if (r && (r.status === "busy" || r.status === "fresh" || r.status === "too_soon")) return { status: r.status };
  throw new Error("claimRecordSummary: unexpected answer");
}

/** The winner's write: only while its own lease still holds the row. False = another claim took it over. */
export async function saveRecordSummary(
  db: SupabaseClient, k: RecordSummaryKey & { leaseId: string; body: string; digest: string; model: string; generatedAt: string },
): Promise<boolean> {
  const { data, error } = await db.from("record_summaries")
    .update({ body: k.body, input_digest: k.digest, model: k.model, generated_at: k.generatedAt, generating_until: null, lease_id: null })
    .eq("account_id", k.accountId).eq("contact_id", k.contactId).eq("language", k.language).eq("lease_id", k.leaseId)
    .select("id");
  if (error) throw new Error(`saveRecordSummary failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** A failed generation lets the next reader claim at once instead of waiting out the lease. */
export async function releaseRecordSummaryLease(db: SupabaseClient, k: RecordSummaryKey & { leaseId: string }): Promise<void> {
  const { error } = await db.from("record_summaries").update({ generating_until: null, lease_id: null })
    .eq("account_id", k.accountId).eq("contact_id", k.contactId).eq("language", k.language).eq("lease_id", k.leaseId);
  if (error) throw new Error(`releaseRecordSummaryLease failed: ${error.message}`);
}
