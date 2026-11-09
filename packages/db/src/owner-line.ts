import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole } from "./team";

/**
 * F-032 (0115): the owner line's database seam. Every function takes serviceDb() EXCEPT readOwnerLineCallLog, which
 * takes the READER's request client (the access log's RLS: the agency, or this account's Owner). The table has no
 * client grant at all (SC-4): a person's own row is reached only through a server action keyed on Clerk's userId.
 * Every wrapper THROWS on an error and on an answer it did not expect, naming itself. pin_hash and the code hash are
 * written here and never read back out, except the PIN's salt prefix (pin_params) the answer lookup returns.
 */
export const OWNER_LINE_MAX_CALLS_PER_DAY = 10;
export const OWNER_LINE_LOCK_MINUTES = 30;
export const OWNER_LINE_VERIFY_MINUTES = 10;
export const OWNER_LINE_LOG_KINDS = ["owner_line_calls_and_messages", "owner_line_appointments",
  "owner_line_needs_attention", "owner_line_lookup_customer"] as const;
export type OwnerLineLogKind = (typeof OWNER_LINE_LOG_KINDS)[number];

export type OwnerLineEnrollment = {
  id: string; e164: string; verifiedAt: string | null; verifyExpiresAt: string | null;
  pinSetAt: string | null; lockedUntil: string | null;
};
export type OwnerLineLookup =
  | { status: "none" | "off" | "locked" }
  | { status: "verify" | "pin" | "over_limit"; enrollmentId: string; userId: string; role: AccountRole;
      name: string | null; language: "en" | "es" | null; accountLanguage: "en" | "es" | null; pinParams: string | null };
/** A lock always carries its end (owner_line_attempt_pin returns locked_until with locked_now and locked). */
export type OwnerLinePinResult = { status: "ok" | "wrong" | "none" } | { status: "locked_now" | "locked"; lockedUntil: string };
export type OwnerLineSessionFacts = {
  name: string | null; language: "en" | "es" | null; clerkUserId: string; clerkOrgId: string;
  timezone: string; accountLanguage: "en" | "es" | null;
};

const ROLES: readonly string[] = ["owner", "staff", "technician"];
const lang = (v: unknown): "en" | "es" | null => (v === "en" || v === "es" ? v : null);

export async function readMyOwnerLineEnrollment(
  db: SupabaseClient, accountId: string, userId: string,
): Promise<OwnerLineEnrollment | null> {
  const { data, error } = await db.from("owner_line_enrollments")
    .select("id, e164, verified_at, verify_expires_at, pin_set_at, locked_until")
    .eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`readMyOwnerLineEnrollment failed: ${error.message}`);
  if (!data) return null;
  const r = data as { id: string; e164: string; verified_at: string | null; verify_expires_at: string | null;
    pin_set_at: string | null; locked_until: string | null };
  return { id: r.id, e164: r.e164, verifiedAt: r.verified_at, verifyExpiresAt: r.verify_expires_at,
    pinSetAt: r.pin_set_at, lockedUntil: r.locked_until };
}

export async function startOwnerLineVerification(
  db: SupabaseClient, accountId: string, userId: string, e164: string, codeHash: string,
): Promise<"ok" | "taken"> {
  const { data, error } = await db.rpc("owner_line_start_verification", {
    p_account_id: accountId, p_user_id: userId, p_e164: e164, p_code_hash: codeHash, p_minutes: OWNER_LINE_VERIFY_MINUTES,
  });
  if (error) throw new Error(`startOwnerLineVerification failed: ${error.message}`);
  if (data === "ok" || data === "taken") return data;
  throw new Error(`startOwnerLineVerification: unexpected answer ${JSON.stringify(data)}`);
}

export async function attemptOwnerLineVerify(
  db: SupabaseClient, accountId: string, callerE164: string, codeHash: string,
): Promise<"verified" | "wrong" | "spent" | "none"> {
  const { data, error } = await db.rpc("owner_line_attempt_verify", {
    p_account_id: accountId, p_caller_e164: callerE164, p_code_hash: codeHash,
  });
  if (error) throw new Error(`attemptOwnerLineVerify failed: ${error.message}`);
  if (data === "verified" || data === "wrong" || data === "spent" || data === "none") return data;
  throw new Error(`attemptOwnerLineVerify: unexpected answer ${JSON.stringify(data)}`);
}

/** False when the cell is not verified (the row's pin_needs_cell CHECK would refuse; this asks first). */
export async function setOwnerLinePin(
  db: SupabaseClient, accountId: string, userId: string, pinHash: string,
): Promise<boolean> {
  const { data, error } = await db.from("owner_line_enrollments")
    .update({ pin_hash: pinHash, pin_set_at: new Date().toISOString(), failed_attempts: 0, locked_until: null })
    .eq("account_id", accountId).eq("user_id", userId).not("verified_at", "is", null).select("id");
  if (error) throw new Error(`setOwnerLinePin failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function removeOwnerLinePin(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { error } = await db.from("owner_line_enrollments")
    .update({ pin_hash: null, pin_set_at: null, failed_attempts: 0, locked_until: null })
    .eq("account_id", accountId).eq("user_id", userId);
  if (error) throw new Error(`removeOwnerLinePin failed: ${error.message}`);
}

export async function removeOwnerLineEnrollment(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { error } = await db.from("owner_line_enrollments").delete().eq("account_id", accountId).eq("user_id", userId);
  if (error) throw new Error(`removeOwnerLineEnrollment failed: ${error.message}`);
}

export async function ownerLineAnswerLookup(
  db: SupabaseClient, accountId: string, callerE164: string, max: number,
): Promise<OwnerLineLookup> {
  const { data, error } = await db.rpc("owner_line_answer_lookup", {
    p_account_id: accountId, p_caller_e164: callerE164, p_max: max,
  });
  if (error) throw new Error(`ownerLineAnswerLookup failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  const status = r?.status;
  if (status === "none" || status === "off" || status === "locked") return { status };
  if ((status === "verify" || status === "pin" || status === "over_limit")
      && typeof r?.enrollment_id === "string" && typeof r?.user_id === "string" && ROLES.includes(String(r?.role))) {
    return {
      status, enrollmentId: r.enrollment_id, userId: r.user_id, role: r.role as AccountRole,
      name: typeof r.name === "string" ? r.name : null, language: lang(r.language), accountLanguage: lang(r.account_language),
      pinParams: typeof r.pin_params === "string" ? r.pin_params : null,
    };
  }
  throw new Error(`ownerLineAnswerLookup: unexpected answer ${JSON.stringify(data)}`);
}

export async function attemptOwnerLinePin(
  db: SupabaseClient, enrollmentId: string, candidate: string,
): Promise<OwnerLinePinResult> {
  const { data, error } = await db.rpc("owner_line_attempt_pin", {
    p_enrollment_id: enrollmentId, p_candidate: candidate, p_lock_minutes: OWNER_LINE_LOCK_MINUTES,
  });
  if (error) throw new Error(`attemptOwnerLinePin failed: ${error.message}`);
  const r = data as { status?: unknown; locked_until?: unknown } | null;
  const s = r?.status;
  // A lock always carries its end: owner_line_attempt_pin returns locked_until from the same UPDATE ... RETURNING
  // (locked_now) or from the row it read (locked). A lock without one is an unexpected answer, never a null that the
  // lockout email would have to print as nothing (Task 8).
  if (s === "locked_now" || s === "locked") {
    if (typeof r?.locked_until === "string") return { status: s, lockedUntil: r.locked_until };
  } else if (s === "ok" || s === "wrong" || s === "none") {
    return { status: s };
  }
  throw new Error(`attemptOwnerLinePin: unexpected answer ${JSON.stringify(data)}`);
}

export async function ownerLineSessionCheck(
  db: SupabaseClient,
  p: { accountId: string; userId: string; role: AccountRole; maxCalls: number | null },
): Promise<({ ok: true } & OwnerLineSessionFacts) | { ok: false; reason: string }> {
  const { data, error } = await db.rpc("owner_line_session_check", {
    p_account_id: p.accountId, p_user_id: p.userId, p_role: p.role, p_max: p.maxCalls,
  });
  if (error) throw new Error(`ownerLineSessionCheck failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r?.ok === false && typeof r.reason === "string") return { ok: false, reason: r.reason };
  if (r?.ok === true && typeof r.clerk_user_id === "string" && typeof r.clerk_org_id === "string" && typeof r.timezone === "string") {
    return { ok: true, name: typeof r.name === "string" ? r.name : null, language: lang(r.language),
      clerkUserId: r.clerk_user_id, clerkOrgId: r.clerk_org_id, timezone: r.timezone, accountLanguage: lang(r.account_language) };
  }
  throw new Error(`ownerLineSessionCheck: unexpected answer ${JSON.stringify(data)}`);
}

export async function noteOwnerLineCall(
  db: SupabaseClient,
  p: { accountId: string; callId: string; actorClerkUserId: string; actorName: string | null; kinds: readonly OwnerLineLogKind[] },
): Promise<void> {
  const { error } = await db.rpc("note_owner_line_call", {
    p_account_id: p.accountId, p_call_id: p.callId, p_actor: p.actorClerkUserId, p_actor_name: p.actorName,
    p_kinds: [...p.kinds],
  });
  if (error) throw new Error(`noteOwnerLineCall failed: ${error.message}`);
}

/** On the READER's client: RLS returns rows to the agency and this account's Owner only, [] to anyone else. */
export async function readOwnerLineCallLog(db: SupabaseClient, accountId: string, callId: string): Promise<OwnerLineLogKind[]> {
  const { data, error } = await db.from("agency_visit_items").select("kind")
    .eq("account_id", accountId).eq("record_id", callId).in("kind", [...OWNER_LINE_LOG_KINDS]);
  if (error) throw new Error(`readOwnerLineCallLog failed: ${error.message}`);
  return ((data ?? []) as { kind: OwnerLineLogKind }[]).map((r) => r.kind);
}

/**
 * The switch and its record (owner rulings Q-A and 2026-11-09 "Say BIS, keep names private"): WHEN it last changed and
 * WHAT KIND of person changed it, never who. The card says "Turned on by the Owner" or "Turned off by BIS". Which BIS
 * person did it is BIS's own null-account event (Task 5), never read here.
 */
export type OwnerLineSwitchKind = "owner" | "agency";
export type OwnerLineSwitchState = { enabledAt: string | null; changedAt: string | null; changedByKind: OwnerLineSwitchKind | null };

/** Server code only (the Team page after requireAccountOwner; the preferences card after the membership check). */
export async function readOwnerLineSwitch(db: SupabaseClient, accountId: string): Promise<OwnerLineSwitchState> {
  const { data, error } = await db.from("accounts")
    .select("owner_line_enabled_at, owner_line_changed_at, owner_line_changed_by_kind")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`readOwnerLineSwitch failed: ${error.message}`);
  const r = data as { owner_line_enabled_at: string | null; owner_line_changed_at: string | null;
    owner_line_changed_by_kind: string | null } | null;
  const kind = r?.owner_line_changed_by_kind ?? null;
  if (kind !== null && kind !== "owner" && kind !== "agency") throw new Error(`readOwnerLineSwitch: unexpected kind ${kind}`);
  return { enabledAt: r?.owner_line_enabled_at ?? null, changedAt: r?.owner_line_changed_at ?? null, changedByKind: kind };
}

/**
 * Server code only, after requireAccountOwner. Owner ruling Q-A: the client's Owner turns it on or off; the agency may
 * turn it OFF and never ON. Enforced here, in the action, and in the database (accounts_owner_line_agency_off_check).
 * The switch, a NEW change time and the who-kind travel in one UPDATE: 0115's accounts_owner_line_switch_record refuses
 * a switch change whose owner_line_changed_at does not move. The database checks only that the TIME is fresh; keeping
 * the who-kind current is this function's job, and it always writes both.
 *
 * Asking for the state the switch is already in writes NOTHING (review m-E) and answers `changed: false`: an agency OFF
 * on a switch the Owner already turned off must not relabel it "Turned off by BIS", and Task 5 emits BIS's
 * owner_line.switch_off event only when `changed` is true. The test is the UPDATE's own filter, so two clicks racing
 * each other change it once.
 */
export async function setOwnerLineSwitch(
  db: SupabaseClient, accountId: string, on: boolean, by: OwnerLineSwitchKind,
): Promise<{ changed: boolean; state: OwnerLineSwitchState }> {
  if (on && by === "agency") throw new Error("setOwnerLineSwitch: the agency cannot turn the owner line on");
  const at = new Date().toISOString();
  const base = db.from("accounts")
    .update({ owner_line_enabled_at: on ? at : null, owner_line_changed_at: at, owner_line_changed_by_kind: by })
    .eq("id", accountId);
  const { data, error } = await (on ? base.is("owner_line_enabled_at", null) : base.not("owner_line_enabled_at", "is", null))
    .select("id");
  if (error) throw new Error(`setOwnerLineSwitch failed: ${error.message}`);
  return { changed: (data ?? []).length === 1, state: await readOwnerLineSwitch(db, accountId) };
}
