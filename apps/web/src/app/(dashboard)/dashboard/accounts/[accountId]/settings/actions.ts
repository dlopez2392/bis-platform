"use server";

import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAgencyOnlyAccountAccess, requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createCustomField, upsertCustomValue, setClientAccess, setFromEmail, serviceDb,
         type CustomFieldDef } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { saveVerifiedFromAddress } from "@/lib/email/preflight";
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
 * Agency-only, and there is no column grant that would let a client reach this
 * even if the guard were removed (spec §5) — the boundary is enforced twice.
 *
 * The preflight runs BEFORE the write, so a domain that is not verified in
 * Resend never reaches the column. Storing it first and letting the send fail
 * later would break every outbound email for that client, invisibly.
 */
export async function setFromEmailAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const raw = String(formData.get("fromEmail") ?? "").trim();

  if (!raw) {
    await setFromEmail(await dbForRequest(), accountId, null, userId);
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return;
  }

  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(raw)) {
    throw new Error(m["settings.sendingAddressBad"]);
  }

  // To the admin making the change: no new configuration, and the failure
  // lands in front of the person who caused it.
  const clerk = await clerkClient();
  const admin = await clerk.users.getUser(userId);
  const adminEmail = admin.primaryEmailAddress?.emailAddress;
  if (!adminEmail) throw new Error("Cannot verify a sending address without an admin email address.");

  // Verify-then-write, through the seam that PINS that order (Task 5). Calling
  // verifyFromAddress and setFromEmail directly here would work identically and
  // be untestable — this workspace has no server-action harness, so the seam is
  // the only place the ordering can be proven.
  const db = await dbForRequest();
  await saveVerifiedFromAddress(
    getEmailProvider(), raw, adminEmail,
    (address) => setFromEmail(db, accountId, address, userId),
  );
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}
