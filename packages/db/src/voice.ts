import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";

export type PhoneNumberStatus = "provisioned" | "testing" | "live" | "released";
export type PhoneNumberRow = {
  id: string; account_id: string; e164: string;
  telnyx_id: string | null; status: PhoneNumberStatus;
};
export type VoiceProfileRow = {
  id: string; account_id: string; persona_name: string;
  greeting_en: string; greeting_es: string; facts: string; services: string;
  languages: "en" | "es" | "both"; booking_enabled: boolean;
  after_hours: "hours_then_message" | "message_only"; enabled: boolean;
  textback_enabled: boolean; textback_body: string;
};
export type VoiceProfilePatch = Partial<Omit<VoiceProfileRow, "id" | "account_id">>;
export type CallOutcome = "booked" | "lead" | "message" | "abandoned" | "spam";
export type TranscriptEvent = { role: "caller" | "assistant"; text: string; at: string };
export type FinishCallPatch = {
  outcome: CallOutcome; endedAt: Date; durationSecs: number; turnCount: number;
  transcript: TranscriptEvent[]; summary: string; language: "en" | "es";
  contactId?: string; conversationId?: string; bookingId?: string;
};

const PHONE_COLS = "id, account_id, e164, telnyx_id, status";
const PROFILE_COLS =
  "id, account_id, persona_name, greeting_en, greeting_es, facts, services, " +
  "languages, booking_enabled, after_hours, enabled, textback_enabled, textback_body";

export async function getPhoneNumberByE164(
  db: SupabaseClient, e164: string,
): Promise<PhoneNumberRow | null> {
  const { data, error } = await db.from("phone_numbers")
    .select(PHONE_COLS).eq("e164", e164).maybeSingle();
  if (error) throw new Error(`getPhoneNumberByE164 failed: ${error.message}`);
  return (data as PhoneNumberRow | null) ?? null;
}

export async function assignPhoneNumber(
  db: SupabaseClient, accountId: string,
  input: { e164: string; telnyxId?: string; status?: PhoneNumberStatus },
  actorId: string, actorType: ActorType = "user",
): Promise<PhoneNumberRow> {
  const { data, error } = await db.from("phone_numbers")
    .insert({
      account_id: accountId, e164: input.e164,
      telnyx_id: input.telnyxId ?? null, status: input.status ?? "provisioned",
    })
    .select(PHONE_COLS).single();
  if (error || !data) throw new Error(`assignPhoneNumber failed: ${error?.message}`);
  await emit(db, accountId, "phone_number.assigned", actorId,
    { phoneNumberId: (data as PhoneNumberRow).id, e164: input.e164 }, actorType);
  return data as PhoneNumberRow;
}

export async function setPhoneNumberStatus(
  db: SupabaseClient, accountId: string, phoneNumberId: string,
  status: PhoneNumberStatus, actorId: string, actorType: ActorType = "user",
): Promise<void> {
  const { data, error } = await db.from("phone_numbers")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", phoneNumberId).eq("account_id", accountId).select("id");
  if (error) throw new Error(`setPhoneNumberStatus failed: ${error.message}`);
  // PostgREST returns no error AND no rows for an update matching nothing —
  // the setBranding lesson. A wrong id/account must be loud.
  if (!data || data.length === 0) throw new Error("setPhoneNumberStatus matched no row");
  await emit(db, accountId, "phone_number.status_changed", actorId, { phoneNumberId, status }, actorType);
}

export async function getVoiceProfile(
  db: SupabaseClient, accountId: string,
): Promise<VoiceProfileRow | null> {
  const { data, error } = await db.from("voice_profiles")
    .select(PROFILE_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getVoiceProfile failed: ${error.message}`);
  return (data as VoiceProfileRow | null) ?? null;
}

export async function upsertVoiceProfile(
  db: SupabaseClient, accountId: string, patch: VoiceProfilePatch, actorId: string, actorType: ActorType = "user",
): Promise<VoiceProfileRow> {
  const existing = await getVoiceProfile(db, accountId);
  if (!existing) {
    const { data, error } = await db.from("voice_profiles")
      .insert({ account_id: accountId, ...patch })
      .select(PROFILE_COLS).single();
    if (error || !data) throw new Error(`upsertVoiceProfile insert failed: ${error?.message}`);
    await emit(db, accountId, "voice_profile.updated", actorId, { fields: Object.keys(patch) }, actorType);
    return data as unknown as VoiceProfileRow;
  }
  const { data, error } = await db.from("voice_profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).select(PROFILE_COLS).single();
  if (error || !data) throw new Error(`upsertVoiceProfile update failed: ${error?.message}`);
  await emit(db, accountId, "voice_profile.updated", actorId, { fields: Object.keys(patch) }, actorType);
  return data as unknown as VoiceProfileRow;
}

export async function startCallRow(
  db: SupabaseClient, accountId: string,
  input: { phoneNumberId: string; callerE164: string | null },
): Promise<{ id: string }> {
  const { data, error } = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: input.phoneNumberId, caller_e164: input.callerE164 })
    .select("id").single();
  if (error || !data) throw new Error(`startCallRow failed: ${error?.message}`);
  return { id: (data as { id: string }).id };
}

/**
 * Deletes an unfinished call row — the accept-failure cleanup path in
 * `/api/voice/incoming`: `startCallRow` fail-opens the call through even
 * when the row write fails, but the reverse (a row exists, then the OpenAI
 * accept call fails) must not leave that row behind. An unaccepted call was
 * never actually answered, so its row must not litter the dashboard or
 * count against the tenant's daily caps (`countCallsSince`/
 * `countCallsByCallerSince` count every row regardless of outcome).
 *
 * Deliberately does NOT throw on a zero-row match, unlike `finishCallRow`/
 * `setPhoneNumberStatus` above — those guard against a wrong id silently
 * no-op'ing on a real bug, but this cleanup path must be idempotent: a
 * retry, a race with another cleanup attempt, or a call row that never got
 * written in the first place (`startCallRow` itself failed, fail-open) all
 * mean "nothing to delete", which is success here, not an error.
 */
export async function deleteCallRow(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<void> {
  const { error } = await db.from("calls").delete().eq("id", callId).eq("account_id", accountId);
  if (error) throw new Error(`deleteCallRow failed: ${error.message}`);
}

export async function finishCallRow(
  db: SupabaseClient, accountId: string, callId: string, patch: FinishCallPatch,
): Promise<void> {
  const { data, error } = await db.from("calls")
    .update({
      outcome: patch.outcome, ended_at: patch.endedAt.toISOString(),
      duration_secs: patch.durationSecs, turn_count: patch.turnCount,
      transcript: patch.transcript, summary: patch.summary, language: patch.language,
      contact_id: patch.contactId ?? null, conversation_id: patch.conversationId ?? null,
      booking_id: patch.bookingId ?? null,
    })
    .eq("id", callId).eq("account_id", accountId).select("id");
  if (error) throw new Error(`finishCallRow failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("finishCallRow matched no row");
}

export async function countCallsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("started_at", sinceIso);
  if (error) throw new Error(`countCallsSince failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Whether the account has any call still IN PROGRESS as of `sinceIso` — a
 * `calls` row with no `ended_at` (finishCallRow never ran) whose
 * `started_at` is after `sinceIso`. The topbar Sofía presence indicator
 * (Task 5, apps/web/src/lib/voice/presence.ts) is the caller, and always
 * passes "one hour ago" as the floor: an unfinished row can outlive the
 * actual call (a crashed process, an `/api/voice/incoming` accept failure
 * that skipped the deleteCallRow cleanup above), so without a floor a stuck
 * row would pin the indicator "on a call" forever instead of just briefly
 * showing a stale state that ages out on its own.
 */
export async function hasActiveCallSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<boolean> {
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).is("ended_at", null).gt("started_at", sinceIso);
  if (error) throw new Error(`hasActiveCallSince failed: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function countCallsByCallerSince(
  db: SupabaseClient, accountId: string, callerE164: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("caller_e164", callerE164).gte("started_at", sinceIso);
  if (error) throw new Error(`countCallsByCallerSince failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Raw `started_at` instants in `[fromIso, toIso)` for the dashboard's 14-day
 * call chart — bucketing (day boundaries, timezone) happens in JS on the
 * caller side, not here. Daily caps are 50/day, so a 14-day window is at
 * most ~700 rows; no pagination needed.
 */
export async function listCallStartsBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<string[]> {
  const { data, error } = await db.from("calls")
    .select("started_at")
    .eq("account_id", accountId).gte("started_at", fromIso).lt("started_at", toIso)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`listCallStartsBetween failed: ${error.message}`);
  return (data ?? []).map((r: { started_at: string }) => r.started_at);
}

export async function findUpcomingBookingForPhone(
  db: SupabaseClient, accountId: string, phoneE164: string, nowIso: string,
): Promise<{ bookingId: string; startsAt: string } | null> {
  const { data: contacts, error: cErr } = await db.from("contacts")
    .select("id").eq("account_id", accountId).eq("phone", phoneE164);
  if (cErr) throw new Error(`findUpcomingBookingForPhone contacts failed: ${cErr.message}`);
  const ids = (contacts ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return null;
  const { data, error } = await db.from("bookings")
    .select("id, starts_at").eq("account_id", accountId)
    .in("contact_id", ids).eq("status", "booked").gt("starts_at", nowIso)
    .order("starts_at", { ascending: true }).limit(1);
  if (error) throw new Error(`findUpcomingBookingForPhone bookings failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; starts_at: string } | undefined;
  return row ? { bookingId: row.id, startsAt: row.starts_at } : null;
}

export async function listPhoneNumbersForAccount(
  db: SupabaseClient, accountId: string,
): Promise<PhoneNumberRow[]> {
  const { data, error } = await db.from("phone_numbers")
    .select(PHONE_COLS).eq("account_id", accountId).order("created_at");
  if (error) throw new Error(`listPhoneNumbersForAccount failed: ${error.message}`);
  return (data ?? []) as PhoneNumberRow[];
}

/** Agency surface only (the wizard's number step). RLS's app.is_agency()
 *  branch is what makes this visible cross-account under dbForRequest. */
export async function listAllPhoneNumbers(
  db: SupabaseClient,
): Promise<(PhoneNumberRow & { account: { name: string } | null })[]> {
  const { data, error } = await db.from("phone_numbers")
    .select(`${PHONE_COLS}, account:accounts(name)`).order("created_at");
  if (error) throw new Error(`listAllPhoneNumbers failed: ${error.message}`);
  return (data ?? []) as unknown as (PhoneNumberRow & { account: { name: string } | null })[];
}

/**
 * Moves a number to another account. NOT release-then-assign: e164 is
 * globally unique (0019), so a second insert can never express a move.
 * Status resets to 'provisioned' — a moved number must walk the wizard's
 * test-call + go-live steps again before it is live for the new tenant.
 * Emits on BOTH accounts so each timeline records its side of the move.
 */
export async function reassignPhoneNumber(
  db: SupabaseClient, phoneNumberId: string, toAccountId: string,
  actorId: string, actorType: ActorType = "user",
): Promise<PhoneNumberRow> {
  const { data: current, error: readErr } = await db.from("phone_numbers")
    .select(PHONE_COLS).eq("id", phoneNumberId).maybeSingle();
  if (readErr) throw new Error(`reassignPhoneNumber read failed: ${readErr.message}`);
  if (!current) throw new Error("reassignPhoneNumber matched no row");
  const from = current as PhoneNumberRow;

  const { data, error } = await db.from("phone_numbers")
    .update({ account_id: toAccountId, status: "provisioned", updated_at: new Date().toISOString() })
    .eq("id", phoneNumberId).select(PHONE_COLS).single();
  if (error || !data) throw new Error(`reassignPhoneNumber failed: ${error?.message}`);

  await emit(db, from.account_id, "phone_number.released", actorId,
    { phoneNumberId, e164: from.e164, movedTo: toAccountId }, actorType);
  await emit(db, toAccountId, "phone_number.assigned", actorId,
    { phoneNumberId, e164: from.e164, movedFrom: from.account_id }, actorType);
  return data as PhoneNumberRow;
}

export type CallListRow = {
  id: string; started_at: string; duration_secs: number | null;
  outcome: CallOutcome; language: "en" | "es"; caller_e164: string | null;
  contact_id: string | null;
  // On the LIST as well as the detail row since the missed-call text-back:
  // an abandoned call that was texted back now records the conversation the
  // text lives in, and the calls list needs it to ask — in ONE read for the
  // whole page rather than one per row — whether that text failed to send.
  // There is no retry anywhere in that path, so visibility on the row the
  // operator is already looking at is the only mitigation there is.
  conversation_id: string | null;
  contact: { first_name: string | null; last_name: string | null } | null;
};
export type CallDetailRow = CallListRow & {
  ended_at: string | null; turn_count: number; transcript: TranscriptEvent[];
  summary: string; booking_id: string | null;
};

const CALL_LIST_COLS =
  "id, started_at, duration_secs, outcome, language, caller_e164, contact_id, " +
  "conversation_id, contact:contacts(first_name, last_name)";
const CALL_DETAIL_COLS =
  CALL_LIST_COLS + ", ended_at, turn_count, transcript, summary, booking_id";

export async function listCalls(
  db: SupabaseClient, accountId: string, opts: { limit?: number; before?: string } = {},
): Promise<CallListRow[]> {
  let q = db.from("calls").select(CALL_LIST_COLS)
    .eq("account_id", accountId)
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("started_at", opts.before);
  const { data, error } = await q;
  if (error) throw new Error(`listCalls failed: ${error.message}`);
  return (data ?? []) as unknown as CallListRow[];
}

export async function getCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<CallDetailRow | null> {
  const { data, error } = await db.from("calls").select(CALL_DETAIL_COLS)
    .eq("account_id", accountId).eq("id", callId).maybeSingle();
  if (error) throw new Error(`getCall failed: ${error.message}`);
  return (data as unknown as CallDetailRow | null) ?? null;
}

/** The contact drawer's recent-calls source — newest few for ONE contact. */
export async function listContactCalls(
  db: SupabaseClient, accountId: string, contactId: string, limit = 3,
): Promise<{ id: string; started_at: string; outcome: string }[]> {
  const { data, error } = await db.from("calls")
    .select("id, started_at, outcome")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`listContactCalls failed: ${error.message}`);
  return (data ?? []) as { id: string; started_at: string; outcome: string }[];
}

export async function getBookingById(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<{ id: string; contact_id: string; calendar_id: string; starts_at: string; ends_at: string; status: string } | null> {
  const { data, error } = await db.from("bookings")
    .select("id, contact_id, calendar_id, starts_at, ends_at, status")
    .eq("id", bookingId).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getBookingById failed: ${error.message}`);
  return (data as any) ?? null;
}

/**
 * The ⌘K palette's calls half. Own-table columns ONLY — `caller_e164` and the
 * receptionist's `summary` — so the filter never has to reach through the
 * embedded `contact:contacts(...)` join, which would need an `!inner` rewrite
 * and change what `listCalls` returns for everyone else.
 *
 * A caller whose contact is known is still findable: the palette's CONTACTS
 * group returns that person, and their calls hang off the contact page.
 *
 * An empty sanitized term returns [] rather than the newest N calls — a
 * palette showing the whole log for a query of "%%%" would read as a match.
 */
export async function searchCalls(
  db: SupabaseClient, accountId: string, opts: { search: string; limit?: number },
): Promise<CallListRow[]> {
  const s = sanitizeSearchTerm(opts.search);
  if (!s) return [];
  const { data, error } = await db.from("calls").select(CALL_LIST_COLS)
    .eq("account_id", accountId)
    .or(`caller_e164.ilike.%${s}%,summary.ilike.%${s}%`)
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 5);
  if (error) throw new Error(`searchCalls failed: ${error.message}`);
  return (data ?? []) as unknown as CallListRow[];
}
