"use server";

import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAgencyOnlyAccountAccess, requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createCustomField, upsertCustomValue, setClientAccess, setFromEmail, setReportEmails,
         setAlertPhone, serviceDb, type CustomFieldDef,
         startAlertPhoneVerification, verifyAlertPhoneCode, countRecentAlertPhoneVerifications,
         discardAlertPhoneVerification,
         ALERT_CODE_MAX_SENDS_PER_HOUR } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { saveVerifiedFromAddress } from "@/lib/email/preflight";
// The public form's own validator, reused deliberately rather than a second
// regex — the same reasoning branding/actions.ts records: one email regex
// that drifts from another is worse than one that is strict.
import { isValidEmail } from "@/lib/forms/guards";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveSmsSender, refusesAlertLoop } from "@/lib/sms/sender";
import { composeAlertPhoneVerificationSms } from "@/lib/sms/alerts";
import { getSmsProvider } from "@/lib/sms";
import { m } from "@/lib/messages";

export async function createFieldAction(accountId: string, formData: FormData): Promise<void> {
  await requireAgencyOnlyAccountAccess(accountId);
  const dataType = String(formData.get("dataType")) as CustomFieldDef["data_type"];
  const options = String(formData.get("options") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  await createCustomField(await dbForRequest(), accountId, {
    model: "contact",
    fieldKey: String(formData.get("fieldKey") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    dataType, options: options.length ? options : undefined,
  });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

export async function upsertValueAction(accountId: string, formData: FormData): Promise<void> {
  await requireAgencyOnlyAccountAccess(accountId);
  await upsertCustomValue(await dbForRequest(), accountId, {
    valueKey: String(formData.get("valueKey") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    value: String(formData.get("value") ?? ""),
  });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

/**
 * Deliberately serviceDb(), not dbForRequest(): this writes the very flag
 * app.current_account_id() reads to resolve an account for a client's
 * RLS-scoped token, so an RLS-scoped client could never turn its own access
 * back *on* — the row would already be invisible to it. Guarded on isAgency
 * instead, since the database can't be trusted to gate this one.
 */
export async function setClientAccessAction(accountId: string, formData: FormData): Promise<void> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may change client access");

  const enabled = formData.get("enabled") === "true";
  await setClientAccess(serviceDb(), accountId, enabled, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

/**
 * Sets a company's display name and logo.
 *
 * Agency-only, and the gate is the first statement: the whole milestone rests
 * on there being no client-facing write path to branding. `accountId` is bound
 * server-side by the caller via `.bind(null, accountId)` — never a form field,
 * or this becomes the thirteenth IDOR on this codebase.
 *
 * serviceDb() is correct here, as it is elsewhere in this file: Settings is
 * agency-only, and a Storage write needs the service role.
 */
export async function inviteClientAdminAction(
  accountId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may invite client users");

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: m["clientAccess.inviteFailed"] };

  const db = serviceDb();
  const { data: account, error } = await db.from("accounts")
    .select("clerk_org_id, client_access_enabled").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`invite: account lookup failed: ${error.message}`);
  if (!account) throw new Error("invite: account not found");
  if (!account.client_access_enabled) {
    return { ok: false, error: m["clientAccess.disabledHint"] };
  }

  const res = await fetch(
    `https://api.clerk.com/v1/organizations/${account.clerk_org_id}/invitations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: email,
        role: "org:admin",
        inviter_user_id: userId,
      }),
    },
  );
  if (!res.ok) {
    // Expected failures (already invited, already a member, seat limit) are
    // rendered, not thrown — the dialog shows them and stays open.
    console.error("clerk invite failed", res.status, await res.text());
    return { ok: false, error: m["clientAccess.inviteFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}

/**
 * Agency-only, and BOTH writes below go through serviceDb() — which is bound
 * by neither RLS nor column grants — so the requireAgencyOnlyAccountAccess
 * guard on the first line is the ONLY gate on this write. Nothing in the
 * database is standing behind it. Do not read the grant story below as
 * redundancy.
 *
 * Migration 0015 grants `authenticated` no UPDATE on accounts.from_email
 * precisely so that no client-reachable path to this column exists at all: a
 * client able to write its own sending address could send mail as another
 * client of the same agency, the exact impersonation 0015 exists to prevent.
 * Removing the guard above, or granting the column so the write could move to
 * dbForRequest(), would each create that path. The read
 * (getSendingIdentity in page.tsx) stays on dbForRequest() — SELECT on
 * from_email IS granted to authenticated, and the read should stay
 * RLS-enforced.
 *
 * The preflight runs BEFORE the write, so a domain that is not verified in
 * Resend never reaches the column. Storing it first and letting the send fail
 * later would break every outbound email for that client, invisibly.
 *
 * Returns a result rather than throwing, for the reason setBrandingAction
 * does: the provider's own wording ("The acme.com domain is not verified.
 * Please, add and verify your domain.") is the single most useful string in
 * this feature, and a throw from a server action reaches the operator as a
 * generic error boundary — or, in production, a redacted digest. preflight.ts
 * deliberately does not wrap that message; this is what puts it on screen.
 */
export async function setFromEmailAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const raw = String(formData.get("fromEmail") ?? "").trim();

  if (!raw) {
    await setFromEmail(serviceDb(), accountId, null, userId);
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return { ok: true };
  }

  if (!isValidEmail(raw)) {
    return { ok: false, error: m["settings.sendingAddressBad"] };
  }

  try {
    // To the admin making the change: no new configuration, and the failure
    // lands in front of the person who caused it.
    const clerk = await clerkClient();
    const admin = await clerk.users.getUser(userId);
    const adminEmail = admin.primaryEmailAddress?.emailAddress;
    if (!adminEmail) {
      return { ok: false, error: "Cannot verify a sending address without an admin email address." };
    }

    // Verify-then-write, through the seam that PINS that order (Task 5). Calling
    // verifyFromAddress and setFromEmail directly here would work identically and
    // be untestable — this workspace has no server-action harness, so the seam is
    // the only place the ordering can be proven.
    const db = serviceDb();
    await saveVerifiedFromAddress(
      getEmailProvider(), raw, adminEmail,
      (address) => setFromEmail(db, accountId, address, userId),
    );
  } catch (e) {
    console.error(`setFromEmail: save failed for account ${accountId}: ${String(e)}`);
    // The provider's message, verbatim and unwrapped — it names the domain and
    // says what to do about it.
    return { ok: false, error: e instanceof Error ? e.message : m["settings.sendingAddressSaveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}

/**
 * Sets an account's weekly-report recipient list — the Settings-page twin of
 * `setFromEmailAction` above, same shape and same reason. BOTH writes in this
 * file that touch `accounts` go through `serviceDb()`, which no RLS policy or
 * column grant stands behind, so the `requireAgencyOnlyAccountAccess` guard on
 * the first line is the ONLY gate on this write — see `setFromEmailAction`'s
 * own comment for why that is not redundant with the grant story.
 *
 * Migration 0031 grants `authenticated` no UPDATE on `report_emails`,
 * deliberately: a client able to write its own account's recipient list could
 * redirect its weekly report to any address it chooses. See the migration's
 * comment for the full reasoning.
 *
 * Parses the comma-separated input into a trimmed, validated list — the same
 * shape the forms notify-email field already used, and (the parked minor this
 * change closes alongside it) validated the way that field never was. Rejects
 * the WHOLE save on the first bad address rather than silently dropping it, so
 * an operator's typo never quietly loses a recipient. An empty list is
 * meaningful and allowed: it means nobody receives this account's report, and
 * `listAccountsDueWeeklyReport` already treats such an account as not due at
 * all rather than as a failure.
 */
export async function setReportEmailsAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const emails = String(formData.get("reportEmails") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);

  for (const email of emails) {
    if (!isValidEmail(email)) {
      return { ok: false, error: m["settings.weeklyReportBadEmail"].replace("{value}", email) };
    }
  }

  await setReportEmails(serviceDb(), accountId, emails, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}

/**
 * Clears `accounts.alert_phone` (0035_alert_phone.sql), or refuses to touch
 * it at all — this is no longer the write path for a NEW number.
 *
 * 0036_alert_phone_verifications.sql closed the gap this action used to
 * leave open: a mistyped digit here used to send a stranger a continuous
 * stream of customers' names and appointment times, with no symptom
 * anywhere. Clearing the number needs no such proof — nobody has to
 * demonstrate possession to turn alerts OFF, and requiring it would strand
 * an account whose stored number is already wrong with no way to stop the
 * texts. So a blank field still writes NULL directly, exactly as before;
 * a non-blank field is refused outright and points at
 * `startAlertPhoneVerificationAction` below, the only remaining path that
 * can end in a WRITTEN, proven number.
 *
 * Same shape as `setFromEmailAction`/`setReportEmailsAction` beside it for
 * the clearing branch: BOTH go through `serviceDb()`, which no RLS policy
 * or column grant stands behind, so `requireAgencyOnlyAccountAccess` on the
 * first line is the ONLY gate on this write.
 *
 * A blank field writes NULL, never `""`: 0035's CHECK constraint refuses
 * the empty string outright so NULL stays the ONLY spelling of "off" — the
 * due-query and the send path would otherwise disagree about the same row.
 */
export async function setAlertPhoneAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const raw = String(formData.get("alertPhone") ?? "").trim();
  if (raw) {
    return { ok: false, error: m["settings.alertPhoneNeedsVerification"] };
  }

  await setAlertPhone(serviceDb(), accountId, null, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}

/**
 * Opens proof of possession for a NEW alert number
 * (0036_alert_phone_verifications.sql): draws a code, stores only its hash,
 * and texts the code to the claimed number through the SAME A2P-gated
 * sender every alert uses — an account that cannot send alerts cannot
 * verify one either, which is correct rather than a limitation, since a
 * number that could never be texted has nothing to prove. Never touches
 * `accounts.alert_phone` — that happens only in
 * `confirmAlertPhoneVerificationAction`, and only on the right code.
 *
 * Refuses outright, rather than merely warning, when the claimed number
 * equals one the account already owns (`refusesAlertLoop`, checked against
 * `gate.ownedNumbers` — every `testing` OR `live` row, not only the one
 * `gate.from` resolves to send FROM, for the reason `refusesAlertLoop`'s own
 * comment gives). The old direct-write action could still save that number
 * and merely warn, because the save had already happened; this action saves
 * nothing yet, and a code sent to an owned number loops back into the
 * inbound webhook instead of ever reaching a handset, so the operator could
 * never complete verification for it anyway.
 *
 * Rate-limited per (account, claimed number): every code is a real,
 * billed text, and 0036's own comment says this limit is the send path's
 * job, not the schema's — no UNIQUE index can express "no more than N in an
 * hour," and the migration deliberately allows unlimited live rows so a
 * corrected typo is never blocked. `ALERT_CODE_MAX_SENDS_PER_HOUR` (5)
 * mirrors the attempt cap for the same practical reason.
 */
export async function startAlertPhoneVerificationAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAgencyOnlyAccountAccess(accountId);

  const raw = String(formData.get("alertPhone") ?? "").trim();
  const normalized = toE164(raw);
  if (!normalized) return { ok: false, error: m["settings.alertPhoneBad"] };

  const db = serviceDb();
  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) return { ok: false, error: m["settings.alertPhoneNotClearedToSend"] };
  if (refusesAlertLoop(accountId, normalized, gate.ownedNumbers)) {
    return { ok: false, error: m["settings.alertPhoneSelfWarning"] };
  }

  const recentSends = await countRecentAlertPhoneVerifications(db, accountId, normalized);
  if (recentSends >= ALERT_CODE_MAX_SENDS_PER_HOUR) {
    return { ok: false, error: m["settings.alertPhoneTooManyCodes"] };
  }

  const { id, code } = await startAlertPhoneVerification(db, accountId, normalized);
  try {
    await getSmsProvider().send({
      to: normalized, from: gate.from, body: composeAlertPhoneVerificationSms(code),
    });
  } catch (e) {
    console.error(`alert phone verification send failed for account ${accountId}: ${String(e)}`);
    // No text went out, so this row must not count toward
    // ALERT_CODE_MAX_SENDS_PER_HOUR — otherwise five carrier failures lock
    // the number out for an hour with nothing ever delivered, which is
    // exactly the cost that limit exists to bound.
    await discardAlertPhoneVerification(db, id);
    return { ok: false, error: m["settings.alertPhoneSendFailed"] };
  }
  return { ok: true };
}

/**
 * Confirms a code against the account's own newest live verification for
 * the claimed number and, only on a match, writes `accounts.alert_phone`
 * (`verifyAlertPhoneCode`, `@bis/db` — that function is what enforces
 * consume-then-write; this action makes no ordering decision of its own).
 *
 * A wrong code and an expired code are deliberately reported with two
 * different strings (`settings.alertPhoneWrongCode` /
 * `settings.alertPhoneCodeExpired`) — the operator deserves to know which,
 * per the brief this closes — and neither copy, nor `verifyAlertPhoneCode`'s
 * own "expired" bucket, ever reveals whether the claimed number itself was
 * ever right: a code that was never sent for this number reads exactly like
 * one that expired.
 */
export async function confirmAlertPhoneVerificationAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const raw = String(formData.get("alertPhone") ?? "").trim();
  const normalized = toE164(raw);
  if (!normalized) return { ok: false, error: m["settings.alertPhoneBad"] };
  const code = String(formData.get("code") ?? "").trim();

  const outcome = await verifyAlertPhoneCode(serviceDb(), accountId, normalized, code, userId);
  if (outcome === "verified") {
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return { ok: true };
  }
  if (outcome === "wrong_code") return { ok: false, error: m["settings.alertPhoneWrongCode"] };
  return { ok: false, error: m["settings.alertPhoneCodeExpired"] };
}
