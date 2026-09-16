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
/**
 * The TypeScript twin of `calls_outcome_check` (0019, widened by 0037). The
 * two must hold the same six strings: a value this union admits and the CHECK
 * refuses is a write that fails at 2 AM, and one the CHECK admits and this
 * union does not is a row no screen can render.
 *
 * `transferred` means the caller reached a PERSON. Nothing produces it yet —
 * 0037 is vocabulary only — and `classifyOutcome` deliberately never returns
 * it: at socket close a handed-off call still classifies `abandoned`, because
 * from the socket's point of view the caller did leave, and the handoff route
 * upgrades the row afterwards through `setCallOutcome` below.
 */
export type CallOutcome = "booked" | "lead" | "message" | "abandoned" | "spam" | "transferred";
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

/**
 * `handoffToken` is OPTIONAL and every caller in the tree today omits it —
 * a call that never asks for a person carries none, which is every call this
 * product has recorded so far. When present it is the credential a LATER,
 * separate request uses to find this row again (see `getCallByHandoffToken`),
 * and `calls_handoff_token_unique` (0037) refuses a second row claiming the
 * same one: two calls sharing a token means transferring the wrong caller,
 * to a real human, with no error and no symptom.
 *
 * Minting it here rather than at the moment the caller asks is deliberate.
 * The ask happens mid-call, inside a socket handler where an extra round trip
 * costs the caller silence; the token has no meaning until it is used, so
 * writing it with the row that already has to be written is free.
 * `handoff_requested_at` stays null until `markHandoffRequested` — the token
 * says WHICH call, the timestamp says the caller actually asked.
 *
 * THE COLUMN IS NAMED ONLY WHEN THERE IS A TOKEN, rather than written as an
 * explicit `handoff_token: null` the way `finishCallRow` writes its optional
 * ids. That is a deployment-ordering decision, not a style one, and it is the
 * only place in this package that needs it: a push to `main` deploys
 * production, migrations are applied out of band, and this is the ONE function
 * on the live call path. PostgREST rejects an insert naming a column it does
 * not know about, outright — so naming `handoff_token` unconditionally would
 * fail EVERY insert here in the window between the deploy and the migration.
 *
 * The damage is not a dropped call. `api/voice/incoming/route.ts` (step 10)
 * fail-opens this call on purpose — a DB blip must not turn away a caller —
 * so every one of those calls would be answered normally while recording no
 * row at all: no transcript, no outcome, no duration, no summary, no CRM
 * trail, and nothing for the daily caps to count. A silent hole in the
 * record for the length of the window, which is precisely the failure this
 * product is least able to see. Omitting the column confines that window to
 * handoff calls, of which there are none until the route that mints tokens
 * ships. Post-migration the two forms are identical: the column's default is
 * NULL.
 *
 * This comment is the only guard on that decision — no test can express
 * "before the migration" — so it has to be accurate.
 */
export async function startCallRow(
  db: SupabaseClient, accountId: string,
  input: { phoneNumberId: string; callerE164: string | null; handoffToken?: string },
): Promise<{ id: string }> {
  const { data, error } = await db.from("calls")
    .insert({
      account_id: accountId, phone_number_id: input.phoneNumberId, caller_e164: input.callerE164,
      ...(input.handoffToken === undefined ? {} : { handoff_token: input.handoffToken }),
    })
    .select("id").single();
  if (error || !data) throw new Error(`startCallRow failed: ${error?.message}`);
  return { id: (data as { id: string }).id };
}

/**
 * Stamps the moment a caller asked to speak to a person (0037's
 * `calls.handoff_requested_at`).
 *
 * Separate from the token on purpose: the token is minted at the start of
 * every call that might need one, so its presence proves nothing about what
 * the caller wanted. This timestamp is the only durable trace that a handoff
 * was ATTEMPTED — without it, a handoff whose dial then failed is
 * indistinguishable from one that never happened.
 *
 * Account-scoped and loud on a zero-row match, the `setPhoneNumberStatus`
 * shape: PostgREST returns no error AND no rows for an update matching
 * nothing, so a wrong id would otherwise read as a successful stamp.
 */
export async function markHandoffRequested(
  db: SupabaseClient, accountId: string, callRowId: string,
): Promise<void> {
  const { data, error } = await db.from("calls")
    .update({ handoff_requested_at: new Date().toISOString() })
    .eq("id", callRowId).eq("account_id", accountId).select("id");
  if (error) throw new Error(`markHandoffRequested failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("markHandoffRequested matched no row");
}

/**
 * Finds a call by its handoff token — and is DELIBERATELY NOT ACCOUNT-SCOPED,
 * which is the one thing about it worth reading twice.
 *
 * Every other reader in this file takes an `accountId` and pins it with
 * `.eq("account_id", …)`. This one cannot: its caller is the handoff route,
 * arriving as a separate request with no session, no signed-in user and no
 * account id in hand. The TOKEN IS THE CREDENTIAL — it is unguessable, it is
 * unique across the project (`calls_handoff_token_unique`, 0037), and holding
 * it is the entire proof of authorisation.
 *
 * That is exactly why it RETURNS `account_id`: the caller has no tenancy until
 * this function gives it one, and every read it makes afterwards must be
 * scoped by the account this token resolved to. A caller that discards it and
 * queries unscoped has thrown away the only tenancy this path has.
 *
 * An unknown token returns null rather than throwing — a route must be able to
 * tell "no such handoff" (a stale link, a token from a call already cleaned
 * up) from a database that is broken, and they need different answers.
 */
export async function getCallByHandoffToken(
  db: SupabaseClient, token: string,
): Promise<{ id: string; account_id: string; handoff_requested_at: string | null } | null> {
  const { data, error } = await db.from("calls")
    .select("id, account_id, handoff_requested_at")
    .eq("handoff_token", token).maybeSingle();
  if (error) throw new Error(`getCallByHandoffToken failed: ${error.message}`);
  return (data as { id: string; account_id: string; handoff_requested_at: string | null } | null) ?? null;
}

/**
 * Sets a call's outcome on its own, without the rest of `FinishCallPatch`.
 *
 * `finishCallRow` writes the outcome ALONGSIDE the transcript, duration, turn
 * count and summary, because at socket close all of those are known together.
 * A handoff is the case where they are not: the row is already finished (the
 * socket closed, classified `abandoned` — the caller did leave, as far as the
 * socket can tell) and only the outcome turns out to have been wrong. Reusing
 * `finishCallRow` for that would mean re-supplying a transcript and a duration
 * this caller does not have, and overwriting the real ones with invented ones.
 *
 * Account-scoped and loud on a zero-row match, for the same reason as every
 * other writer here.
 */
export async function setCallOutcome(
  db: SupabaseClient, accountId: string, callRowId: string, outcome: CallOutcome,
): Promise<void> {
  const { data, error } = await db.from("calls")
    .update({ outcome })
    .eq("id", callRowId).eq("account_id", accountId).select("id");
  if (error) throw new Error(`setCallOutcome failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("setCallOutcome matched no row");
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
 * One caller's history on one account since `sinceIso`, split two ways: how
 * many calls classified `spam`, and how many classified anything else.
 *
 * Feeds the voice gates' repeat-offender refusal (`decideReputation` in
 * `apps/web/src/lib/voice/caller-reputation.ts`), which blocks only when
 * `otherCalls` is zero — so the split, not the total, is the whole point.
 *
 * TWO COUNTS RATHER THAN A LIST OF ROWS, deliberately. `count: "exact", head:
 * true` transfers no rows, so neither query needs a `.limit()`; a limited list
 * could truncate away an older good outcome and produce a false block, which
 * is the one failure mode this guard must not have. Both queries ride
 * `calls_caller_idx (account_id, caller_e164, started_at desc)`, already
 * present since 0019 — no new index is needed.
 *
 * `turn_count >= 1` on the spam side is an EXCLUSION, not a filter for
 * tidiness: a connect-timeout also records `spam`, with `turn_count` 0,
 * because the socket never opened and nothing was mirrored into the call
 * state (see the honesty note in `api/voice/incoming/route.ts`). That is our
 * infrastructure failing, not a robot calling, and refusing a caller because
 * of our own outage is the worst false positive available here. A genuine
 * silent call still carries the greeting, so it always has at least one turn.
 *
 * An UNFINISHED row (still in flight, or one whose process died before
 * `finishCallRow`) carries the column default `abandoned` and so counts as
 * `otherCalls`. That errs toward letting the caller through, which is the
 * direction every gate in this path errs.
 */
export async function countCallerHistorySince(
  db: SupabaseClient, accountId: string, callerE164: string, sinceIso: string,
): Promise<{ spamCalls: number; otherCalls: number }> {
  const [spam, other] = await Promise.all([
    db.from("calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("caller_e164", callerE164)
      .gte("started_at", sinceIso).eq("outcome", "spam").gte("turn_count", 1),
    db.from("calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("caller_e164", callerE164)
      .gte("started_at", sinceIso).neq("outcome", "spam"),
  ]);
  if (spam.error) throw new Error(`countCallerHistorySince failed: ${spam.error.message}`);
  if (other.error) throw new Error(`countCallerHistorySince failed: ${other.error.message}`);
  return { spamCalls: spam.count ?? 0, otherCalls: other.count ?? 0 };
}

/**
 * Raw `started_at` instants in `[fromIso, toIso)` for the dashboard's 14-day
 * call chart — bucketing (day boundaries, timezone) happens in JS on the
 * caller side, not here. Daily caps are 50/day, so a 14-day window is at
 * most ~700 rows; no pagination needed.
 */
/**
 * Every call's OUTCOME in a window — the twin of `listCallStartsBetween`
 * below, which returns `started_at` values only and therefore cannot answer
 * "how many calls were answered".
 *
 * Half-open `[from, to)` exactly like its twin, deliberately: the weekly
 * report counts calls and classifies them from these two functions, and a
 * disagreement about which instant belongs to a week would put a call in one
 * number and not the other.
 *
 * Returns outcomes rather than counting server-side because the caller needs
 * two different tallies from one read — answered (`booked`/`lead`/`message`)
 * and leads (`lead`) — and a second round trip to count each would cost more
 * than carrying a few short strings.
 */
export async function listCallOutcomesBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<string[]> {
  const { data, error } = await db.from("calls")
    .select("outcome")
    .eq("account_id", accountId).gte("started_at", fromIso).lt("started_at", toIso);
  if (error) throw new Error(`listCallOutcomesBetween failed: ${error.message}`);
  return (data ?? []).map((r: { outcome: string }) => r.outcome);
}

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
  // Likewise on the LIST since that badge. `conversation_id` alone says WHICH
  // THREAD the text lives in, and a thread is one-per-contact — it spans every
  // call that person ever made. `started_at`/`ended_at` are what say WHICH CALL
  // wrote it, and both are needed to bound one call's text-back window (see
  // `calls/textback-window.ts`). Written by the same single `finishCallRow`
  // UPDATE that stamps `conversation_id`, so the two are set or unset together.
  ended_at: string | null;
  contact: { first_name: string | null; last_name: string | null } | null;
};
export type CallDetailRow = CallListRow & {
  turn_count: number; transcript: TranscriptEvent[];
  summary: string; booking_id: string | null;
};

const CALL_LIST_COLS =
  "id, started_at, ended_at, duration_secs, outcome, language, caller_e164, contact_id, " +
  "conversation_id, contact:contacts(first_name, last_name)";
const CALL_DETAIL_COLS =
  CALL_LIST_COLS + ", turn_count, transcript, summary, booking_id";

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
