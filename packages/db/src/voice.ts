import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

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
  "languages, booking_enabled, after_hours, enabled";

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

export async function countCallsByCallerSince(
  db: SupabaseClient, accountId: string, callerE164: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("caller_e164", callerE164).gte("started_at", sinceIso);
  if (error) throw new Error(`countCallsByCallerSince failed: ${error.message}`);
  return count ?? 0;
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

export async function getBookingById(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<{ id: string; contact_id: string; calendar_id: string; starts_at: string; ends_at: string; status: string } | null> {
  const { data, error } = await db.from("bookings")
    .select("id, contact_id, calendar_id, starts_at, ends_at, status")
    .eq("id", bookingId).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getBookingById failed: ${error.message}`);
  return (data as any) ?? null;
}
