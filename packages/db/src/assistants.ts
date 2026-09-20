import type { SupabaseClient } from "@supabase/supabase-js";
import { newPublicId } from "./forms";

/**
 * The website assistant: an account-owned object with a public id, a hosted
 * page and a one-line embed — the same shape a form or a calendar has, for
 * the same reason (migration 0042_assistants.sql).
 *
 * Every function here takes the client as its first argument and never
 * chooses one. The public paths (`/a/<publicId>`, the chat API) run against
 * `serviceDb()` because an unauthenticated visitor has no tenant context;
 * the Settings paths run against `userDb()` and RLS scopes them. Which one
 * a caller passes is the caller's decision, exactly as in forms.ts and
 * booking.ts.
 */

export type AssistantLocale = "en" | "es";

export type AssistantRow = {
  id: string;
  account_id: string;
  public_id: string;
  enabled: boolean;
  name: string;
  form_id: string | null;
  knowledge: string;
  knowledge_urls: Partial<Record<AssistantLocale, string>>;
  faq: { q: string; a: string }[];
  greeting: Partial<Record<AssistantLocale, string>>;
  suggestions: Partial<Record<AssistantLocale, string[]>>;
  locale_default: AssistantLocale;
  allowed_origins: string[];
  created_at: string;
  updated_at: string;
};

/**
 * What a client may change. The omitted keys are the ones the migration
 * deliberately leaves OUT of the column-level UPDATE grant: `id` and
 * `created_at` are history, `account_id` is the tenancy anchor, and
 * `public_id` is the capability that IS the assistant's URL. This type and
 * that grant list are the same list, and `assistants-grants.test.ts` pins
 * the grant side of it.
 */
export type AssistantPatch = Partial<
  Omit<AssistantRow, "id" | "account_id" | "public_id" | "created_at" | "updated_at">
>;

export type TranscriptEntry = { role: "user" | "assistant"; text: string; at: string };

export type AssistantSessionRow = {
  id: string;
  assistant_id: string;
  account_id: string;
  ip_hash: string;
  locale: AssistantLocale;
  page_url: string | null;
  transcript: TranscriptEntry[];
  turns: number;
  submission_id: string | null;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
};

const ASSISTANT_COLS =
  "id, account_id, public_id, enabled, name, form_id, knowledge, knowledge_urls, " +
  "faq, greeting, suggestions, locale_default, allowed_origins, created_at, updated_at";

const SESSION_COLS =
  "id, assistant_id, account_id, ip_hash, locale, page_url, transcript, turns, " +
  "submission_id, contact_id, created_at, updated_at";

/**
 * The public path: the hosted page and the chat API both arrive with a
 * public id and no tenant context, so the account is read back OFF the row
 * and must never be taken from the caller.
 *
 * `enabled = true` is filtered HERE rather than left to the caller — unlike
 * `getCalendarByPublicId`, which hands `enabled` up. The reason is that
 * both callers of this function must answer a disabled assistant with the
 * SAME 404 as an id that never existed, and a filter that lives in one
 * place cannot be forgotten in the other.
 */
export async function getAssistantByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<AssistantRow | null> {
  const { data, error } = await db.from("assistants").select(ASSISTANT_COLS)
    .eq("public_id", publicId).eq("enabled", true).maybeSingle();
  if (error) throw new Error(`getAssistantByPublicId failed: ${error.message}`);
  return (data as unknown as AssistantRow | null) ?? null;
}

/** The in-account read: any state, enabled or not — this is what Settings
 *  renders, and a disabled assistant is precisely what it has to show. */
export async function getAssistantForAccount(
  db: SupabaseClient, accountId: string,
): Promise<AssistantRow | null> {
  const { data, error } = await db.from("assistants").select(ASSISTANT_COLS)
    .eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getAssistantForAccount failed: ${error.message}`);
  return (data as unknown as AssistantRow | null) ?? null;
}

/**
 * Mints the row. `public_id` comes from `newPublicId()` (forms.ts) — the
 * same Crockford-ish 32-symbol alphabet every other public capability in
 * this schema uses, so a token read off a screen cannot be mistyped into a
 * different tenant's assistant.
 *
 * One per account is enforced by the database
 * (`assistants_one_per_account`), not by a check here that two concurrent
 * callers could race past.
 */
export async function createAssistant(
  db: SupabaseClient, accountId: string, patch?: AssistantPatch,
): Promise<AssistantRow> {
  const { data, error } = await db.from("assistants")
    .insert({ account_id: accountId, public_id: newPublicId(), ...(patch ?? {}) })
    .select(ASSISTANT_COLS).single();
  if (error || !data) {
    throw new Error(`createAssistant failed: ${error?.message ?? "no row returned"}`);
  }
  return data as unknown as AssistantRow;
}

/**
 * Saves settings and returns the saved row.
 *
 * `.select(...).maybeSingle()` so the update reports WHICH row it touched:
 * PostgREST returns no error and no rows for an update matching nothing, so
 * without this a save against a deleted or foreign account would report
 * success while changing nothing (the setBranding lesson, and the same
 * guard `updateForm` and `updateCalendarSettings` carry).
 */
export async function updateAssistant(
  db: SupabaseClient, accountId: string, patch: AssistantPatch,
): Promise<AssistantRow> {
  const { data, error } = await db.from("assistants")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .select(ASSISTANT_COLS).maybeSingle();
  if (error) throw new Error(`updateAssistant failed: ${error.message}`);
  if (!data) throw new Error(`updateAssistant failed: no assistant for account ${accountId}`);
  return data as unknown as AssistantRow;
}

export type NewAssistantSession = {
  assistantId: string;
  accountId: string;
  ipHash: string;
  locale: AssistantLocale;
  pageUrl: string | null;
};

/** The session id is SERVER-issued (the column default) and handed back in
 *  the `x-bis-session` header. The browser never chooses it. */
export async function createAssistantSession(
  db: SupabaseClient, input: NewAssistantSession,
): Promise<{ id: string }> {
  const { data, error } = await db.from("assistant_sessions")
    .insert({
      assistant_id: input.assistantId,
      account_id: input.accountId,
      ip_hash: input.ipHash,
      locale: input.locale,
      page_url: input.pageUrl,
    })
    .select("id").single();
  if (error || !data) {
    throw new Error(`createAssistantSession failed: ${error?.message ?? "no row returned"}`);
  }
  return { id: data.id as string };
}

/**
 * Reads one session by id. Deliberately takes no accountId: the caller is
 * the chat route, which has a session id from a request header and no
 * tenant context yet — it compares `assistant_id` against the assistant it
 * already resolved from the public id, which is the check that matters. A
 * session belonging to a different assistant is a 400 there, not a row
 * this function should quietly hide.
 */
export async function getAssistantSession(
  db: SupabaseClient, id: string,
): Promise<AssistantSessionRow | null> {
  const { data, error } = await db.from("assistant_sessions").select(SESSION_COLS)
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`getAssistantSession failed: ${error.message}`);
  return (data as unknown as AssistantSessionRow | null) ?? null;
}

export type AssistantTurnInput = {
  sessionId: string;
  accountId: string;
  ipHash: string;
  transcript: TranscriptEntry[];
  inputTokens: number;
  outputTokens: number;
};

/**
 * Records one model call: an INSERT into the ledger, then an UPDATE of the
 * session it belongs to.
 *
 * READ-THEN-WRITE ON `turns`, SAID OUT LOUD. PostgREST cannot express
 * `set turns = turns + 1` (0006_forms.sql makes the same observation about
 * `unread_count` and answers it with the `increment_conversation_unread`
 * RPC). This function reads the current `turns` and writes back
 * `turns + 1`, so two turns finishing at the same instant can lose one
 * increment. That is accepted here, and it is not what the rate limit
 * rests on: the caps the chat route enforces are counted from
 * `assistant_turns` rows — `countAssistantTurnsForIpSince` and
 * `countAssistantTurnsForAccountSince` below — which are INSERTS and
 * cannot be lost. `sessions.turns` is a display number for phase 2's
 * transcript list. If it ever becomes load-bearing, the fix is an RPC in a
 * new migration, mirroring `increment_conversation_unread`, not a retry
 * loop here.
 *
 * The ledger row is inserted FIRST, on purpose: if the session update
 * fails, the turn is still counted against the caps. The opposite order
 * would let a failure hand out a free model call.
 *
 * `transcript` arrives whole from the caller (prior transcript + this
 * exchange, capped at 60 entries), so it is last-write-wins by design and
 * needs no read.
 */
export async function appendAssistantTurn(
  db: SupabaseClient, input: AssistantTurnInput,
): Promise<void> {
  const { error: turnErr } = await db.from("assistant_turns").insert({
    session_id: input.sessionId,
    account_id: input.accountId,
    ip_hash: input.ipHash,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
  });
  if (turnErr) throw new Error(`appendAssistantTurn failed: ${turnErr.message}`);

  const { data: current, error: readErr } = await db.from("assistant_sessions")
    .select("turns").eq("id", input.sessionId).eq("account_id", input.accountId)
    .maybeSingle();
  if (readErr) throw new Error(`appendAssistantTurn failed: ${readErr.message}`);
  if (!current) {
    throw new Error(`appendAssistantTurn failed: no session ${input.sessionId} in account`);
  }

  const { data: saved, error: updateErr } = await db.from("assistant_sessions")
    .update({
      transcript: input.transcript,
      turns: (current.turns as number) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId).eq("account_id", input.accountId)
    .select("id");
  if (updateErr) throw new Error(`appendAssistantTurn failed: ${updateErr.message}`);
  if (!saved?.length) {
    throw new Error(`appendAssistantTurn failed: no session ${input.sessionId} in account`);
  }
}

/**
 * Links the lead this conversation produced. Called from `capture_lead`
 * after the submission is filed, so the transcript and the lead can be read
 * as one thing in phase 2.
 *
 * `contactId` is nullable because enrichment can fail after a submission
 * lands, and a lead with no contact row yet is still a lead.
 */
export async function linkSessionLead(
  db: SupabaseClient, sessionId: string, submissionId: string, contactId: string | null,
): Promise<void> {
  const { data, error } = await db.from("assistant_sessions")
    .update({
      submission_id: submissionId,
      contact_id: contactId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select("id");
  if (error) throw new Error(`linkSessionLead failed: ${error.message}`);
  if (!data?.length) throw new Error(`linkSessionLead failed: no session ${sessionId}`);
}

/** Model calls from this hashed IP since `sinceIso` — the per-visitor cap,
 *  read BEFORE the model call. */
export async function countAssistantTurnsForIpSince(
  db: SupabaseClient, ipHash: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("assistant_turns")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", sinceIso);
  if (error) throw new Error(`countAssistantTurnsForIpSince failed: ${error.message}`);
  return count ?? 0;
}

/** Model calls against this account since `sinceIso` — the per-tenant
 *  ceiling, so one client's public page cannot exhaust a budget alone. */
export async function countAssistantTurnsForAccountSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("assistant_turns")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("created_at", sinceIso);
  if (error) throw new Error(`countAssistantTurnsForAccountSince failed: ${error.message}`);
  return count ?? 0;
}
